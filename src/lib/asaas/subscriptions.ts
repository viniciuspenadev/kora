import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { isMobilePhoneBR } from "@/lib/masks"
import { asaas, AsaasError } from "./client"
import { ensureAsaasCustomer } from "./customers"

// ═══════════════════════════════════════════════════════════════
// Assinatura recorrente no cartão
// ═══════════════════════════════════════════════════════════════
// docs/asaas-billing-design.md §2.1 e §7
//
// 🔴 PCI — AS TRÊS REGRAS DESTE ARQUIVO, e elas valem mais que qualquer feature:
//    1. O cartão entra por parâmetro, é usado UMA vez pra tokenizar, e **nunca sai daqui**.
//    2. **Nada de cartão é persistido** — nem coluna, nem cache, nem log. Guardamos só o
//       `creditCardToken`, que é um identificador opaco e inútil fora da conta Asaas.
//    3. **Nenhum `console.*` deste arquivo pode receber o objeto do cartão**, nem em catch.
//       O `client.ts` já loga só a forma; o `REDACT_PATHS` do logger é a segunda parede.
//    Cartão em log é o achado que encerra uma auditoria — e ele nasce de um `catch (e)`
//    que despeja contexto, não de má intenção.

/** Dados do cartão — trafegam em memória, por uma chamada, e morrem aqui. */
export interface CardInput {
  holderName:  string
  number:      string
  expiryMonth: string
  expiryYear:  string
  ccv:         string
}

/** Dados do portador que o Asaas exige junto do cartão (anti-fraude). */
export interface HolderInput {
  name:          string
  email:         string
  cpfCnpj:       string
  postalCode:    string
  addressNumber: string
  phone:         string
}

const digits = (s: string) => (s ?? "").replace(/\D/g, "")

/**
 * Cria a assinatura recorrente do tenant.
 *
 * 🔑 `nextDueDate = fim do trial` — é o que faz o **fim do teste e a primeira cobrança
 *    serem o mesmo dia**, sem orquestrar dois eventos. A doc do Asaas confirma
 *    explicitamente: *"a primeira cobrança será criada utilizando a data informada em
 *    `nextDueDate`; isso permite implementar períodos de trial"*.
 *
 * ⚠️ O cron de trial já sabe pular quem tem `asaas_subscription_id` — sem isso, ele
 *    suspenderia às 05h05 BRT um cliente que o Asaas cobraria no mesmo dia.
 */
