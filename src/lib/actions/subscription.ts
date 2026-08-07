"use server"

import { auth } from "@/auth"
import { podeCobrar, faltamParaCobrar } from "@/lib/billing/fiscal-profile"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIpFromHeaders } from "@/lib/rate-limit"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { createSubscriptionForTenant, updateSubscriptionCard } from "@/lib/asaas/subscriptions"
import { getBillingStanding, type BillingStanding } from "@/lib/billing/standing"
import { abaixoDoMinimoDoCartao, assinaturaRealId } from "@/lib/billing/gateway-limits"

// ═══════════════════════════════════════════════════════════════
// Assinatura — leitura pro app do tenant
// ═══════════════════════════════════════════════════════════════
// Casca fina sobre `lib/billing/standing.ts`. A regra mora LÁ; aqui só se deriva o
// tenant da SESSÃO. Server component pode (e deve) importar `getBillingStanding`
// direto — esta action existe pros client components (banner, sino, cards).

/**
 * O degrau de cobrança do tenant LOGADO.
 *
 * 🔒 `tenantId` vem da sessão, nunca de parâmetro. Uma action que recebesse o tenant
 *    por argumento seria leitura cross-tenant do estado comercial de qualquer cliente
 *    — a classe C-01..C-04 (auditoria 2026-07-30). Por isso ela **não tem parâmetros**.
 *
 * ⚠️ Sem gate de PAPEL, e isso é decisão consciente, não esquecimento: o degrau é
 *    informação OPERACIONAL — é o atendente que descobre, no meio do expediente, que a
 *    IA parou de responder, e ele precisa saber por quê. O que é comercial de verdade é
 *    o VALOR da fatura (`invoice.totalCents`), e hoje ele vai junto pra qualquer membro.
 *    Se a decisão do dono for que só owner/admin vê o valor, o lugar de aplicar é aqui
 *    (zerar `invoice` pra `role === "agent"`) — é uma linha, e é uma pergunta de
 *    produto, não de código. A TELA de assinatura tem o gate dela, à parte.
 *
 * Devolve `null` sem sessão (o chamador não renderiza nada) — nunca lança: este é o
 * caminho de um banner, e derrubar a tela por causa de um aviso é pior que não avisar.
 */
export async function getMyBillingStanding(): Promise<BillingStanding | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null

  const standing = await getBillingStanding(session.user.tenantId)

  // 🔒 ATENDENTE NÃO VÊ VALOR (auditoria 2026-08-05). Toda função exportada de um
  //    arquivo `"use server"` é action PÚBLICA chamável via RSC — as telas de assinatura
  //    redirecionam `agent`, mas a action não filtrava nada: bastava chamar direto pra o
  //    atendente descobrir o valor e o atraso da fatura do patrão.
  // ⚠️ Zera o VALOR, mantém o DEGRAU: o atendente precisa saber que campanhas estão
  //    pausadas (é o trabalho dele), não quanto o dono deve. Devolver `null` inteiro
  //    apagaria o aviso operacional junto com o dado financeiro.
  if (session.user.role === "agent") {
    return { ...standing, invoice: null, trial: null }
  }

  return standing
}

