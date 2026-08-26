// ═══════════════════════════════════════════════════════════════
// Sprint 2.4 — Engine de atribuição automática de conversas
// ═══════════════════════════════════════════════════════════════
//
// Estratégias:
//   - round_robin  → alfabético, pega próximo depois de last_user_id
//   - least_busy   → quem tem menos conversas em open/pending agora
//
// Filtros aplicados (em ordem):
//   1. Módulo `auto_assign` habilitado pro tenant
//   2. tenant_config.auto_assign_enabled
//   3. Horário comercial (se only_in_hours=true)
//   4. is_group + skip_groups
//   5. conversation.channel in channels
//   6. Atendentes elegíveis: active, role in eligible_roles, não pausado
//   7. Cap diário por atendente (se max_per_day setado)
//
// Não atribui se:
//   - Conversa já tem assigned_to (preserva atribuição existente)
//   - Não há agentes elegíveis (fica no pool)
//
// Chamado por:
//   - webhook MESSAGES_UPSERT (após criar conversa nova)
//   - /api/site/lead (após criar conversa nova)
//
// Não chamado em:
//   - createManualConversation (atendente já se atribui)
//   - reabrir via dedup (preserva assigned_to original)

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { isWithinBusinessHours } from "@/lib/automation/business-hours"
import { memberServesDepartment } from "@/lib/visibility"
import { logConversationEvent } from "@/lib/atendimento/events"
import { sendPushToUsers } from "@/lib/push/send"

export interface AutoAssignResult {
  assigned:    boolean
  agent_id?:   string
  agent_name?: string
  reason?:     "module_disabled" | "config_disabled" | "outside_hours" | "is_group"
              | "channel_excluded" | "already_assigned" | "no_eligible_agents"
              | "all_at_cap" | "already_claimed" | "department_empty"
              | "conversation_not_found" | "error" | "ok"
}

/**
 * Motivo do evento de trilha quando o SISTEMA distribuiu (≠ `auto_assign_pool`, que é o
 * atendente PEGANDO da fila ao responder). Constante compartilhada de propósito: o
 * relatório de atendentes casa por esta string, e duas cópias soltas divergiriam em
 * silêncio — o relatório voltaria a marcar zero sem ninguém notar.
 */
export const AUTO_ASSIGN_EVENT_REASON = "auto_assign_distributed"

/**
 * Motivos em que a conversa TEM dono, ainda que esta chamada não o tenha posto.
 * Quem ramifica em "distribuiu / não distribuiu" (o nó do Studio, a nota da inatividade)
 * precisa disto — senão anuncia "vou te colocar na fila" com a conversa já atribuída.
 */
export function conversationHasOwner(r: AutoAssignResult): boolean {
  return r.assigned || r.reason === "already_claimed" || r.reason === "already_assigned"
}

/**
 * Motivos em que a distribuição ESTAVA ligada e mesmo assim não atribuiu. São os
 * únicos que valem carimbo na conversa: quando o recurso está desligado, carimbar
 * seria sujar toda conversa do tenant com um "não distribuí porque está desligado".
 */
const REASONS_WORTH_STAMPING = new Set<NonNullable<AutoAssignResult["reason"]>>([
  "outside_hours", "channel_excluded", "no_eligible_agents", "all_at_cap",
  "department_empty", "already_claimed", "error",
])

/**
 * Início do dia NO FUSO DO TENANT, em ISO.
 *
 * 🔴 Aqui morava um `new Date(); setHours(0,0,0,0)`, que usa o fuso do PROCESSO. O
 *    container roda em UTC, então o teto diário de cada atendente zerava às 21h de
 *    Brasília: quem batia o limite às 20h voltava a receber uma hora depois e terminava
 *    o dia com o dobro. Nunca foi notado porque o teto nunca rodou em produção.
 */
