import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase"
import { listAllLimits, getStorageBreakdown } from "@/lib/limits"
import { LIMIT_META, type LimitInfo, type LimitResource } from "@/lib/limits-shared"
import { getBillingStanding, PAUSADO_POR_MODULO, type BillingStanding } from "@/lib/billing/standing"
import { getCobrancaDoGateway } from "@/lib/asaas/subscription-info"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"
import { normalizarBandeira, rotuloDoCartao, type Bandeira } from "@/lib/billing/card-brand"

// ═══════════════════════════════════════════════════════════════
// Telas de assinatura — o DADO REAL (substitui buildMock)
// ═══════════════════════════════════════════════════════════════
// docs/asaas-billing-design.md · docs/access-revocation-design.md §2
//
// 🔑 A REGRA QUE ORGANIZA ESTE ARQUIVO: **só é linha de DINHEIRO o recurso que tem preço
//    por unidade.** Medido no schema (2026-08-03): o único é `users`
//    (`plans.extra_user_price_cents`). Mensagens, storage, contatos, automações e execuções
//    do Instagram têm COTA e **nenhum preço** — logo não podem gerar excedente cobrável.
//    Mostrá-los com cara de dinheiro seria inventar uma cobrança que não existe; escondê-los
//    seria esconder a cota que o cliente estourou. Por isso viram linha discreta.
//    ⚠️ No dia em que um deles ganhar preço, ele MUDA de lista aqui — e é só isso.
//
// ⚠️ NÃO calcula nada de novo: uso vem de `listAllLimits` (o mesmo motor da tela de Uso e
//    dos gates de criação), degrau vem de `getBillingStanding`. Uma terceira contagem
//    própria seria a quarta cópia da mesma verdade — o defeito que este projeto já pagou
//    caro duas vezes hoje.

export interface AssinaturaResumoData {
  planoNome:      string
  planoCents:     number
  cicloDia:       number | null
  formaPagamento: string
  emailCobranca:  string
}

export interface LinhaMedidaData {
  key: string; label: string; unidade: string
  usado: number; cota: number | null
  precoUnitCents: number
  excedente: number; excedenteCents: number
  projecaoCents: number
  parou?: boolean
}

export interface LinhaDiscretaData {
  key: string; label: string
  usado: number; cota: number | null
  textoUso: string
  detalhe?: { label: string; texto: string }[]
}

export interface ContaDoMesData {
  planoLabel: string; planoCents: number
  extras: { label: string; cents: number }[]
  totalCents: number
  fechaEm: string | null
}