export async function createSubscriptionForTenant(
  tenantId: string,
  /**
   * Plano a contratar. **Vem por parâmetro, não de `tenants.plan_id`** (mudança 05/08).
   *
   * 🔑 `plan_id` só passa a valer QUANDO a assinatura existe — é aqui que "escolheu" vira
   *    "contratou". Antes, a escolha era gravada lá no clique, e quem só olhou o catálogo
   *    aparecia como cliente do plano caro, com a conta do mês exibindo um valor que ele
   *    não devia.
   */
  planoId: string,
  card: CardInput,
  holder: HolderInput,
  remoteIp: string,
): Promise<{ id: string } | { error: string }> {
  // 1 · Cliente no gateway (idempotente).
  const cust = await ensureAsaasCustomer(tenantId)
  if ("error" in cust) return cust

  // 2 · Estado do tenant: ciclo e data da primeira cobrança.
  const [{ data: row, error: tErr }, { data: planoRow }] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("id, name, billing_day, trial_ends_at, asaas_subscription_id, billing_mode")
      .eq("id", tenantId)
      .maybeSingle(),
    // ⚠️ Terceira revalidação do plano (tela → action → aqui). Não é paranoia repetida: este
    //    motor também é chamado de fora da action, e um preço errado aqui vira cobrança
    //    recorrente errada no cartão de um cliente real.
    supabaseAdmin
      .from("plans")
      .select("id, name, price_cents")
      .eq("id", planoId)
      .eq("active", true)
      .maybeSingle(),
  ])

  if (tErr)  return { error: "Não foi possível ler o cliente." }
  if (!row)  return { error: "Cliente não encontrado." }

  const t = row as unknown as {
    name: string; billing_day: number | null; trial_ends_at: string | null
    asaas_subscription_id: string | null; billing_mode: string | null
  }
  const plano = planoRow as { id: string; name: string; price_cents: number } | null
  if (!plano) return { error: "Plano indisponível. Escolha um plano antes de ativar." }

  // ⚠️ Idempotência: assinatura já existe ⇒ devolve. Criar a segunda faria o cliente ser
  //    cobrado DUAS vezes por mês, e o segundo id sobrescreveria o primeiro — deixando a
  //    cobrança órfã rodando sem ninguém saber.
  if (t.asaas_subscription_id) return { id: t.asaas_subscription_id }

  // ⚠️ Cliente `manual` não entra no gateway — §2 do design. Criar assinatura pra quem foi
  //    ativado à mão começaria a cobrar alguém que o dono decidiu não cobrar.
  if (t.billing_mode !== "gateway") {
    return { error: "Este cliente está em cobrança manual. Ajuste no god mode antes." }
  }

  const valorCents = plano?.price_cents ?? 0
  if (valorCents <= 0) {
    // 🔴 Guarda contra a tabela de preço invertida (Trial R$ 0 com 18 módulos). Criar
    //    assinatura de R$ 0,00 produziria cobrança de zero todo mês, para sempre, e
    //    pareceria que a cobrança "está funcionando".
    return { error: "O plano deste cliente está com preço zero. Corrija o plano antes de cobrar." }
  }

  // 3 · Tokeniza — o cartão passa por aqui UMA vez e vira um identificador opaco.
  let creditCardToken: string
  try {
    const tok = await asaas.post<{ creditCardToken?: string }>("/creditCard/tokenize", {
      customer: cust.id,
      creditCard: {
        holderName:  card.holderName,
        number:      digits(card.number),
        expiryMonth: card.expiryMonth,
        expiryYear:  card.expiryYear,
        ccv:         card.ccv,
      },
      creditCardHolderInfo: {
        name:          holder.name,
        email:         holder.email,
        cpfCnpj:       digits(holder.cpfCnpj),
        postalCode:    digits(holder.postalCode),
        addressNumber: holder.addressNumber,
        // 🔴 CELULAR VAI EM `mobilePhone`, NÃO EM `phone` (05/08). Na doc do Asaas
        //    `phone` é *"Telefone com DDD do titular"* — FIXO — e `mobilePhone` é o
        //    celular. Mandando um número de 11 dígitos no campo do fixo, o gateway o
        //    reconhece como celular e o valida como tal: a cobrança voltou com
        //    *"Celular informado é inválido"*, um erro que não dizia qual campo consertar.
        // ⚠️ O mesmo número vai nos dois quando só há celular — `phone` é obrigatório e o
        //    dono de PME brasileiro em geral não tem fixo. Repetir é honesto: é o telefone
        //    dele; inventar um fixo pra preencher, não seria.
        ...(isMobilePhoneBR(holder.phone)
          ? { phone: digits(holder.phone), mobilePhone: digits(holder.phone) }
          : { phone: digits(holder.phone) }),
      },
      remoteIp,
    })
    if (!tok?.creditCardToken) return { error: "O gateway não devolveu o token do cartão." }
    creditCardToken = tok.creditCardToken
  } catch (e) {
    // ⚠️ Só a MENSAGEM do erro. Nunca o objeto `card`, nunca o payload.
    return { error: e instanceof AsaasError ? e.message : "Não foi possível validar o cartão." }
  }

  // 4 · Assinatura. Daqui pra frente só o token circula.
  const nextDueDate = primeiraCobranca(t.trial_ends_at, t.billing_day)
  try {
    const sub = await asaas.post<{ id?: string }>("/subscriptions", {
      customer:          cust.id,
      billingType:       "CREDIT_CARD",
      value:             valorCents / 100,          // o Asaas trabalha em reais
      nextDueDate,
      cycle:             "MONTHLY",
      description:       `Kora — plano ${plano?.name ?? ""}`.trim(),
      externalReference: tenantId,                  // 🔑 filtro de tenancy do webhook
      creditCardToken,
      remoteIp,
    })
    if (!sub?.id) return { error: "O gateway não devolveu o id da assinatura." }

    // 🔴 `billing_day` NASCE AQUI (2026-08-05). Sem isto, o motor de fatura nunca
    //    alcança o cliente: `runMonthlyBilling` filtra `.eq("billing_day", hoje)` e NULL
    //    não casa com inteiro nenhum. Medido em produção: **4 dos 5 tenants com
    //    `billing_day` nulo**, e o único escritor no código inteiro era a mão do god mode.
    //    Ou seja: o cliente punha o cartão, o Asaas cobrava todo mês, e a Kora **nunca
    //    emitia fatura** — histórico vazio, nenhuma linha `paid`, e o cancelamento caindo
    //    no fallback "sem evidência de ciclo pago, corte imediato".
    // 🔑 O dia vem da PRIMEIRA COBRANÇA, não de "hoje": é a data que o gateway vai
    //    repetir todo mês. Qualquer outro valor faria o nosso ciclo e o dele divergirem
    //    desde o primeiro dia.
    // ⚠️ Teto em 28 — mesma regra de `currentPeriod` (billing.ts). Dia 29-31 não existe
    //    em todo mês, e o cron casa por igualdade exata: `billing_day=31` ficaria 5 meses
    //    por ano sem faturar, em silêncio.
    const diaDaCobranca = Math.min(28, Number(nextDueDate.slice(8, 10)) || 1)

    // 🔑 `plan_id` NASCE AQUI TAMBÉM — e este é o ponto exato em que "escolheu" vira
    //    "contratou". Gravar antes (no clique do catálogo) foi o bug de 05/08: rotulava
    //    como cliente do PLANO III quem estava em Trial e só tinha olhado o preço.
    //    Aqui a afirmação é verdadeira: existe assinatura no gateway, com valor e cartão.
    const { error: upErr } = await supabaseAdmin
      .from("tenants")
      .update({ asaas_subscription_id: sub.id, billing_day: diaDaCobranca, plan_id: plano.id })
      .eq("id", tenantId)

    // ⚠️ Criada lá e não gravada aqui = assinatura cobrando sem a Kora saber. Devolve o id
    //    na mensagem pra recuperação manual ser possível — sem ele, ninguém acha.
    if (upErr) {
      console.error("[asaas] assinatura criada mas NÃO vinculada:", tenantId, sub.id, upErr.message)
      return { error: `Assinatura criada no gateway (${sub.id}) mas não vinculada. Contate o suporte.` }
    }

    console.log(JSON.stringify({ src: "asaas", kind: "assinatura-criada", tenant: tenantId, subscription: sub.id }))
    return { id: sub.id }
  } catch (e) {
    return { error: e instanceof AsaasError ? e.message : "Não foi possível criar a assinatura." }
  }
}