/**
 * Valida a escolha do cliente e libera a tela a seguir pro pagamento. **NÃO PERSISTE NADA.**
 *
 * 🔴 ANTES ELA GRAVAVA `tenants.plan_id` — e isso rotulava como contratante quem só
 *    clicou. Medido na conta do dono (05/08): ele estava no **Trial**, clicou pra ver o
 *    PLANO III e a plataforma passou a dizer *"Plano PLANO III"* no topo e
 *    **"Sua conta do mês: R$ 249,90"** no painel da direita. Uma cobrança que ele não
 *    devia, exibida como se devesse, sem cartão nenhum informado.
 *
 *    A raiz era semântica, não de tela: `plan_id` significa **"o plano que este cliente
 *    TEM"** — ela alimenta rótulo, painel da conta, valor da fatura e `criarAssinatura`.
 *    Eu a usei também pra guardar *"o plano que ele PRETENDE ter"*. Uma coluna com dois
 *    significados: no instante do clique, todo leitor passou a acreditar na intenção como
 *    se fosse fato. E carrinho abandonado é o caso mais comum que existe — todo cliente
 *    que clicasse e desistisse ficaria marcado, e o Trial dele seria sobrescrito.
 *
 * ✅ Agora a escolha VIAJA pelo fluxo (modal → cartão) e só vira `plan_id` no momento em
 *    que vira compromisso de verdade: quando `criarAssinatura` cria a assinatura no
 *    gateway. `plan_id` volta a ter um significado só.
 *
 * ⚠️ A validação continua aqui — e continua valendo, porque o passo do cartão revalida o
 *    mesmo id. Só planos que o GOD MODE deixou compráveis: ativo e com preço. Confiar no
 *    id que veio da tela deixaria o cliente escolher, via RSC, um plano desativado ou o
 *    próprio Trial de R$ 0 — e aí ele "assina" de graça.
 */
export async function escolherPlano(planoId: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Sessão expirada. Entre de novo." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Apenas o responsável pela conta pode escolher o plano." }
  }

  const { data: plano } = await supabaseAdmin
    .from("plans")
    .select("id, price_cents, active")
    .eq("id", planoId)
    .eq("active", true)
    .gt("price_cents", 0)
    .maybeSingle()

  if (!plano) return { error: "Este plano não está disponível. Recarregue a página." }

  // ⚠️ Abaixo do piso do gateway = plano IMPOSSÍVEL de cobrar no cartão. Barra aqui, no
  //    clique, e não depois do cadastro e do cartão digitado: a pessoa não tem como
  //    resolver isso sozinha (o preço é do god mode), então o mínimo é não fazer ela
  //    percorrer a trilha inteira pra descobrir.
  if (abaixoDoMinimoDoCartao((plano as { price_cents?: number }).price_cents)) {
    console.error("[billing] plano abaixo do mínimo do cartão:", planoId)
    return { error: "Este plano está indisponível para contratação. Fale com a gente." }
  }

  // 🔴 SÓ A PRIMEIRA ESCOLHA — furo que eu mesmo abri e fechei no mesmo dia (2026-08-05).
  //
  //    Sem esta guarda, um cliente PAGANTE podia se rebaixar sozinho e ficar com tudo:
  //      1. está no PLANO III (R$ 249,90) com os módulos dele;
  //      2. chama `escolherPlano(PLANO_I)` — passava em todos os gates (owner ✓, plano
  //         ativo ✓, preço > 0 ✓);
  //      3. `applyPlan` é **aditivo e nunca revoga** (só `upsert` com `enabled: true`),
  //         então os módulos do plano caro **ficam**;
  //      4. `generateInvoiceForTenant` lê `plans` AO VIVO ⇒ a próxima fatura sai R$ 99,90.
  //    Resultado: produto de R$ 249,90 por R$ 99,90, self-service, sem tocar no god mode.
  //    E o gateway continuaria cobrando o valor velho (não existe `PUT` de assinatura),
  //    ou seja o livro e o cartão passariam a discordar.
  //
  // ⚠️ Trocar de plano com assinatura ativa **não é escolher plano** — é upgrade/downgrade,
  //    e isso exige proporção, `PUT` no gateway e revogação do que sai. Nada disso existe
  //    ainda. Enquanto não existir, a porta fica fechada em vez de meio aberta.
  const { data: t } = await supabaseAdmin
    .from("tenants")
    .select("asaas_subscription_id, billing_mode")
    .eq("id", session.user.tenantId)
    .maybeSingle()
  const tenant = t as { asaas_subscription_id?: string | null; billing_mode?: string | null } | null

  if (assinaturaRealId(tenant?.asaas_subscription_id)) {
    return { error: "Sua assinatura já está ativa. Para mudar de plano, fale com a gente." }
  }
  // ⚠️ `manual` é governado SÓ pelo god mode (docs/asaas-billing-design.md §2). Deixar o
  //    cliente mexer no próprio `plan_id` mudaria o valor da fatura que a nossa operação
  //    emite à mão — ele escolheria o preço dele.
  if (tenant?.billing_mode !== "gateway") {
    return { error: "A cobrança desta conta é combinada com a nossa equipe." }
  }

  // ⚠️ Nenhuma escrita. O que sai daqui é só um "pode seguir" — quem carimba o plano é a
  //    criação da assinatura. O registro da INTENÇÃO fica no audit log, que é onde
  //    intenção deve morar: ele conta a história sem afirmar um fato comercial.
  await logAudit({
    tenantId:   session.user.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "billing.plan_selected",
    targetType: "tenant",
    targetId:   session.user.tenantId,
    metadata:   { plan_id: planoId },
  })

  revalidatePath("/configuracoes/assinatura")
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════
// Ativar a assinatura no cartão
// ═══════════════════════════════════════════════════════════════

