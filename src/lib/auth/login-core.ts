import "server-only"
import { createHash, randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import {
  isTenantBlockedForAccessAs, motivoDoPaywall,
  COLUNAS_DE_ACESSO, type AcessoDoTenant,
} from "@/lib/lifecycle-shared"

/** A linha que os três gates deste arquivo leem. `active` é o booleano legado. */
type LinhaDeAcesso = AcessoDoTenant & { id: string; active: boolean }

// ═══════════════════════════════════════════════════════════════
// Cérebro único do login (device trust — F2)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §4 e §4.1.
//
// TODA autenticação por senha do app passa por aqui (invariante I3): a action
// beginLogin chama verifyPassword → mintLoginTicket, e o NextAuth só troca o
// ticket por sessão via redeemLoginTicket. O provider de senha do NextAuth foi
// DELETADO (invariante I1) — este módulo é a única porta.
//
// Exceção temporária documentada: ext-auth.ts (extensão) mantém o próprio
// bcrypt até a F6, quando passa a consumir este módulo.

// Hash bcrypt fixo (senha aleatória) — iguala o tempo de resposta quando o
// email não existe (anti enumeração por timing). Mesmo valor usado hoje no
// ext-auth; sai de lá na F6.
const DUMMY_HASH = "$2b$10$xr7Cmkh6uOtBxebNKDHUBO/XnyR/m9z.2mO6moQukhXusLjLm2XVm"

// 🔒 A lista de estados que negam acesso NÃO mora mais aqui (2026-08-03). Ela vive em
// `lifecycle-shared.ts` e se pergunta por `isTenantBlockedForAccess(lifecycle)`.
//
// A cópia daqui era a 2ª definição e usava a string CRUA: estado desconhecido não estava
// na lista ⇒ deixava ENTRAR, enquanto o caminho de consumo (que normaliza) bloqueava. Uma
// definição só, e desconhecido nega dos dois lados. Ver docs/access-revocation-design.md §3.
//
// ⚠️ NÃO reintroduza uma checagem de `subscription_status` neste arquivo: inadimplência
//    corta GASTO, não ACESSO (degrau 3, política do dono). `isTenantBlockedForSpend` é
//    de outro caminho — o guarda dos webhooks/crons/widget.

const TICKET_TTL_MS = 2 * 60_000

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

/**
 * Primeiro tenant ACESSÍVEL de um usuário (membership ativa + tenant vivo),
 * na ordem estável de retorno do Postgres. Fonte ÚNICA da "resolução de tenant"
 * do login — usada por verifyPassword E por resolveChallengeActor (login.ts),
 * pra que o caminho confiável e o caminho do código pousem no MESMO tenant.
 * Sem isto, um usuário multi-tenant com um tenant suspenso podia receber o
 * tenant errado no desafio e ficar TRANCADO fora (o redeem rejeita o bloqueado).
 * Erro de query → mantém as memberships cruas (fail-open, igual ao resto).
 */
export async function firstAccessibleTenantId(userId: string): Promise<string | null> {
  const { data: memberships } = await supabaseAdmin
    .from("tenant_users")
    // ⚠️ `role` entrou aqui porque `trial_ended` bloqueia por PAPEL, não por tenant: o
    //    owner entra pra pagar, o atendente não. Sem o papel, este filtro não consegue
    //    responder a pergunta certa.
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("active", true)
  const papelDe = new Map((memberships ?? []).map((m) => [m.tenant_id as string, m.role as string]))
  let accessible = (memberships ?? []).map((m) => m.tenant_id as string)
  if (accessible.length > 1) {
    const { data: tens, error } = await supabaseAdmin
      .from("tenants")
      .select(COLUNAS_DE_ACESSO)
      .in("id", accessible)
    if (!error && tens) {
      const okIds = new Set(
        (tens as unknown as LinhaDeAcesso[])
          .filter((t) => t.active === true && !isTenantBlockedForAccessAs(t, papelDe.get(t.id)))
          .map((t) => t.id),
      )
      const filtered = accessible.filter((id) => okIds.has(id))
      if (filtered.length) accessible = filtered
    }
  }
  return accessible[0] ?? null
}

// ── 1. Senha + gates de acesso ────────────────────────────────────
export type VerifyResult =
  /** Senha errada, email inexistente ou sem nenhum acesso — resposta ÚNICA (anti enumeração). */
  | { status: "invalid" }
  /** Senha CORRETA mas todos os tenants bloqueados — pode revelar o motivo (a pessoa provou posse). */
  // ⚠️ Toda entrada nova aqui PRECISA de uma frase em `BLOCKED_NOTICE` (actions/login.ts).
  //    Sem a frase, o motivo cai no genérico e a pessoa lê "E-mail ou senha inválidos" —
  //    que é o defeito que `trial_ended` veio consertar.
  | { status: "blocked"; reason: "pending_approval" | "suspended" | "trial_ended" | "unpaid" | "indisponivel" }
  | { status: "ok"; userId: string; tenantId: string; passwordChangedAt: string | null; isPlatformAdmin: boolean }

/**
 * Valida senha e resolve o tenant acessível — os MESMOS gates que viviam no
 * authorize do NextAuth (membership ativa + tenant vivo + platform admin) e o
 * ramo de aviso que vivia em getSigninNotice, agora num lugar só.
 */
export async function verifyPassword(emailRaw: string, password: string): Promise<VerifyResult> {
  const email = String(emailRaw ?? "").toLowerCase().trim().slice(0, 254)
  if (!email || !password) return { status: "invalid" }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, password_hash, password_changed_at")
    .eq("email", email)
    .maybeSingle()

  if (!profile?.password_hash) {
    await bcrypt.compare(password, DUMMY_HASH)
    return { status: "invalid" }
  }
  if (!(await bcrypt.compare(password, profile.password_hash))) return { status: "invalid" }

  const [{ data: memberships }, { data: platformAdmin }] = await Promise.all([
    supabaseAdmin
      .from("tenant_users")
      .select("tenant_id, role")
      .eq("user_id", profile.id)
      .eq("active", true),
    supabaseAdmin
      .from("platform_admins")
      .select("id")
      .eq("user_id", profile.id)
      .maybeSingle(),
  ])
  const isPlatformAdmin = !!platformAdmin

  // Gate de tenant: filtra memberships de tenant inativo/pendente/suspenso.
  // Fail-OPEN em erro de query (não trava login por falha transitória).
  let accessible = memberships ?? []
  let states: string[] = []
  /** Algum tenant barrou esta pessoa por ATRASO além da carência (degrau 3)? */
  let barradoPorAtraso = false
  if (accessible.length > 0) {
    const { data: tens, error: tenErr } = await supabaseAdmin
      .from("tenants")
      .select(COLUNAS_DE_ACESSO)
      .in("id", accessible.map((m) => m.tenant_id))
    // 🔴 FALHA DE LEITURA NÃO PODE CONCEDER LOGIN NOVO (H-11 do pentest de 08/08). Com
    //    `tenErr`, o bloco inteiro era pulado: `accessible` ficava com TODAS as memberships
    //    sem filtro e a função devolvia `ok` — ou seja, um blip na tabela `tenants` abria
    //    login para tenant **suspenso ou desativado**. O comentário dizia "fail-OPEN em
    //    erro de query (não trava login por falha transitória)", e essa era a intenção; o
    //    alcance é que estava errado.
    // 🔑 A distinção que resolve: falha de leitura **não deixa entrar**, mas também **não
    //    acusa de senha errada**. Devolver `invalid` mandaria a pessoa trocar a senha por
    //    causa de um problema nosso. `blocked` com motivo próprio diz a verdade —
    //    "tente de novo em instantes" — e não abre a porta.
    // ⚠️ Só existe janela porque a leitura é do gate de ACESSO. Sessões já ativas seguem
    //    revalidando a cada 5 min por outro caminho.
    if (tenErr) {
      console.error("[login] leitura de tenants falhou — login NEGADO (fail-closed):", tenErr.message)
      return { status: "blocked", reason: "indisponivel" }
    }
    if (tens) {
      const linhas = tens as unknown as LinhaDeAcesso[]
      states = linhas.map((t) => t.lifecycle_state ?? "")
      // ⚠️ O motivo do paywall NÃO está no `lifecycle_state` quando é atraso — ele nasce da
      //    combinação assinatura × relógio. Sem esta linha, o atendente barrado por fatura
      //    vencida cairia no `invalid` e leria "E-mail ou senha inválidos": ele reseta a
      //    senha, não resolve, e liga pro dono dizendo que perdeu a conta. É exatamente o
      //    defeito que o `trial_ended` veio consertar — e este é o caminho que vai
      //    acontecer com MUITO mais gente.
      barradoPorAtraso = linhas.some((t) => t.active === true && motivoDoPaywall(
        t.lifecycle_state, t.subscription_status, t.past_due_since, t.past_due_grace_days,
      ) === "past_due")
      const papeis = new Map(accessible.map((m) => [m.tenant_id as string, m.role as string]))
      const okIds = new Set(
        linhas
          .filter((t) => t.active === true && !isTenantBlockedForAccessAs(t, papeis.get(t.id)))
          .map((t) => t.id),
      )
      accessible = accessible.filter((m) => okIds.has(m.tenant_id))
    }
  }

  if (accessible.length === 0 && !isPlatformAdmin) {
    // Senha correta + NENHUM tenant acessível: se algum está bloqueado, revela
    // o motivo (era o papel do getSigninNotice). Senão, resposta genérica.
    if (states.includes("pending_approval")) return { status: "blocked", reason: "pending_approval" }
    if (states.includes("suspended"))        return { status: "blocked", reason: "suspended" }
    // 🔴 `trial_ended` FALTAVA AQUI, e o buraco vira o caminho PRINCIPAL com a escada nova
    //    (mapeamento 08/08). Quem é barrado por este estado é o ATENDENTE — owner e admin
    //    entram pra pagar (`isTenantBlockedForAccessAs`). Sem esta linha ele caía no
    //    `invalid` e lia **"E-mail ou senha inválidos"**: reseta a senha, não resolve,
    //    liga pro dono dizendo que perdeu a conta.
    //    Hoje é caso de borda. Quando a fatura vencida passar a levar ao mesmo paywall,
    //    vira a equipe inteira lendo "senha errada" numa terça 8h.
    // ⚠️ A mensagem NÃO diz nada de dinheiro — ver `BLOCKED_NOTICE` em `actions/login.ts`.
    //    Quem é barrado aqui é funcionário; a situação financeira do patrão não é assunto
    //    dele (mesma regra do `AgentServiceNotice`).
    if (states.includes("trial_ended"))      return { status: "blocked", reason: "trial_ended" }
    // 🔑 Último da fila de propósito: é o degrau MENOS grave (a relação está de pé, só o
    //    pagamento atrasou). Se a pessoa tem um tenant suspenso e outro atrasado, o motivo
    //    que ela precisa ouvir é o mais grave.
    if (barradoPorAtraso)                    return { status: "blocked", reason: "unpaid" }
    return { status: "invalid" }
  }

  return {
    status:            "ok",
    userId:            profile.id,
    tenantId:          accessible[0]?.tenant_id ?? "",
    passwordChangedAt: (profile.password_changed_at as string | null) ?? null,
    isPlatformAdmin,
  }
}

// ── 2. Ticket — a ÚNICA moeda que o NextAuth aceita ───────────────
/**
 * Emite o ticket de uso único (invariante I2: esta é a única porta; o gate de
 * dispositivo da F3 entra AQUI dentro, nunca no chamador).
 *
 * Fail-CLOSED: erro de banco → null → o chamador nega o login. Ticket sem
 * dispositivo não existe (device_id NOT NULL no schema).
 */
export async function mintLoginTicket(input: {
  userId:   string
  tenantId: string | null
  deviceId: string
  ip:       string | null
}): Promise<string | null> {
  try {
    const raw = randomBytes(32).toString("base64url")
    const { error } = await supabaseAdmin.from("login_tickets").insert({
      ticket_hash: sha256(raw),
      user_id:     input.userId,
      tenant_id:   input.tenantId || null,
      device_id:   input.deviceId,
      ip:          input.ip && input.ip !== "unknown" ? input.ip.slice(0, 64) : null,
      expires_at:  new Date(Date.now() + TICKET_TTL_MS).toISOString(),
    })
    return error ? null : raw
  } catch {
    return null
  }
}

export interface TicketActor {
  userId:          string
  email:           string
  name:            string | null
  tenantId:        string
  role:            string
  isPlatformAdmin: boolean
  deviceId:        string
}

/**
 * Troca o ticket por identidade — chamado SÓ pelo authorize do NextAuth.
 *
 * Três travas, todas fail-closed:
 *  1. Consumo ATÔMICO (`UPDATE … WHERE consumed_at IS NULL RETURNING`): ticket
 *     usado duas vezes → segunda perde.
 *  2. Vínculo ao dispositivo: o cookie desta request tem que bater com o
 *     device do ticket. Ticket vazado sem o cookie não vale nada.
 *  3. Re-checa membership/platform-admin (o mundo pode ter mudado nos 2 min).
 */
export async function redeemLoginTicket(
  rawTicket: string,
  deviceKey: string | null,
): Promise<TicketActor | null> {
  if (!rawTicket || !deviceKey) return null

  try {
    const nowIso = new Date().toISOString()
    const { data: ticket } = await supabaseAdmin
      .from("login_tickets")
      .update({ consumed_at: nowIso })
      .eq("ticket_hash", sha256(rawTicket))
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .select("user_id, tenant_id, device_id")
      .maybeSingle()
    if (!ticket) return null

    // Trava 2 — o dispositivo que resgata é o que pediu.
    const { data: device } = await supabaseAdmin
      .from("auth_devices")
      .select("device_key_hash")
      .eq("id", ticket.device_id)
      .maybeSingle()
    if (!device || device.device_key_hash !== sha256(deviceKey)) return null

    // Trava 3 — identidade fresca (não confia em estado de 2 min atrás):
    // membership ativa + TENANT vivo (pode ter sido suspenso durante o desafio)
    // + platform admin.
    const tenantId = (ticket.tenant_id as string | null) ?? ""
    const [{ data: prof }, tu, { data: pa }, ten] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, email, full_name").eq("id", ticket.user_id).maybeSingle(),
      tenantId
        ? supabaseAdmin
            .from("tenant_users")
            .select("role, active")
            .eq("user_id", ticket.user_id)
            .eq("tenant_id", tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null as { role: string; active: boolean } | null }),
      supabaseAdmin.from("platform_admins").select("id").eq("user_id", ticket.user_id).maybeSingle(),
      tenantId
        ? supabaseAdmin.from("tenants").select(COLUNAS_DE_ACESSO).eq("id", tenantId).maybeSingle()
        : Promise.resolve({ data: null as LinhaDeAcesso | null }),
    ])
    if (!prof) return null

    const linha = ten.data as LinhaDeAcesso | null
    const tenantBlocked = !!linha &&
      (linha.active === false || isTenantBlockedForAccessAs(linha, tu.data?.role as string | undefined))
    const role = tu.data?.active === true && !tenantBlocked ? (tu.data.role as string) : ""
    const isPlatformAdmin = !!pa
    if (!role && !isPlatformAdmin) return null   // revogado na janela do ticket

    return {
      userId:          prof.id as string,
      email:           prof.email as string,
      name:            (prof.full_name as string | null) ?? null,
      tenantId:        role ? tenantId : "",
      role,
      isPlatformAdmin,
      deviceId:        ticket.device_id as string,
    }
  } catch {
    return null
  }
}