export function tenantDayStartIso(timeZone: string, now: Date = new Date()): string {
  const parts: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value
  }
  const y = +parts.year, mo = +parts.month, d = +parts.day
  // ⚠️ Defensivo: algumas ICUs imprimem meia-noite como "24" em `hour12:false`. O Node
  //    desta máquina imprime "00", então este ramo NÃO é coberto por teste — nenhum teste
  //    consegue produzi-lo aqui. Fica porque `% 24` sobre "00" é no-op e sobre "24" é a
  //    correção certa; some se algum dia o runtime for fixado.
  const h = +parts.hour % 24
  // Quanto o relógio local está à frente do UTC, medido AGORA.
  // ⚠️ Medido AGORA, não à meia-noite: nos DOIS dias do ano em que um fuso entra ou sai
  //    do horário de verão, o início do dia sai 1h deslocado (30min em fusos de meia
  //    hora). Sem efeito em `America/Sao_Paulo`, que não tem DST desde 2019 — mas
  //    `business_hours_timezone` é livre, então isto é limitação conhecida, não "resolvido".
  const offsetMs = Date.UTC(y, mo - 1, d, h, +parts.minute, +parts.second) - now.getTime()
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetMs).toISOString()
}

/** Log estruturado do desfecho — é o que permite diagnosticar sem abrir o banco. */
function logOutcome(tenantId: string, conversationId: string, r: AutoAssignResult) {
  console.log(JSON.stringify({
    src: "auto-assign", tenant: tenantId, conversa: conversationId,
    atribuiu: r.assigned, motivo: r.reason ?? null, agente: r.agent_id ?? null,
  }))
}

/**
 * Carimba na CONVERSA o porquê de não ter distribuído. O log do container rotaciona e o
 * operador não o alcança; o carimbo fica onde a conversa é lida. Re-lê o metadata na hora
 * (mesmo cuidado do motor de inatividade): o objeto pode ter mudado desde o começo desta
 * função, e gravar por cima apagaria chave escrita por outro caminho. Fail-open.
 */
async function stampReason(tenantId: string, conversationId: string, reason: string) {
  try {
    const { data } = await supabaseAdmin
      .from("chat_conversations").select("metadata")
      .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle()
    if (!data) return
    const meta = (data.metadata as Record<string, unknown> | null) ?? {}
    await supabaseAdmin.from("chat_conversations")
      .update({ metadata: { ...meta, auto_assign: { at: new Date().toISOString(), reason } } })
      .eq("id", conversationId).eq("tenant_id", tenantId)
  } catch (e) {
    console.error("[auto-assign] stampReason:", (e as Error).message)
  }
}

/** Saída única: loga, carimba quando vale, devolve. */
async function done(tenantId: string, conversationId: string, r: AutoAssignResult): Promise<AutoAssignResult> {
  logOutcome(tenantId, conversationId, r)
  if (r.reason && REASONS_WORTH_STAMPING.has(r.reason)) await stampReason(tenantId, conversationId, r.reason)
  return r
}