/** Dados do titular já cadastrados — a tela mostra pra CONFERÊNCIA, não pra digitar. */
export interface TitularPreenchido {
  nome: string; email: string; cpfCnpj: string; cep: string; numero: string; telefone: string
  completo: boolean
  /**
   * Rótulos do que falta pra conseguir cobrar — vazio quando `completo`.
   *
   * ⚠️ Calculado AQUI, sobre o perfil cru, e não pelo chamador: as chaves deste objeto são
   *    as da TELA (`cpfCnpj`, `cep`), não as do banco (`tax_id`, `zip`). Recalcular lá fora
   *    acusaria todos os campos como ausentes.
   */
  faltam: string[]
}

/**
 * O que já sabemos do titular. Evita pedir de novo o que o cadastro já coletou —
 * são 6 campos a menos num formulário de cartão, que é onde as pessoas desistem.
 */
export async function getTitularParaCobranca(): Promise<TitularPreenchido | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  if (!["owner", "admin"].includes(session.user.role)) return null

  const { data } = await supabaseAdmin
    .from("tenant_billing_profile")
    .select("legal_name, trade_name, tax_id, billing_email, zip, number, phone")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  const p = (data ?? {}) as Record<string, string | null>
  const t: TitularPreenchido = {
    nome:     (p.legal_name || p.trade_name || "").trim(),
    email:    (p.billing_email || "").trim(),
    cpfCnpj:  (p.tax_id || "").trim(),
    cep:      (p.zip || "").trim(),
    numero:   (p.number || "").trim(),
    telefone: (p.phone || "").trim(),
    completo: false,
    faltam:   faltamParaCobrar(p),
  }
  // ⚠️ O Asaas EXIGE cpfCnpj, cep, número E TELEFONE no `creditCardHolderInfo`. Sem eles a
  //    tokenização falha com erro do gateway — melhor a tela saber ANTES e mandar o
  //    cliente completar o cadastro do que ele digitar o cartão e levar erro genérico.
  //
  // 🔴 O TELEFONE FALTAVA NESTA LISTA — e a falta era invisível de propósito ruim: ele é
  //    obrigatório lá, ninguém checava aqui, e o campo não aparecia no cadastro rápido.
  //    Resultado medido (05/08): cartão digitado, cobrança recusada com *"Celular informado
  //    é inválido"* — sobre um dado que a pessoa não via, não tinha preenchido e não tinha
  //    onde corrigir. `completo` é a promessa "dá pra cobrar"; ela estava mentindo.
  // ⚠️ Valida a FORMA, não só a presença: um telefone guardado mas inválido reproduz
  //    exatamente o mesmo erro, com o mesmo cartão já digitado.
  t.completo = podeCobrar(p)
  return t
}