export interface AssinaturaView {
  standing:  BillingStanding
  /**
   * O que o GATEWAY vai cobrar e quando. `null` = sem assinatura no gateway (cliente
   * manual/legado) ou o Asaas não respondeu — nesse caso a tela usa a projeção local.
   *
   * 🔑 Existe porque a projeção local errava os dois números quando o preço do plano
   *    mudava ou o cliente pagava adiantado (achado do dono, 06/08). Ver `subscription-info`.
   */
  cobranca:  { valorCents: number; proximaEm: string | null } | null
  /**
   * Existe assinatura de verdade no gateway? Governa a porta de "Trocar cartão".
   *
   * ⚠️ Campo PRÓPRIO, e não `cobranca !== null`, de propósito: `cobranca` é `null` também
   *    quando o Asaas não responde. Usar aquilo como sinal faria o botão de trocar cartão
   *    **sumir num blip de rede** — justo pra quem está tentando resolver uma cobrança
   *    recusada. Este lê do banco, que não depende do gateway estar de pé.
   */
  temAssinatura: boolean
  /**
   * O cartão que cobra este cliente — **rótulo, não credencial**.
   *
   * 🔒 Bandeira e 4 últimos dígitos são o mesmo dado que aparece na fatura do banco dele.
   *    O PAN, a validade e o CVV nunca passaram pelo nosso banco; o token (que É
   *    credencial) fica cifrado e **não sai desta camada**.
   * ⚠️ `null` pra quem assinou antes de a gente registrar o rótulo. A tela diz "Cartão
   *    cadastrado" nesse caso — inventar 4 dígitos seria exibir um identificador que não
   *    identifica nada.
   */
  cartao: { bandeira: Bandeira | null; ultimos4: string } | null
  /**
   * Cancelamento pedido e ainda **não consumado** — a janela em que ele já cancelou mas
   * segue com tudo, até a data que comprou. `null` = não há cancelamento em andamento.
   *
   * 🔴 A TELA NÃO SABIA DISSO (11/08). O cancelamento carimbava a data no banco e a tela
   *    seguia idêntica: quem cancelasse e recarregasse não via **nenhum** vestígio — nem
   *    até quando tem acesso, nem que a cobrança parou. Ou seja, a única prova de que o
   *    pedido funcionou era um toast que some em 5 segundos.
   * ⚠️ Só conta com a data no FUTURO. Data passada é histórico: a varredura 1.b já virou o
   *    estado, o cartão já foi apagado, e oferecer "retomar" ali prometeria um clique que
   *    o motor recusa.
   */
  cancelamento: {
    ateQuando: string
    /**
     * O cliente pode desfazer sozinho? `false` = o cancelamento foi decisão NOSSA.
     *
     * 🔴 Sem este campo a tela oferecia "Retomar assinatura" para um cancelamento feito
     *    pelo god mode — e o motor (com razão) recusa. Botão que existe pra dar erro é pior
     *    que botão ausente: ele promete uma saída e devolve uma parede.
     */
    podeRetomar: boolean
  } | null
  /** Módulos que a conta REALMENTE tem ligados, pelo nome do catálogo. */
  incluso:   string[]
  resumo:    AssinaturaResumoData
  conta:     ContaDoMesData
  medidas:   LinhaMedidaData[]
  discretas: LinhaDiscretaData[]
  /** `false` quando o cliente foi ativado à mão (sem gateway) — ver §2 do design. */
  temGateway: boolean
}

/** Recursos que a tela de consumo NÃO mostra: são teto de infra, não consumo do cliente. */
const OCULTOS: ReadonlySet<LimitResource> = new Set<LimitResource>([
  "whatsapp_official", "whatsapp_qr",
])