export async function assignNextAgent(
  tenantId:        string,
  conversationId:  string,
  /** `exclude`: quem NÃO pode receber. Usado pela redistribuição por inatividade, pra não
   *  devolver a conversa exatamente a quem a estava ignorando. */
  opts?:           { exclude?: string[] },
): Promise<AutoAssignResult> {
  // 1. Módulo habilitado?
  // ⚠️ `hasModule` é fail-closed: erro de RPC também devolve false, então "não comprou o
  //    módulo" e "não consegui perguntar" chegam aqui idênticos. Passa por `done` pra pelo
  //    menos deixar linha no log — era o único ramo de saída que não deixava.
  const moduleOk = await hasModule(tenantId, "auto_assign")
  if (!moduleOk) return done(tenantId, conversationId, { assigned: false, reason: "module_disabled" })

  // 2. Config + dados da conversa em paralelo
  const [{ data: cfg, error: cfgErr }, { data: conv, error: convErr }] = await Promise.all([
    supabaseAdmin
      .from("tenant_config")
      .select(`
        auto_assign_enabled, auto_assign_strategy, auto_assign_only_in_hours,
        auto_assign_skip_groups, auto_assign_eligible_roles, auto_assign_channels,
        auto_assign_max_per_day, auto_assign_last_user_id,
        business_hours_enabled, business_hours_schedule, business_hours_timezone
      `)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("chat_conversations")
      .select("id, channel, is_group, assigned_to, instance_id, department_id, chat_contacts ( push_name, custom_name )")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ])

  // 🔴 ERRO DE BANCO NÃO É DECISÃO. Antes, todo select aqui descartava o `error`: um
  //    soluço do PostgREST virava `cfg = null` → "config_disabled", ou `members = null`
  //    → "no_eligible_agents". O motivo reportado MENTIA, e o log estruturado gravaria a
  //    mentira — o operador leria "não tinha ninguém disponível" e iria mexer na escala.
  if (cfgErr || convErr) {
    console.error("[auto-assign] leitura falhou:", cfgErr?.message ?? convErr?.message)
    return done(tenantId, conversationId, { assigned: false, reason: "error" })
  }

  if (!cfg || !cfg.auto_assign_enabled) return done(tenantId, conversationId, { assigned: false, reason: "config_disabled" })
  // Motivo próprio: conversa apagada / id errado / de outro tenant não é "o recurso está
  // desligado". Reaproveitar `config_disabled` aqui era a mesma classe de motivo-que-mente
  // que o bloco de erro acima acabou de eliminar.
  if (!conv)                            return done(tenantId, conversationId, { assigned: false, reason: "conversation_not_found" })
  if (conv.assigned_to)                 return done(tenantId, conversationId, { assigned: false, reason: "already_assigned" })

  if (cfg.auto_assign_skip_groups && conv.is_group) {
    return done(tenantId, conversationId, { assigned: false, reason: "is_group" })
  }

  const allowedChannels = (cfg.auto_assign_channels ?? []) as string[]
  if (allowedChannels.length > 0 && conv.channel && !allowedChannels.includes(conv.channel)) {
    return done(tenantId, conversationId, { assigned: false, reason: "channel_excluded" })
  }

  // 3. Horário comercial
  if (cfg.auto_assign_only_in_hours && cfg.business_hours_enabled && cfg.business_hours_schedule) {
    type Sched = Record<string, { start: string; end: string; enabled: boolean }>
    const inside = isWithinBusinessHours(
      cfg.business_hours_schedule as Sched,
      cfg.business_hours_timezone ?? "America/Sao_Paulo",
    )
    if (!inside) return done(tenantId, conversationId, { assigned: false, reason: "outside_hours" })
  }

  // 4. Agentes elegíveis
  const eligibleRoles = (cfg.auto_assign_eligible_roles ?? ["agent"]) as string[]

  const { data: members, error: membersErr } = await supabaseAdmin
    .from("tenant_users")
    .select(`
      user_id, role, instance_ids, view_all, see_pool, department_id, supervises_departments,
      auto_assign_paused, auto_assign_paused_until,
      profiles!tenant_users_user_id_fkey ( id, full_name, email )
    `)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", eligibleRoles)

  if (membersErr) {
    console.error("[auto-assign] leitura de membros falhou:", membersErr.message)
    return done(tenantId, conversationId, { assigned: false, reason: "error" })
  }

  type MemberRow = {
    user_id:                  string
    role:                     string
    instance_ids:             string[] | null
    view_all:                 boolean | null
    see_pool:                 boolean | null
    department_id:            string | null
    supervises_departments:   string[] | null
    auto_assign_paused:       boolean
    auto_assign_paused_until: string | null
    profiles:                 { id: string; full_name: string | null; email: string } | null
  }

  // Número da conversa (Fase D): só entra no rodízio quem atende esse número (ou todos).
  const convInstanceId = (conv as { instance_id: string | null }).instance_id
  const excluded = new Set(opts?.exclude ?? [])
  const memberList = (members ?? []) as unknown as MemberRow[]
  const eligible = memberList.filter((m) => {
    if (excluded.has(m.user_id)) return false
    // Restrição de número: instance_ids vazio/null = todos; senão precisa incluir o número.
    //
    // ⚠️ O gate só se aplica quando a conversa TEM número. Conversa de canal sem
    // número (Instagram, site → instance_id null) entra no rodízio de TODO mundo:
    // antes, `!convInstanceId` derrubava todo agente número-scopado e a conversa
    // caía em "no_eligible_agents" (ficava eternamente no pool). Mesma regra do
    // `memberAttendsNumber`/`numberOk` em @/lib/visibility — paridade.
    // (Aqui o papel NÃO bypassa o número: rodízio é escala operacional, não
    // visibilidade — admin com número escolhido só recebe daquele número.)
    const ids = m.instance_ids
    if (convInstanceId && Array.isArray(ids) && ids.length > 0 && !ids.includes(convInstanceId)) return false
    // Pause manual ativo?
    // (o filtro de SETOR não entra aqui — ver logo abaixo, pra poder distinguir
    //  "não tem ninguém" de "não tem ninguém NESTE setor")
    if (m.auto_assign_paused) {
      if (!m.auto_assign_paused_until) return false
      if (new Date(m.auto_assign_paused_until).getTime() > Date.now()) return false
      // Pause expirou — limpa silenciosamente (lazy unpause)
    }
    return true
  })

  if (eligible.length === 0) return done(tenantId, conversationId, { assigned: false, reason: "no_eligible_agents" })

  // 4b. SETOR — atribuir CONCEDE visibilidade, então roteio pra fora do setor não é
  // só desorganização: entrega a conversa a quem não a veria. Conversa de entrada nasce
  // sem setor (Triagem) e passa direto; quem tem setor é a redistribuída pela inatividade
  // e a encaminhada pelo Studio. Fail-closed: sem gente NO setor, prefiro não atribuir e
  // deixar na fila daquele setor — que é onde ela deve estar — a jogar pra qualquer um.
  const convDepartmentId = (conv as { department_id: string | null }).department_id
  const inDepartment = eligible.filter((m) => memberServesDepartment(m, convDepartmentId))
  if (inDepartment.length === 0) {
    return done(tenantId, conversationId, { assigned: false, reason: "department_empty" })
  }

  // Lazy unpause: limpa quem expirou
  const expiredPauses = inDepartment
    .filter((m) => m.auto_assign_paused && m.auto_assign_paused_until && new Date(m.auto_assign_paused_until).getTime() <= Date.now())
    .map((m) => m.user_id)
  if (expiredPauses.length > 0) {
    await supabaseAdmin
      .from("tenant_users")
      .update({ auto_assign_paused: false, auto_assign_paused_until: null })
      .eq("tenant_id", tenantId)
      .in("user_id", expiredPauses)
  }

  // 5. Cap diário (se setado)
  //
  // 🔴 A contagem antiga era declaradamente um "proxy": conversas do atendente com
  //    `updated_at >= hoje` — ou seja, QUALQUER conversa dele TOCADA hoje, inclusive
  //    uma de três meses atrás que recebeu mensagem agora. Quem tem 40 conversas ativas
  //    estourava um teto de 20 sem ter recebido nenhuma nova, e a distribuição parava
  //    sozinha no meio do dia ("all_at_cap") sem ninguém entender.
  //    Agora conta o que de fato aconteceu: as auto-atribuições de hoje, pelo agente
  //    gravado em `sender_id` na mensagem de sistema (ver passo 7).
  // ⚠️ Isto mede ATRIBUIÇÃO AUTOMÁTICA, não carga total — a etiqueta na tela diz isso.
  let candidates = inDepartment
  if (cfg.auto_assign_max_per_day && cfg.auto_assign_max_per_day > 0) {
    const dayStart = tenantDayStartIso(cfg.business_hours_timezone ?? "America/Sao_Paulo")
    const candidateIds = inDepartment.map((m) => m.user_id)

    const { data: assignedToday, error: capErr } = await supabaseAdmin
      .from("chat_messages")
      .select("sender_id")
      .eq("tenant_id", tenantId)
      .eq("sender_type", "system")
      .eq("metadata->>kind", "auto_assign")
      .gte("created_at", dayStart)
      .in("sender_id", candidateIds)

    if (capErr) {
      console.error("[auto-assign] leitura do teto falhou:", capErr.message)
      return done(tenantId, conversationId, { assigned: false, reason: "error" })
    }

    const assignsToday = new Map<string, number>()
    for (const m of (assignedToday ?? []) as { sender_id: string | null }[]) {
      if (!m.sender_id) continue
      assignsToday.set(m.sender_id, (assignsToday.get(m.sender_id) ?? 0) + 1)
    }

    candidates = inDepartment.filter((m) => (assignsToday.get(m.user_id) ?? 0) < cfg.auto_assign_max_per_day!)
    if (candidates.length === 0) return done(tenantId, conversationId, { assigned: false, reason: "all_at_cap" })
  }

  // 6. Escolhe agente conforme estratégia
  let chosen: MemberRow | undefined
  /** Valor do ponteiro ANTES da minha reserva — pra devolver a vez se a atribuição falhar.
   *  Só existe no round_robin; `least_busy` não usa ponteiro. */
  let pointerPrevious: string | null = null
  /** Eu REALMENTE reservei a vez? Sem esta sentinela, `pointerPrevious = null` no
   *  `least_busy` (que nunca reserva) seria lido como "reservei a partir do nulo", e a
   *  devolução gravaria NULL no ponteiro do rodízio — desfazendo um estado que esta
   *  execução nunca criou. */
  let reservedTurn = false

  if (cfg.auto_assign_strategy === "least_busy") {
    const candidateIds = candidates.map((m) => m.user_id)
    const { data: openConvs, error: loadErr } = await supabaseAdmin
      .from("chat_conversations")
      .select("assigned_to")
      .eq("tenant_id", tenantId)
      .in("status", ["open", "pending"])
      .in("assigned_to", candidateIds)

    if (loadErr) {
      console.error("[auto-assign] leitura de carga falhou:", loadErr.message)
      return done(tenantId, conversationId, { assigned: false, reason: "error" })
    }

    const load = new Map<string, number>()
    for (const c of openConvs ?? []) {
      if (!c.assigned_to) continue
      load.set(c.assigned_to, (load.get(c.assigned_to) ?? 0) + 1)
    }

    // Ordena: menos ocupado primeiro; tie-break por nome.
    // ⚠️ Esta estratégia NÃO passa pela reserva do rodízio (não há ponteiro pra reservar):
    //    duas conversas simultâneas leem a mesma carga e podem escolher a mesma pessoa.
    //    Quem segura é a gravação condicional do passo 7 — que impede sobrescrever dono,
    //    mas não impede carga levemente torta. Trade-off consciente, não descuido.
    chosen = [...candidates].sort((a, b) => {
      const la = load.get(a.user_id) ?? 0
      const lb = load.get(b.user_id) ?? 0
      if (la !== lb) return la - lb
      return byName(a, b)
    })[0]
  } else {
    // round_robin: alfabético, próximo depois do last_user_id — RESERVANDO a vez.
    //
    // 🔴 Antes era ler o ponteiro no começo e gravar no fim, com 5 idas ao banco no meio:
    //    duas conversas nascendo juntas liam o mesmo valor e caíam na MESMA pessoa. O
    //    rodízio quebrava exatamente sob concorrência, que é o único motivo de ele existir.
    //    Agora a vez é RESERVADA antes de atribuir, com escrita condicional (só avança se
    //    o ponteiro ainda estiver onde eu li). Quem perde relê e pega o próximo.
    //
    // ⚠️ A reserva é o ÚNICO lugar que escreve `auto_assign_last_user_id`. Se o passo 7
    //    também escrevesse "ao confirmar", o ponteiro andaria pra trás e o rodízio
    //    quebraria de novo — de um jeito mais difícil de enxergar.
    // ⚠️ É best-effort, não trava: com um único candidato (ou no wrap pro próprio),
    //    a condição vira "de X para X" e os dois concorrentes ganham. Quem serializa de
    //    verdade é a gravação condicional do dono, no passo 7.
    // A volta do rodízio corre sobre TODOS os elegíveis, não só sobre os candidatos
    // que sobraram depois do setor/teto/exclusão.
    // 🔴 O ponteiro é UM por tenant. Se ele fosse procurado só na lista recortada, ele
    //    quase nunca estaria lá — e `pickNext` cairia sempre no primeiro da lista. Com
    //    dois setores alternando, o regime permanente vira "o primeiro de cada setor
    //    recebe 100%, o segundo recebe zero", com o log dizendo "round_robin".
    const sortedAll = [...eligible].sort(byName)
    let current = (cfg.auto_assign_last_user_id as string | null) ?? null

    for (let tentativa = 0; tentativa < sortedAll.length; tentativa++) {
      const next = pickNext(sortedAll, candidates, current)
      const reserved = await reserveTurn(tenantId, current, next.user_id)
      if (reserved) { chosen = next; pointerPrevious = current; reservedTurn = true; break }
      // Perdeu a corrida: relê onde o ponteiro parou e tenta o seguinte.
      const { data: fresh, error: freshErr } = await supabaseAdmin
        .from("tenant_config").select("auto_assign_last_user_id")
        .eq("tenant_id", tenantId).maybeSingle()
      // ⚠️ Erro aqui NÃO pode virar "o ponteiro é nulo": a tentativa seguinte compararia
      //    com IS NULL contra um ponteiro preenchido e falharia de propósito — um soluço
      //    de rede consumindo a última tentativa. Mesmo princípio do bloco de leitura.
      if (freshErr) {
        console.error("[auto-assign] releitura do ponteiro falhou:", freshErr.message)
        return done(tenantId, conversationId, { assigned: false, reason: "error" })
      }
      current = (fresh?.auto_assign_last_user_id as string | null) ?? null
    }

    // Esgotou as tentativas de reservar.
    // 🔴 NÃO abortar aqui. A reserva é JUSTIÇA, não corretude — quem impede dono duplicado
    //    é a gravação condicional do passo 7. Abortar deixava a conversa órfã no pool, e
    //    nenhum dos 5 chamadores re-tenta. O pior caso seguindo sem reserva é "alguém
    //    levou duas seguidas"; o pior caso abortando é "cliente esperando pra sempre".
    if (!chosen) chosen = pickNext(sortedAll, candidates, current)
  }

  if (!chosen) return done(tenantId, conversationId, { assigned: false, reason: "no_eligible_agents" })

  // 7. Atribui — CONDICIONAL
  //
  // 🔴 Aqui a gravação era incondicional, e a checagem de "já tem dono?" ficava lá no
  //    passo 2, várias consultas antes. Quem assumisse a conversa nesse intervalo era
  //    SOBRESCRITO: o atendente que já estava respondendo perdia a conversa, e o cliente
  //    passava a ter dois donos achando coisas diferentes. O caminho do primeiro-a-responder
  //    (chat.ts) sempre fez condicional — este é que estava fora do padrão.
  // ⚠️ O `.select("id")` NÃO é decoração: sem ele o supabase-js devolve `data: null` com
  //    `error: null` quando o filtro não casa, e não haveria como distinguir "gravei" de
  //    "não gravei" — a proteção viraria enfeite.
  // ⚠️ SEM cair pro e-mail. Este nome vai pro conteúdo de uma mensagem de sistema que
  //    NÃO é nota privada — e `exportPersonalData` (LGPD, Art. 18 II) exporta as mensagens
  //    das conversas do contato. Atendente sem nome preenchido colocaria o e-mail
  //    corporativo dele dentro de um pacote entregue ao titular dos dados.
  const agentName = chosen.profiles?.full_name?.trim() || "Atendente"

  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from("chat_conversations")
    // `updated_at` agora, não o carimbo capturado no início da função: o polling
    // incremental do inbox é `updated_at > since`, e gravar no passado esconderia a
    // atribuição de quem estiver sem Realtime.
    .update({ assigned_to: chosen.user_id, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .is("assigned_to", null)
    .select("id")

  if (claimErr) {
    console.error("[auto-assign] gravação do dono falhou:", claimErr.message)
    if (reservedTurn) await releaseTurn(tenantId, pointerPrevious, chosen.user_id)
    return done(tenantId, conversationId, { assigned: false, reason: "error" })
  }

  if (!claimed || claimed.length === 0) {
    // Alguém assumiu no meio do caminho. Devolve a vez — senão o escolhido é pulado
    // na próxima rodada sem nunca ter recebido nada, e isso não deixaria rastro.
    // ⚠️ `already_claimed` significa A CONVERSA TEM DONO — é o que o nó do Studio lê pra
    //    não dizer ao cliente "vou te colocar na fila" com a conversa já atribuída.
    //    Nunca reaproveitar este motivo pra um caso em que a conversa ficou SEM dono.
    if (reservedTurn) await releaseTurn(tenantId, pointerPrevious, chosen.user_id)
    return done(tenantId, conversationId, { assigned: false, reason: "already_claimed" })
  }

  // 8. Rastro — só depois de a atribuição ter PEGADO.
  //
  // A mensagem de sistema carrega `sender_id`: é por ela que o teto diário conta (passo 5).
  // Antes o agente vivia só dentro do metadata, e a consulta do teto filtrava por
  // `sender_id` — ou seja, nunca casava nada. A contagem era impossível por construção.
  const { error: msgErr } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    sender_id:       chosen.user_id,
    content_type:    "text",
    content:         `🎯 Auto-atribuído a ${agentName}`,
    status:          "delivered",
    is_private_note: false,
    metadata:        { kind: "auto_assign", strategy: cfg.auto_assign_strategy, agent_id: chosen.user_id },
  })
  // Não desfaz a atribuição (ela é o que importa), mas grita: sem esta linha o teto
  // diário subconta e o atendente recebe além do limite.
  if (msgErr) console.error("[auto-assign] mensagem de sistema falhou (teto vai subcontar):", msgErr.message)

  // Trilha do ciclo — o relatório de atendentes lê daqui. Sem esta chamada, ligar a
  // distribuição não move um único número na coluna "origem" e o dono conclui que
  // não está funcionando. Motivo PRÓPRIO: "peguei da fila" e "o sistema me deu" são
  // origens diferentes, e conflatá-las apagaria justamente o que se quer medir.
  await logConversationEvent({
    tenantId, conversationId, type: "assigned",
    actorKind: "system", toAgentId: chosen.user_id,
    reason: AUTO_ASSIGN_EVENT_REASON,
    meta: { strategy: cfg.auto_assign_strategy },
  })

  // Push pro dono. O fan-out do webhook roda EM PARALELO com esta função e quase sempre
  // chega antes, quando a conversa ainda não tem dono — então ele usa a regra de fila, e
  // quem tem `see_pool=false` (que é justamente quem depende da distribuição) fica sem
  // aviso nenhum. Este push é direcionado e sai depois de a atribuição existir.
  const ct = conv.chat_contacts as unknown as { push_name: string | null; custom_name: string | null } | null
  const quem = ct?.custom_name || ct?.push_name || "Novo contato"
  await sendPushToUsers([chosen.user_id], {
    title: "Nova conversa atribuída a você",
    body:  quem,
    url:   `/inbox?conversation=${conversationId}`,
    tag:   conversationId,
  }).catch((e) => console.error("[auto-assign] push:", (e as Error).message))

  return done(tenantId, conversationId, {
    assigned:   true,
    agent_id:   chosen.user_id,
    agent_name: agentName,
    reason:     "ok",
  })
}