/**
 * Ativa a assinatura recorrente com o cartão informado.
 *
 * 🔒 `tenantId` da SESSÃO, nunca de parâmetro (classe C-01..C-04). Gate de papel:
 *    contratar é ato comercial — owner/admin, nunca atendente.
 * 🔴 PCI: os dados do cartão entram, vão para a tokenização e **morrem aqui**. Nenhum
 *    `console.*` desta função recebe o cartão; o retorno nunca ecoa o que foi digitado.
 */
export async function ativarAssinatura(input: {
  holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string
  /** Plano escolhido no passo anterior. Revalidado aqui — a tela não é fonte de verdade. */
  planoId: string
}): Promise<{ ok: true; id: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Sessão expirada. Entre de novo." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Apenas o responsável pela conta pode ativar a assinatura." }
  }

  // 🔴 REVALIDAR O PLANO AQUI, não só no passo anterior. Desde que `escolherPlano` parou de
  //    persistir, o id do plano chega pela REDE junto com o cartão — e isto é uma Server
  //    Action pública. Confiar no que a tela mandou seria deixar o cliente montar a
  //    requisição à mão com o id do Trial (R$ 0) ou de um plano que o god mode desativou, e
  //    assinar o produto caro pagando outro preço. O gate é o mesmo do `escolherPlano`:
  //    ativo e com preço > 0.
  const { data: planoOk } = await supabaseAdmin
    .from("plans")
    .select("id")
    .eq("id", input.planoId)
    .eq("active", true)
    .gt("price_cents", 0)
    .maybeSingle()

  if (!planoOk) return { error: "Este plano não está disponível. Recarregue a página." }

  const titular = await getTitularParaCobranca()
  if (!titular?.completo) {
    // 🔴 A mensagem antiga era FIXA — *"Complete os dados de faturamento (CNPJ, CEP e
    //    número)"* — e mandou o dono procurar defeito nos três campos que ele tinha
    //    preenchidos, enquanto o que faltava era o telefone (05/08). Erro que nomeia o
    //    campo errado é pior que erro genérico: ele custa tempo e confiança.
    const faltam = titular?.faltam ?? []
    return { error: faltam.length
      ? `Falta completar: ${faltam.join(", ")}.`
      : "Complete os dados de faturamento antes de ativar." }
  }

  const ip = getClientIpFromHeaders(await headers())

  // 🔴 TETO DE TENTATIVAS — ANTI CARD-TESTING (achado de auditoria PCI, 2026-08-05).
  //
  //    Sem isto, esta action era um **oráculo de teste de cartão rodando na NOSSA conta
  //    merchant**, e a cadeia era explorável sem nenhum insider: qualquer um cria conta no
  //    signup self-serve (que carimba `billing_mode: "gateway"` e faz o autor `owner`),
  //    completa o próprio cadastro fiscal em /configuracoes/empresa — único gate real — e
  //    passa a chamar isto à vontade, lendo a resposta do gateway pra separar PAN válido de
  //    inválido. A idempotência de `createSubscriptionForTenant` só morde DEPOIS de existir
  //    assinatura; antes disso as tentativas eram ilimitadas.
  //
  //    O dano não é o custo: é o Asaas bloquear nossa conta por enumeração e **derrubar a
  //    cobrança de TODOS os clientes** — mais responsabilidade de fraude e escopo PCI.
  //
  // ⚠️ Dois baldes de propósito: por TENANT (o alvo real) e por IP (impede rodar o mesmo
  //    ataque criando várias contas). 3/hora é folga enorme pra uso humano — quem erra o
  //    cartão 3 vezes numa hora tem um problema com o cartão, não com o formulário.
  // ⚠️ O contraste que denunciou a falta: `saveMyCompanyProfile` JÁ tinha teto — por um
  //    motivo MENOR (cota de API do gateway) do que o desta aqui.
  if (!rateLimit(`card:tenant:${session.user.tenantId}`, 3, 60 * 60_000).ok) {
    return { error: "Muitas tentativas de cartão. Aguarde alguns minutos e tente de novo." }
  }
  if (ip && !rateLimit(`card:ip:${ip}`, 5, 60 * 60_000).ok) {
    return { error: "Muitas tentativas de cartão. Aguarde alguns minutos e tente de novo." }
  }

  const r = await createSubscriptionForTenant(
    session.user.tenantId,
    input.planoId,
    {
      holderName:  input.holderName.trim(),
      number:      input.number,
      expiryMonth: input.expiryMonth,
      expiryYear:  input.expiryYear,
      ccv:         input.ccv,
    },
    {
      name:          titular.nome,
      email:         titular.email,
      cpfCnpj:       titular.cpfCnpj,
      postalCode:    titular.cep,
      addressNumber: titular.numero,
      phone:         titular.telefone,
    },
    ip,
  )

  if ("error" in r) return { error: r.error }
  revalidatePath("/configuracoes/assinatura")
  return { ok: true, id: r.id }
}