/**
 * Data da primeira cobrança (`YYYY-MM-DD`).
 *
 * 1. **Fim do trial**, quando existe — o teste acabar É a cobrança acontecer.
 * 2. Senão, o próximo `billing_day` do tenant.
 * 3. Senão, daqui a 30 dias.
 *
 * ⚠️ FUSO: o Asaas opera em `America/Sao_Paulo` e recebe uma DATA, não um instante.
 *    Cortar um ISO em UTC com `.slice(0,10)` erra o dia pra trials que vencem entre 21h e
 *    24h de Brasília — o revisor mediu isso na EVVICAMP (`trial_ends_at` 01:01Z = dia 4 no
 *    Brasil, dia 5 em UTC), e o efeito seria cobrar um dia depois do fim do teste.
 */
function primeiraCobranca(trialEndsAt: string | null, billingDay: number | null): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(d)

  // 🔴 NUNCA UMA DATA NO PASSADO (05/08). O ramo abaixo devolvia o fim do trial cru — e
  //    quem assina DEPOIS que o teste venceu (`trial_ended`, o caso mais comum de todos:
  //    a pessoa travou, viu o modal e resolveu pagar) tem `trial_ends_at` no passado. O
  //    gateway recusa `nextDueDate` retroativo, então a assinatura simplesmente não era
  //    criada — o cliente digitava o cartão e levava um erro do Asaas no fim da trilha.
  // 🔑 Piso em HOJE: o teste já acabou, então cobrar hoje é exatamente o combinado
  //    ("o fim do teste e a primeira cobrança são o mesmo dia"). Para quem ainda está no
  //    teste nada muda — a data futura passa intacta.
  const hojeStr = fmt(new Date())
  if (trialEndsAt) {
    const fim = new Date(trialEndsAt)
    if (!Number.isNaN(fim.getTime())) {
      const d = fmt(fim)
      return d < hojeStr ? hojeStr : d
    }
  }

  const hoje = new Date()
  if (billingDay && billingDay >= 1 && billingDay <= 31) {
    const alvo = new Date(hoje)
    alvo.setUTCDate(billingDay)
    if (alvo <= hoje) alvo.setUTCMonth(alvo.getUTCMonth() + 1)
    return fmt(alvo)
  }

  return fmt(new Date(hoje.getTime() + 30 * 86_400_000))
}