/** Ordem alfabética estável do rodízio (nome, com e-mail de reserva). */
function byName(a: { profiles: { full_name: string | null; email: string } | null },
                b: { profiles: { full_name: string | null; email: string } | null }): number {
  const na = a.profiles?.full_name ?? a.profiles?.email ?? ""
  const nb = b.profiles?.full_name ?? b.profiles?.email ?? ""
  return na.localeCompare(nb, "pt-BR")
}

/**
 * Próximo da volta: caminha a partir de `current` na lista COMPLETA (`all`, ordenada) e
 * devolve o primeiro que ainda esteja elegível de fato (`candidates`), com wrap.
 *
 * 🔴 `all` × `candidates` não é preciosismo. O ponteiro é um só por tenant, e a lista de
 *    candidatos é recortada por setor, teto e exclusão. Procurar o ponteiro só na lista
 *    recortada faria ele quase nunca ser encontrado — e o rodízio colapsaria em "sempre o
 *    primeiro", enquanto o log continuaria dizendo "round_robin".
 */
function pickNext<T extends { user_id: string }>(all: T[], candidates: T[], current: string | null): T {
  const pool = new Set(candidates.map((m) => m.user_id))
  const start = current ? all.findIndex((m) => m.user_id === current) : -1
  for (let i = 1; i <= all.length; i++) {
    const m = all[(start + i + all.length) % all.length]
    if (pool.has(m.user_id)) return m
  }
  return candidates[0]   // inalcançável enquanto candidates ⊆ all e não-vazio
}