/**
 * Troca o cartão da assinatura vigente. **Não cobra nada.**
 *
 * 🔴 O produto não tinha esse caminho (07/08). Cartão vencido = cliente sem saída: o
 *    gateway recusa a renovação, a escada corta o produto, e ele não tinha onde atualizar.
 *    O aviso de "cartão recusado" que vamos mandar por e-mail só faz sentido com esta
 *    tela existindo — senão é aviso que aponta pra lugar nenhum.
 *
 * 🔒 As MESMAS quatro paredes de `ativarAssinatura`, e pelo mesmo motivo: isto também é um
 *    oráculo de validação de cartão rodando na nossa conta merchant. Quem tiver sessão de
 *    owner poderia testar PANs em série lendo a resposta do gateway.
 *      1. sessão · 2. papel (owner/admin) · 3. cadastro fiscal completo · 4. teto por
 *      tenant E por IP.
 * ⚠️ O balde é o MESMO da ativação (`card:tenant:` / `card:ip:`), de propósito: são duas
 *    portas pro mesmo oráculo, e baldes separados dobrariam o orçamento do atacante.
 */
export async function trocarCartaoDaAssinatura(input: {
  holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string
}): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Sessão expirada. Entre de novo." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Apenas o responsável pela conta pode trocar o cartão." }
  }

  // ⚠️ O gateway exige o titular completo pra tokenizar — igual à contratação. Sem isto o
  //    cliente digitaria o cartão inteiro pra receber um erro que a gente já sabia.
  const titular = await getTitularParaCobranca()
  if (!titular?.completo) {
    const faltam = titular?.faltam ?? []
    return { error: faltam.length
      ? `Falta completar: ${faltam.join(", ")}.`
      : "Complete os dados de faturamento antes de trocar o cartão." }
  }

  const ip = getClientIpFromHeaders(await headers())
  if (!rateLimit(`card:tenant:${session.user.tenantId}`, 3, 60 * 60_000).ok) {
    return { error: "Muitas tentativas de cartão. Aguarde alguns minutos e tente de novo." }
  }
  if (ip && !rateLimit(`card:ip:${ip}`, 5, 60 * 60_000).ok) {
    return { error: "Muitas tentativas de cartão. Aguarde alguns minutos e tente de novo." }
  }

  const r = await updateSubscriptionCard(
    session.user.tenantId,
    {
      holderName:  input.holderName.trim(),
      number:      input.number,
      expiryMonth: input.expiryMonth,
      expiryYear:  input.expiryYear,
      ccv:         input.ccv,
    },
    {
      name:          titular.nome,
      email:         titular.email,
      cpfCnpj:       titular.cpfCnpj,
      postalCode:    titular.cep,
      addressNumber: titular.numero,
      phone:         titular.telefone,
    },
    ip,
  )

  if ("error" in r) return { error: r.error }

  await logAudit({
    tenantId:   session.user.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "billing.card_updated",
    targetType: "tenant",
    targetId:   session.user.tenantId,
    // ⚠️ Nada do cartão no audit. Nem os 4 últimos: o log é lido por gente que não precisa.
    metadata:   {},
  })

  revalidatePath("/configuracoes/assinatura")
  return { ok: true }
}