function mb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(n)} MB`
}

/**
 * Monta a visão de assinatura de um tenant. Memoizado por request — as 4 rotas e o
 * layout podem chamar sem pagar duas vezes.
 */
export const getAssinaturaView = cache(async (tenantId: string): Promise<AssinaturaView> => {
  const [standing, limits, tenantRow, perfil, modulos] = await Promise.all([
    getBillingStanding(tenantId),
    listAllLimits(tenantId),
    supabaseAdmin.from("tenants")
      .select("billing_day, plan_id, asaas_subscription_id, subscription_ends_at, subscription_ended_reason, card_brand, card_last4, plans:plan_id ( name, price_cents, user_quota, extra_user_price_cents )")
      .eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_billing_profile")
      .select("billing_email").eq("tenant_id", tenantId).maybeSingle(),
    // 🔴 "O QUE ESTÁ INCLUSO" VINHA VAZIO (achado do dono, 05/08 — print da tela). O card
    //    era alimentado por `standing.continues`, e as duas coisas respondem perguntas
    //    DIFERENTES: `continues` é *"o que ainda funciona apesar do problema"* — vazio por
    //    definição em conta saudável, porque nada foi cortado —, enquanto o título promete
    //    *"o que sua assinatura te deixa fazer hoje"*. Cliente pagante via um título com
    //    nada embaixo, justo na tela que existe pra justificar a mensalidade.
    // 🔑 A fonte certa é o que o tenant REALMENTE tem ligado, com o nome do catálogo —
    //    mesma verdade que o god mode e a vitrine de planos usam.
    // ⚠️ Consulta mora AQUI, no carregador da tela, e não em `getBillingStanding`: aquele
    //    roda no banner de TODA página do app, e ninguém precisa da lista de módulos pra
    //    desenhar um aviso.
    // 🔴 `active` NÃO EXISTE EM `module_catalog` — e o card sumiu por meses por causa disso
    //    (12/08). As colunas reais são `slug, category, name, description, is_core,
    //    default_on, position, parent_slug`. O PostgREST devolvia **42703**, o `data` vinha
    //    `null`, o `?? []` transformava o erro em lista vazia, e o card "O que está incluso"
    //    desaparecia inteiro — sem erro na tela e sem log.
    // ⚠️ É O MESMO DEFEITO DE 05/08 POR OUTRA PORTA. Lá a lista vinha da fonte errada; aqui
    //    vem da fonte certa com uma coluna inventada. O sintoma é idêntico: cliente pagante
    //    com um título e nada embaixo, na tela que existe pra justificar a mensalidade.
    //    Medido no Moises Pena: **7 módulos ligados, zero exibidos**.
    // 🔑 O `active` foi assumido por analogia com `plans.active`, que existe — mas em outra
    //    tabela. Aqui não há esse conceito: quem decide se o módulo vale pro tenant é
    //    `tenant_modules.enabled`, e a consulta JÁ filtra por ele. Era uma segunda trava que
    //    nunca existiu.
    supabaseAdmin.from("tenant_modules")
      .select("module_slug, module_catalog!inner ( name )")
      .eq("tenant_id", tenantId).eq("enabled", true),
  ])

  // ⚠️ Depende do `tenantRow` acima, então fica fora do `Promise.all`. É uma chamada HTTP
  //    numa tela de baixo tráfego, memoizada por request e fail-soft.
  const cobranca = await getCobrancaDoGateway(
    (tenantRow.data as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id,
  )

  // 🔴 O `error` DESCARTADO É O QUE FEZ ISSO PASSAR. Sem capturá-lo, "a consulta falhou" e
  //    "este cliente não tem módulo nenhum" ficam indistinguíveis — e a segunda é uma frase
  //    plausível, então ninguém desconfia. Foi assim que uma coluna inexistente sobreviveu
  //    em produção: o card sumia e a tela não reclamava.
  // ⚠️ NÃO derruba a página: a lista de módulos é contexto, não o assunto da tela. Ela grita
  //    no log e degrada pra vazio — o mesmo princípio de "execução para, leitura degrada".
  //    O que não pode é degradar em SILÊNCIO.
  if (modulos.error) {
    console.error(JSON.stringify({
      src: "subscription-view", kind: "MODULOS-INCLUSOS-NAO-LIDOS",
      tenant: tenantId, msg: modulos.error.message,
      nota: "o card 'O que está incluso' vai aparecer vazio — isto NÃO significa que o cliente não tem módulos",
    }))
  }

  // 🔴 O MESMO MÓDULO APARECIA DUAS VEZES, COM NOMES DIFERENTES (achado no teste ao vivo,
  //    12/08). `incluso` usa o nome do CATÁLOGO; `paused` usa um rótulo próprio que agrupa
  //    módulos por CONSEQUÊNCIA. Os dois vocabulários nunca foram conciliados, então o
  //    cliente via "Widget do site ✓" e "Chat do site — PAUSADO" (o mesmo `widget_site`), e
  //    "Kora Studio ✓" com "Automações e respostas automáticas — PAUSADO" (o mesmo
  //    `ai_studio`). Sem como saber que são a mesma coisa.
  // ⚠️ Só ficou visível agora porque a lista verde estava QUEBRADA até hoje (a coluna
  //    `active` inexistente). Consertar um bug acendeu a luz em cima do outro.
  // 🔑 A correção é por CONSTRUÇÃO, não por renomear um dos lados: um módulo pertence a UM
  //    grupo. Quem está pausado sai do incluso — e é o slug que decide, não o nome, porque
  //    os nomes é que divergem.
  const slugsPausados = new Set(
    PAUSADO_POR_MODULO.filter((p) => standing.paused.includes(p.label)).flatMap((p) => p.modulos),
  )

  // Nome do catálogo, ordenado — a ordem do banco não significa nada pro cliente.
  const incluso = ((modulos.data ?? []) as unknown as {
    module_slug: string
    module_catalog: { name: string } | { name: string }[] | null
  }[])
    .filter((m) => !slugsPausados.has(m.module_slug))
    .map((m) => (Array.isArray(m.module_catalog) ? m.module_catalog[0] : m.module_catalog))
    .filter((c): c is { name: string } => !!c?.name)
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))

  const t = tenantRow.data as {
    billing_day: number | null
    asaas_subscription_id?: string | null
    subscription_ends_at?: string | null
    subscription_ended_reason?: string | null
    card_brand?: string | null
    card_last4?: string | null
    plans: { name: string; price_cents: number; user_quota: number | null; extra_user_price_cents: number | null } | null
  } | null
  const plano = t?.plans ?? null

  // Cancelamento pedido e ainda não consumado — ver o campo na interface acima.
  const fimMarcado = t?.subscription_ends_at ? new Date(t.subscription_ends_at) : null
  const cancelamento = fimMarcado && !Number.isNaN(fimMarcado.getTime()) && fimMarcado.getTime() > Date.now()
    ? {
        ateQuando: t!.subscription_ends_at as string,
        // ⚠️ Allow-list, espelhando o motor (`resumeSubscriptionForTenant`). Só o que o
        //    próprio cliente pediu é desfeito por ele. Motivo novo nasce **fechado** nas
        //    duas pontas — se divergirem, uma das duas mente na cara do cliente.
        podeRetomar: t!.subscription_ended_reason === "pedido_do_cliente",
      }
    : null

  // ⚠️ O rótulo do cartão só existe se houver ASSINATURA de verdade. Rótulo órfão (que a
  //    revogação deveria ter limpado, ou que sobrou de um cancelamento pelo painel do
  //    Asaas) faria a tela dizer "Mastercard ···· 4242" pra quem não tem o que cobrar.
  // 🔑 …OU cancelamento em andamento (11/08). Nessa janela o vínculo já morreu no gateway
  //    mas o cartão continua guardado de propósito, e o rótulo **não é órfão**: é o cartão
  //    que volta a cobrar se ele clicar em "Retomar". Sem esta segunda perna, a tela dizia
  //    "Cartão: —" e a promessa de um clique parecia mentira antes mesmo do clique.
  const cartao = (assinaturaRealId(t?.asaas_subscription_id) || cancelamento) && /^\d{4}$/.test(t?.card_last4 ?? "")
    ? { bandeira: normalizarBandeira(t?.card_brand), ultimos4: (t?.card_last4 as string) }
    : null

  // ── A única linha que pode virar dinheiro hoje ────────────────
  //
  // 🔴 DUAS COTAS DIFERENTES, E A TELA TEM QUE USAR A DO DINHEIRO (achado do revisor,
  //    2026-08-04). Elas parecem a mesma coisa e não são:
  //      • `tenant_limits.users`  = quanto ele PODE usar (a cortesia concedida no god mode)
  //      • `plans.user_quota`     = quanto está INCLUSO NO PREÇO
  //    Medido na Blue: limite 10, cota de preço 3, 5 usuários ativos. Usando o limite, a
  //    tela mostrava "5 de 10, sem excedente → R$ 449,90"; o motor de fatura
  //    (`billing.ts`, `max(0, users - plan.user_quota)`) geraria **R$ 529,70**.
  //    O cliente veria 449,90 no dia 5 e receberia 529,70 no dia 6 — que é exatamente o
  //    "número que aparece pela primeira vez na fatura", a falha que esta tela existe
  //    pra evitar.
  // ⚠️ A cortesia continua valendo pro LIMITE (ele pode ter 10). Ela só não muda o preço —
  //    e é isso que a tela precisa dizer, porque é isso que vai ser cobrado.
  const usersLimit = limits.find((l) => l.resource === "users")
  const precoExtra = plano?.extra_user_price_cents ?? 0
  const usados     = usersLimit?.used ?? 0
  /** Teto de uso (cortesia/override). Só exibição — não entra na conta. */
  const limiteUso  = usersLimit?.max ?? null
  /** Cota que o PREÇO inclui. É a que o motor de fatura usa, então é a que conta. */
  const cotaUsers  = plano?.user_quota ?? null
  const excedente  = cotaUsers === null ? 0 : Math.max(0, usados - cotaUsers)

  const medidas: LinhaMedidaData[] = [{
    key: "users",
    label: LIMIT_META.users.label,
    unidade: "usuário",
    usado: usados,
    cota: cotaUsers,
    precoUnitCents: precoExtra,
    excedente,
    excedenteCents: excedente * precoExtra,
    // 🔴 Projeção = excedente atual, NÃO uma extrapolação. Usuário não cresce sozinho ao
    //    longo do mês como mensagem cresce — projetar "no ritmo atual" aqui inventaria uma
    //    conta futura a partir de um número que só muda quando alguém convida alguém.
    projecaoCents: excedente * precoExtra,
    // ⛔ "parou" = bateu no TETO DE USO (não dá pra convidar mais ninguém). É outra coisa
    //    que excedente: excedente é serviço prestado e cobrado; parou é porta fechada.
    parou: limiteUso !== null && usados >= limiteUso,
  }]

  // ── Tudo o mais: cota sem preço ───────────────────────────────
  const storage = limits.find((l) => l.resource === "storage_mb")
  const discretas: LinhaDiscretaData[] = []
  for (const l of limits as LimitInfo[]) {
    if (l.resource === "users" || OCULTOS.has(l.resource)) continue
    const meta = LIMIT_META[l.resource]
    const texto = l.resource === "storage_mb"
      ? (l.max === null ? mb(l.used) : `${mb(l.used)} de ${mb(l.max)}`)
      : (l.max === null ? `${l.used}` : `${l.used} de ${l.max}`)
    discretas.push({ key: l.resource, label: meta.label, usado: l.used, cota: l.max, textoUso: texto })
  }

  // Quebra do armazenamento por origem — só se houver o que quebrar.
  if (storage && storage.used > 0) {
    const brk = await getStorageBreakdown(tenantId).catch(() => [])
    const alvo = discretas.find((d) => d.key === "storage_mb")
    if (alvo && brk.length > 0) {
      alvo.detalhe = brk.map((b) => ({ label: b.label, texto: mb(b.bytes / (1024 * 1024)) }))
    }
  }

  // ── A conta do mês ────────────────────────────────────────────
  const planoCents = plano?.price_cents ?? 0
  const extras = excedente > 0
    ? [{ label: `${excedente} usuário${excedente > 1 ? "s" : ""} além da cota`, cents: excedente * precoExtra }]
    : []

  return {
    standing,
    resumo: {
      planoNome:  plano?.name ?? "Sem plano",
      planoCents,
      cicloDia:   t?.billing_day ?? null,
      // 🔴 ERA FIXO EM "A definir", com um comentário dizendo que não havia gateway
      //    integrado — e havia: o cliente podia pagar no cartão e a tela continuava
      //    dizendo "a definir" pra sempre (achado do dono, 05/08). O comentário
      //    envelheceu junto com o código que ele justificava.
      // ⚠️ Deriva do FATO (existe assinatura no gateway?), não de constante. E continua
      //    honesto no outro caso: sem assinatura, "A definir" é a verdade.
      // 🔑 Desde 07/08 diz QUAL cartão (`Mastercard ···· 4242`) e não só "Cartão de
      //    crédito". Quem tem dois cartões não conseguia saber qual estava debitando — e
      //    era essa a pergunta de quem abre esta linha. Degrada pro rótulo genérico quando
      //    não temos os 4 dígitos (assinatura anterior ao registro).
      // ⚠️ O fallback passa por `assinaturaRealId` como todo o resto do arquivo. Lendo o id
      //    cru, um tenant com a RESERVA do claim presa (`pending:…`) lia "Cartão de
      //    crédito" aqui e, duas linhas ao lado, não ganhava o botão de trocar cartão
      //    (`temAssinatura` false) — duas afirmações contraditórias na mesma coluna.
      formaPagamento: rotuloDoCartao(cartao?.bandeira, cartao?.ultimos4)
        ?? (assinaturaRealId(t?.asaas_subscription_id) ? "Cartão de crédito" : "A definir"),
      emailCobranca:  (perfil.data as { billing_email?: string } | null)?.billing_email ?? "",
    },
    incluso,
    cobranca: cobranca ? { valorCents: cobranca.valorCents, proximaEm: cobranca.proximaEm } : null,
    temAssinatura: !!assinaturaRealId(t?.asaas_subscription_id),
    cartao,
    cancelamento,
    conta: {
      planoLabel: plano?.name ?? "Sem plano",
      planoCents,
      extras,
      totalCents: planoCents + extras.reduce((s, e) => s + e.cents, 0),
      fechaEm:    standing.nextClosingAt,
    },
    medidas,
    discretas,
    temGateway: false,   // TODO(asaas): virar `billing_mode === "gateway"` quando a coluna existir
  }
})