/**
 * Avança o ponteiro do rodízio SÓ SE ele ainda estiver em `expected`. Devolve se ganhou.
 *
 * 🔴 O ramo do nulo não é detalhe: `auto_assign_last_user_id` nasce NULL e nenhum tenant
 *    em produção tem valor ali. Em PostgREST, `.eq(coluna, null)` vira `coluna=eq.null` e
 *    não casa linha nenhuma — a reserva falharia sempre, o laço esgotaria as tentativas e
 *    a PRIMEIRA atribuição de TODO tenant que ligasse a distribuição devolveria
 *    "race_lost". O dia 1 de todo mundo, sem exceção.
 */
async function reserveTurn(tenantId: string, expected: string | null, next: string): Promise<boolean> {
  let q = supabaseAdmin
    .from("tenant_config")
    .update({ auto_assign_last_user_id: next })
    .eq("tenant_id", tenantId)
  q = expected === null
    ? q.is("auto_assign_last_user_id", null)
    : q.eq("auto_assign_last_user_id", expected)
  const { data, error } = await q.select("tenant_id")
  if (error) {
    console.error("[auto-assign] reserva da vez falhou:", error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

/** Devolve a vez quando a atribuição não pegou. Best-effort: se outro já avançou por
 *  cima, não force — a vez dele é mais recente que a minha. */
async function releaseTurn(tenantId: string, previous: string | null, reserved: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("tenant_config")
      .update({ auto_assign_last_user_id: previous })
      .eq("tenant_id", tenantId)
      .eq("auto_assign_last_user_id", reserved)
  } catch (e) {
    console.error("[auto-assign] devolução da vez falhou:", (e as Error).message)
  }
}
