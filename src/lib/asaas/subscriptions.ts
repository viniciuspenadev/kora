import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { isMobilePhoneBR } from "@/lib/masks"
import { asaas, AsaasError, mensagemSeguraDoGateway } from "./client"
import { ensureAsaasCustomer } from "./customers"
import { abaixoDoMinimoDoCartao, assinaturaRealId, novaReservaDeClaim } from "@/lib/billing/gateway-limits"
import { encryptSecret } from "@/lib/crypto/secrets"
import { detectarBandeira, normalizarBandeira, ultimos4, type Bandeira } from "@/lib/billing/card-brand"

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

// ── Rótulo do cartão (bandeira + 4 últimos) ─────────────────────────────────
//
// 🔒 RÓTULO ≠ CREDENCIAL, e a diferença governa o tratamento. O `creditCardToken` permite
//    COBRAR, então vai cifrado. Bandeira e 4 últimos permitem RECONHECER — é o mesmo dado
//    que o cliente lê na fatura do banco dele — e vão em claro. Cifrar rótulo criaria a
//    ilusão de proteção sobre algo que não é segredo de ninguém.
// ⚠️ O PAN completo, a validade e o CVV continuam **exclusivamente** com o gateway (regra
//    2 do topo deste arquivo). `ultimos4` corta em 4 dígitos venha o dado de onde vier.

/** O que a tokenização devolve. Só os campos que a gente usa — o resto é ignorado. */
interface RespostaTokenize {
  creditCardToken?:  string
  /** Já vem MASCARADO pelo Asaas (só os 4 últimos). Passa por `ultimos4` mesmo assim. */
  creditCardNumber?: string
  creditCardBrand?:  string
}

/**
 * A assinatura deste tenant existe no gateway? Pergunta pelo `externalReference`.
 *
 * 🔴 EXISTE PORQUE TIMEOUT NÃO É "NÃO CRIOU" (achado da auditoria, 07/08). O `catch` da
 *    criação soltava a reserva do claim para QUALQUER exceção — inclusive o `AbortError`
 *    dos 20s de timeout. Só que o Asaas pode ter criado a assinatura e, como a primeira
 *    cobrança é **hoje**, já ter debitado o cartão. A pessoa lia um erro, o teto permitia
 *    mais 2 tentativas na hora, e a segunda criava uma **SEGUNDA assinatura mensal** —
 *    exatamente o dano que o claim atômico foi escrito pra impedir, entrando pela porta
 *    que o próprio tratamento de erro abria. A primeira cobrava pra sempre, invisível.
 *
 * 🔑 `externalReference` já era gravado na criação e **ninguém consultava**. Agora ele é a
 *    rede embaixo: antes de liberar a vaga, a gente PERGUNTA.
 *
 * ⚠️ Devolve `undefined` quando a própria consulta falha — e isso é diferente de `null`
 *    ("perguntei, não existe"). Quem chama precisa tratar os três casos: existe, não
 *    existe, e não sei. Colapsar "não sei" em "não existe" reintroduz o bug inteiro.
 */
export async function procurarAssinaturaNoGateway(tenantId: string): Promise<string | null | undefined> {
  try {
    const r = await asaas.get<{ data?: Array<{ id?: string; status?: string }> }>(
      `/subscriptions?externalReference=${encodeURIComponent(tenantId)}&limit=10`,
    )
    const viva = (r?.data ?? []).find((s) => s?.id && s.status !== "INACTIVE" && s.status !== "EXPIRED")
    return viva?.id ?? null
  } catch (e) {
    console.error("[asaas] não consegui corroborar assinatura:", tenantId, (e as Error).message)
    return undefined
  }
}

/** Piso: o que dá pra saber do número digitado, sem depender da resposta do gateway. */
function rotuloDoCartaoDigitado(numero: string): { bandeira: Bandeira | null; ultimos4: string | null } {
  return { bandeira: detectarBandeira(numero), ultimos4: ultimos4(numero) }
}

/**
 * Teto: o que o GATEWAY diz, com o palpite local de reserva.
 *
 * 🔑 Quem processou o cartão sabe a bandeira sem depender de tabela de prefixo nenhuma —
 *    e a nossa tabela, por melhor que fique, é sempre um retrato desatualizado das faixas
 *    de emissão (Elo e Hipercard mudam). Quando o Asaas informa, ele ganha.
 * ⚠️ Mas ele nem sempre informa, e um campo ausente não pode apagar o rótulo: sem o
 *    fallback, a tela voltaria a não saber dizer qual cartão cobra o cliente.
 */
function rotuloDoGateway(tok: RespostaTokenize, numero: string): { bandeira: Bandeira | null; ultimos4: string | null } {
  const local = rotuloDoCartaoDigitado(numero)
  return {
    bandeira: normalizarBandeira(tok.creditCardBrand) ?? local.bandeira,
    ultimos4: ultimos4(tok.creditCardNumber) ?? local.ultimos4,
  }
}

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
  // 1 · Estado do tenant: ciclo e data da primeira cobrança.
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
  // ⚠️ `assinaturaRealId` filtra a reserva do claim: devolver `pending:…` aqui fazia a
  //    action responder `{ok:true}` e a tela anunciar COMPRA FEITA sem assinatura nenhuma.
  const jaExiste = assinaturaRealId(t.asaas_subscription_id)
  if (jaExiste) return { id: jaExiste }

  // 🔴 CLAIM ATÔMICO (05/08). O `if` acima é *check-then-act* e a janela até a criação no
  //    gateway tem DUAS chamadas HTTP (tokenizar + criar). Duas requisições concorrentes —
  //    duas abas, replay do POST da Server Action, clique depois de um timeout aparente —
  //    liam `null` juntas e criavam DUAS assinaturas mensais; o segundo `update`
  //    sobrescrevia o id e **a primeira cobrava o cartão para sempre, invisível pra nós**.
  //    O rate limit não ajuda: ele autoriza 3 por hora, não serializa 2 simultâneas.
  // 🔑 Reserva a vaga no banco ANTES de falar com o gateway: só uma das concorrentes
  //    consegue o UPDATE condicional. É o mesmo padrão do claim de cota de IA.
  // ⚠️ O marcador `pending:` é limpo em TODO caminho de saída daqui pra frente — senão uma
  //    falha de cartão deixaria o cliente permanentemente incapaz de assinar.
  const reserva = novaReservaDeClaim()
  const { data: claimed } = await supabaseAdmin
    .from("tenants")
    .update({ asaas_subscription_id: reserva })
    .eq("id", tenantId)
    .is("asaas_subscription_id", null)
    .select("id")

  if (!claimed || claimed.length === 0) {
    return { error: "Já existe uma ativação em andamento para esta conta. Aguarde alguns segundos." }
  }

  /** Devolve a vaga quando a ativação não chega ao fim. */
  const soltarReserva = async () => {
    await supabaseAdmin.from("tenants")
      .update({ asaas_subscription_id: null })
      .eq("id", tenantId)
      .eq("asaas_subscription_id", reserva)
  }

  // ⚠️ Cliente `manual` não entra no gateway — §2 do design. Criar assinatura pra quem foi
  //    ativado à mão começaria a cobrar alguém que o dono decidiu não cobrar.
  if (t.billing_mode !== "gateway") {
    await soltarReserva()
    return { error: "Este cliente está em cobrança manual. Ajuste no god mode antes." }
  }

  const valorCents = plano?.price_cents ?? 0
  // ⚠️ Piso do GATEWAY no ponto de EXECUÇÃO (05/08). A guarda existia só na vitrine e no
  //    god mode — o motor aceitava, e quem barrava era o Asaas, com o cartão já digitado e
  //    uma tentativa do teto anti card-testing queimada. Controle de terceiro não é o nosso.
  if (abaixoDoMinimoDoCartao(valorCents)) {
    await soltarReserva()
    return { error: "Este plano está indisponível para contratação. Fale com a gente." }
  }
  if (valorCents <= 0) {
    // 🔴 Guarda contra a tabela de preço invertida (Trial R$ 0 com 18 módulos). Criar
    //    assinatura de R$ 0,00 produziria cobrança de zero todo mês, para sempre, e
    //    pareceria que a cobrança "está funcionando".
    await soltarReserva()
    return { error: "O plano deste cliente está com preço zero. Corrija o plano antes de cobrar." }
  }

  // 2 · Cliente no gateway (idempotente) — DEPOIS do claim atômico (07/08). Antes, esta
  //    chamada rodava ANTES da reserva: duas ativações concorrentes do mesmo tenant criavam
  //    DOIS customers no Asaas antes de qualquer uma travar a vaga. Agora só o vencedor do
  //    claim — já validado billing_mode/piso/preço — cria o customer.
  // ⚠️ Falha aqui (sem CPF/CNPJ, erro de gateway) DEVE soltar a reserva antes de retornar,
  //    senão o marcador `pending:` fica preso e o tenant nunca mais consegue assinar.
  const cust = await ensureAsaasCustomer(tenantId)
  if ("error" in cust) { await soltarReserva(); return cust }

  // 3 · Tokeniza — o cartão passa por aqui UMA vez e vira um identificador opaco.
  let creditCardToken: string
  let rotulo = rotuloDoCartaoDigitado(card.number)
  try {
    const tok = await asaas.post<RespostaTokenize>("/creditCard/tokenize", {
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
    if (!tok?.creditCardToken) { await soltarReserva(); return { error: "O gateway não devolveu o token do cartão." } }
    creditCardToken = tok.creditCardToken
    rotulo = rotuloDoGateway(tok, card.number)
  } catch (e) {
    // ⚠️ Só a MENSAGEM do erro. Nunca o objeto `card`, nunca o payload.
    // 🔒 E a mensagem passa por `mensagemSeguraDoGateway`: recusa vira UMA frase, sempre a
    //    mesma. Devolver o motivo exato do banco transformaria esta action num oráculo de
    //    teste de cartão — o motivo cru fica no log do servidor, abaixo.
    console.error("[asaas] tokenize recusado:", tenantId, (e as Error).message)
    await soltarReserva()
    return { error: mensagemSeguraDoGateway(e, "Não foi possível validar o cartão.") }
  }

  // 🔴 CIFRA AGORA, ANTES DE O GATEWAY CRIAR QUALQUER COISA (P0-1 do pentest 08/08).
  //
  //    A cifragem morava lá embaixo, dentro do objeto do `.update()` — ou seja, ela rodava
  //    DEPOIS de a assinatura existir e o cartão ter sido debitado (a 1ª cobrança é hoje).
  //    `encryptSecret` **lança em produção** quando a `ENCRYPTION_KEY` some ou quebra
  //    (fail-closed deliberado, `crypto/secrets.ts`), e essa exceção não é `AsaasError`:
  //    ela escapava por baixo do tratamento de rede logo abaixo, caía no `soltarReserva()`
  //    e devolvia a vaga. A pessoa via "não foi possível criar a assinatura", tentava de
  //    novo (o teto permite 3/h) e nascia uma **SEGUNDA assinatura mensal**, com a
  //    primeira cobrando invisível. Bastava uma variável de ambiente errada num deploy.
  //
  // 🔑 Cifrando aqui, a única falha possível acontece quando **nada foi criado ainda** —
  //    soltar a vaga passa a ser sempre a coisa certa. É uma linha de lugar, e ela é a
  //    diferença entre "erro" e "cobrança em dobro".
  // ⚠️ Guarde a regra: depois que `sub.id` existir, NENHUMA operação local pode ficar
  //    entre a criação e a gravação. Se precisar de uma, ela vem pra cá.
  let tokenCifrado: string
  try {
    tokenCifrado = encryptSecret(creditCardToken)
  } catch (e) {
    console.error("[asaas] cifragem do token falhou ANTES de criar:", tenantId, (e as Error).message)
    await soltarReserva()
    return { error: "Não foi possível concluir com segurança. Tente de novo em instantes." }
  }

  // 4 · Assinatura. Daqui pra frente só o token circula.
  const nextDueDate = primeiraCobranca()
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
    if (!sub?.id) { await soltarReserva(); return { error: "O gateway não devolveu o id da assinatura." } }

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
      .update({
        asaas_subscription_id: sub.id,
        billing_day: diaDaCobranca,
        plan_id: plano.id,
        // 🔒 CIFRADO. Guardar o token é o que permite cobrar a diferença de um upgrade e
        //    retentar cobrança recusada sem pedir o cartão de novo. Não é dado de cartão:
        //    é identificador opaco, válido só na nossa conta Asaas e só pra este cliente.
        //    Racional completo em `20260807_asaas_card_token.sql`.
        asaas_card_token: tokenCifrado,
        // 🔑 RÓTULO, não credencial: bandeira e 4 últimos são o que a tela precisa pra
        //    dizer QUAL cartão cobra este cliente — o mesmo dado da fatura do banco dele.
        //    Escritos juntos com o token, de propósito: rótulo sem credencial mentiria
        //    ("Mastercard ···· 4242" pra uma assinatura que não existe mais).
        card_brand: rotulo.bandeira,
        card_last4: rotulo.ultimos4,
        // 🔑 Recontratação: sem limpar, a varredura 1.b do housekeeping marcaria `canceled`
        //    na data antiga — derrubando quem acabou de pagar de novo.
        subscription_ends_at: null,
      })
      .eq("id", tenantId)

    // ⚠️ Criada lá e não gravada aqui = assinatura cobrando sem a Kora saber. Devolve o id
    //    na mensagem pra recuperação manual ser possível — sem ele, ninguém acha.
    if (upErr) {
      // ⚠️ NÃO solta a reserva aqui, de propósito: a assinatura EXISTE no gateway. Liberar
      //    a vaga deixaria o cliente tentar de novo e criar uma SEGUNDA cobrança mensal —
      //    o dano exato que o claim veio impedir. Fica travado até alguém vincular à mão,
      //    que é o mal menor e tem o id na mensagem.
      console.error("[asaas] assinatura criada mas NÃO vinculada:", tenantId, sub.id, upErr.message)
      return { error: `Assinatura criada no gateway (${sub.id}) mas não vinculada. Contate o suporte.` }
    }

    console.log(JSON.stringify({ src: "asaas", kind: "assinatura-criada", tenant: tenantId, subscription: sub.id }))
    return { id: sub.id }
  } catch (e) {
    console.error("[asaas] criação de assinatura falhou:", tenantId, (e as Error).message)

    // 🔴 ERRO DE REDE ≠ "NÃO CRIOU". `AsaasError` com `status 0` é timeout ou conexão
    //    perdida — e nesses dois casos o gateway pode ter criado a assinatura E cobrado o
    //    cartão (a primeira cobrança é hoje). Soltar a vaga aqui liberava a pessoa pra
    //    tentar de novo e criar uma SEGUNDA assinatura mensal em cima de um débito que já
    //    tinha passado. Antes de liberar, a gente PERGUNTA ao gateway.
    if (e instanceof AsaasError && e.status === 0) {
      const existente = await procurarAssinaturaNoGateway(tenantId)

      // Existe: vincula em vez de liberar. O dinheiro saiu; a linha do banco tem que refletir.
      if (existente) {
        const { error: upErr } = await supabaseAdmin
          .from("tenants")
          .update({
            asaas_subscription_id: existente,
            billing_day:           Math.min(28, Number(nextDueDate.slice(8, 10)) || 1),
            plan_id:               plano.id,
            // Já cifrado lá em cima — cifrar aqui dentro do `catch` era o MESMO defeito do
            // P0-1 num caminho que o relatório nem olhou: sem `try` aninhado, a exceção
            // escapava da função inteira e o cliente via um crash.
            asaas_card_token:      tokenCifrado,
            card_brand:            rotulo.bandeira,
            card_last4:            rotulo.ultimos4,
            subscription_ends_at:  null,
          })
          .eq("id", tenantId)
        if (!upErr) {
          console.error(JSON.stringify({ src: "asaas", kind: "assinatura-recuperada-pos-timeout",
            tenant: tenantId, subscription: existente }))
          return { id: existente }
        }
        console.error("[asaas] assinatura achada pós-timeout mas NÃO vinculada:", tenantId, existente, upErr.message)
        return { error: `Assinatura criada no gateway (${existente}) mas não vinculada. Contate o suporte.` }
      }

      // ⚠️ `undefined` = a consulta TAMBÉM falhou, então não sabemos. A reserva FICA — e
      //    ficar presa é o mal menor: é reparável à mão (e a faxina do reconcile corrobora
      //    antes de limpar), enquanto liberar no escuro cobra o cliente duas vezes.
      if (existente === undefined) {
        return { error: "Não recebemos a confirmação do gateway. Aguarde um minuto e recarregue esta tela antes de tentar de novo." }
      }
    }

    // ⚠️ Aqui a resposta do gateway é conhecida (recusa, dado inválido) OU ele confirmou
    //    que nada foi criado: soltar a vaga é seguro, e obrigatório — sem isto o tenant
    //    ficaria com o marcador `pending:` e nunca mais conseguiria assinar.
    await soltarReserva()
    return { error: mensagemSeguraDoGateway(e, "Não foi possível criar a assinatura.") }
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
function primeiraCobranca(): string {
  // 🔴 COBRA HOJE, SEMPRE (decisão do dono, 2026-08-06).
  //
  //    A versão anterior usava `nextDueDate = fim do trial`, pra o fim do teste e a
  //    primeira cobrança caírem no mesmo dia. Parecia elegante e estava errado na prática:
  //    quem assinava no meio do teste ficava com a assinatura ACTIVE, a cobrança PENDING
  //    pra dali a 5 dias, e **nenhum webhook** — logo, nenhuma liberação. O cliente pagava
  //    e continuava com os módulos do teste, olhando uma tela que já dizia o nome do plano
  //    novo. Medido ao vivo em 06/08: assinatura criada, `pay_…` PENDING pro dia 11, tenant
  //    ainda `trialing` com 5 módulos em vez de 19.
  //
  // 🔑 A REGRA DO DONO: *"na hora que efetivar o pagamento é quando é registrado o dia de
  //    pagamento, e quando efetiva o pagamento a liberação é instantânea. Não tem porque o
  //    cara esperar os dias de teste pra depois liberar o que ele tem direito."*
  //    Quem antecipa perde os dias restantes do teste — escolha dele, e é o padrão do
  //    mercado. Em troca, recebe o produto no segundo seguinte.
  //
  // ⚠️ O ciclo mensal passa a ancorar no DIA DA COMPRA (o `billing_day` deriva daqui), não
  //    no fim do teste. E a cobrança imediata é o que faz o `PAYMENT_CONFIRMED` chegar em
  //    segundos — é ele que dispara `liberar()` e aplica o plano.
  // ⚠️ Fuso de São Paulo porque é o que o Asaas usa pra virar o dia: em UTC, uma compra às
  //    22h de Brasília viraria "amanhã" e a cobrança sairia com um dia de atraso.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
}

/**
 * Troca o cartão da assinatura vigente. **Não cobra nada.**
 *
 * 🔴 NÃO EXISTIA CAMINHO NENHUM (achado 2026-08-07). Havia UMA chamada de tokenização no
 *    repositório inteiro, dentro de `createSubscriptionForTenant` — e ela sai antes
 *    quando já existe assinatura. Ou seja: cliente com cartão vencido **não tinha como
 *    atualizar**, nem tela, nem botão. A única saída era falar com o suporte e alguém
 *    resolver no painel do Asaas.
 *
 * 🔑 Endpoint dedicado do gateway: `POST /subscriptions/{id}/creditCard` (o comentário
 *    dizia `PUT` e o código sempre fez `POST` — verbo errado lançaria e a troca nem
 *    aconteceria, mas comentário que discorda do código é a próxima pessoa investigando o
 *    lugar errado). Ele atualiza a
 *    assinatura **e as cobranças pendentes ligadas a ela** — que é o que impede a próxima
 *    tentativa de bater no cartão velho de novo. E não gera cobrança imediata.
 *
 * ⚠️ PCI: mesmas três regras do arquivo. O cartão entra por parâmetro, é usado UMA vez, e
 *    nada dele é persistido — nem aqui, nem no retorno.
 * ⚠️ Este é um SEGUNDO oráculo de validação de cartão rodando na nossa conta merchant.
 *    O teto anti card-testing vale igual, e mora na action (`trocarCartaoDaAssinatura`).
 */
export async function updateSubscriptionCard(
  tenantId: string,
  card: CardInput,
  holder: HolderInput,
  remoteIp: string,
): Promise<{ ok: true } | { error: string }> {
  const { data } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id, asaas_customer_id, billing_mode")
    .eq("id", tenantId).maybeSingle()

  const row = data as {
    asaas_subscription_id?: string | null
    asaas_customer_id?: string | null
    billing_mode?: string | null
  } | null
  const id   = assinaturaRealId(row?.asaas_subscription_id)
  const cust = row?.asaas_customer_id ?? null

  // ⚠️ Sem assinatura não há o que trocar — e mandar essa pessoa pro formulário de cartão
  //    seria pedir dado sensível pra nada. Quem não tem assinatura CONTRATA, não troca.
  if (!id) return { error: "Você ainda não tem uma assinatura ativa." }

  // ⚠️ `manual` não é governado pela automação (§2 do design): a cobrança dele acontece
  //    fora do gateway, então não existe cartão nosso pra trocar.
  if (row?.billing_mode !== "gateway") {
    return { error: "A cobrança desta conta é combinada com a nossa equipe." }
  }

  // ⚠️ Tokenizar exige o customer. Sem ele o estado é incoerente (assinatura sem cliente) —
  //    fail-closed com mensagem acionável em vez de mandar cartão pro gateway e ver no que dá.
  if (!cust) return { error: "Cadastro incompleto no gateway. Fale com a gente." }

  // 🔑 TOKENIZA PRIMEIRO, depois manda o TOKEN — não o cartão. Dois ganhos: o número passa
  //    por menos superfície (uma chamada em vez de duas), e sobra um token pra guardar, que
  //    é o que destrava upgrade com proporcional e retentativa de cobrança recusada.
  //    A doc do Asaas recomenda o token quando a tokenização está ativa.
  let token: string
  let rotulo = rotuloDoCartaoDigitado(card.number)
  try {
    const tok = await asaas.post<RespostaTokenize>("/creditCard/tokenize", {
      customer: cust,
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
        // Mesma regra da criação: celular vai em `mobilePhone`, não no campo do fixo.
        ...(isMobilePhoneBR(holder.phone)
          ? { phone: digits(holder.phone), mobilePhone: digits(holder.phone) }
          : { phone: digits(holder.phone) }),
      },
      remoteIp,
    })
    if (!tok?.creditCardToken) return { error: "O gateway não devolveu o token do cartão." }
    token = tok.creditCardToken
    rotulo = rotuloDoGateway(tok, card.number)
  } catch (e) {
    // ⚠️ Só a MENSAGEM. Nunca o objeto `card`. E a mensagem é a segura: esta é a SEGUNDA
    //    porta pro mesmo oráculo de teste de cartão, então vale a mesma regra da criação.
    console.error("[asaas] tokenize da troca recusado:", tenantId, (e as Error).message)
    return { error: mensagemSeguraDoGateway(e, "Não foi possível validar o cartão.") }
  }

  // Mesma regra do P0-1, no caminho irmão: cifra ANTES de mexer no gateway. Aqui o dano de
  // falhar depois seria menor (não nasce assinatura nova), mas ainda deixaria o banco com o
  // token VELHO enquanto o gateway já cobra o cartão novo — dois lados discordando sobre
  // qual credencial vale.
  let tokenCifrado: string
  try {
    tokenCifrado = encryptSecret(token)
  } catch (e) {
    console.error("[asaas] cifragem do token falhou ANTES da troca:", tenantId, (e as Error).message)
    return { error: "Não foi possível concluir com segurança. Tente de novo em instantes." }
  }

  try {
    await asaas.post(`/subscriptions/${id}/creditCard`, { creditCardToken: token, remoteIp })
  } catch (e) {
    console.error("[asaas] troca de cartão falhou:", tenantId, (e as Error).message)
    return { error: mensagemSeguraDoGateway(e, "Não foi possível atualizar o cartão.") }
  }

  // 🔒 Guarda CIFRADO (`encryptSecret`, mesmo padrão dos outros segredos). O token não é
  //    dado de cartão — é identificador opaco, válido só na nossa conta e só pra este
  //    cliente. Ver a migration `20260807_asaas_card_token.sql` pro racional completo.
  // ⚠️ Best-effort: se a gravação falhar, o cartão JÁ foi trocado no gateway e a cobrança
  //    mensal está salva. Perder o token só custa o atalho do upgrade — não vale desfazer
  //    uma troca bem-sucedida por causa disso. Grita no log pra aparecer.
  const { error: upErr } = await supabaseAdmin
    .from("tenants")
    .update({
      // ⚠️ `tokenCifrado`, cifrado ANTES do POST lá em cima. Aqui estava `encryptSecret(token)`
      //    — a correção do P0-1 tinha sido feita pela metade neste caminho: a variável nova
      //    ficou morta e a cifragem seguia acontecendo DEPOIS de o cartão já ter sido
      //    trocado no gateway, fora de qualquer `try`. Se lançasse, a exceção escapava da
      //    função inteira e o cliente via um crash, com o gateway já cobrando o cartão novo
      //    e o banco guardando o token velho.
      asaas_card_token: tokenCifrado,
      // Rótulo e credencial andam juntos — ver o comentário na criação da assinatura.
      card_brand: rotulo.bandeira,
      card_last4: rotulo.ultimos4,
    })
    .eq("id", tenantId)

  if (upErr) {
    console.error(JSON.stringify({
      src: "asaas", kind: "token-nao-gravado", tenant: tenantId, msg: upErr.message,
    }))
  }

  console.log(JSON.stringify({ src: "asaas", kind: "cartao-atualizado", tenant: tenantId, subscription: id }))
  return { ok: true }
}

/**
 * Cancela a assinatura recorrente do tenant no gateway.
 *
 * 🔴 NÃO EXISTIA (auditoria 05/08/2026), e a falta era do pior tipo: **cobrar sem
 *    entregar**. Suspender ou desativar um cliente no god mode cortava o acesso, revogava
 *    as sessões e deixava a assinatura viva no Asaas — o cartão dele seguia sendo debitado
 *    todo mês, indefinidamente, por um produto que ele não conseguia mais abrir. Não havia
 *    chamada de cancelamento em lugar nenhum do repositório, nem pro operador nem pro
 *    cliente.
 *
 * 🔑 Best-effort com log ALTO, mesmo padrão do `applyPlan` no `liberar()`: se o gateway não
 *    responder, a transição de estado NÃO é desfeita (o acesso precisa cair agora), mas o
 *    log grita pra alguém cancelar à mão. Fica registrado no `error` do console em JSON.
 *
 * ⚠️ Idempotente: sem `asaas_subscription_id`, sai em silêncio. `404` no gateway também é
 *    sucesso — a assinatura já não existe, que é o estado desejado.
 * ⚠️ Limpa a coluna localmente em qualquer sucesso, pra recontratação futura funcionar.
 */
export async function cancelSubscriptionForTenant(
  tenantId: string,
): Promise<{ ok: true } | { error: string }> {
  const { data } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id").eq("id", tenantId).maybeSingle()

  const id = (data as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id ?? null
  // Sem assinatura, ou só a reserva do claim: nada a cancelar NO GATEWAY.
  // ⚠️ Mas o token local ainda é limpo. Sem isto, um tenant que perdeu a assinatura por
  //    outro caminho (cancelada no painel do Asaas, reserva órfã) ficaria com uma
  //    credencial de cobrança guardada sem nada pra cobrar — credencial que sobrevive ao
  //    próprio propósito é resíduo, e resíduo é o que auditoria encontra depois.
  if (!id || id.startsWith("pending:")) {
    // ⚠️ O filtro olhava SÓ o token. Se ele já fosse nulo mas o rótulo não — exatamente o
    //    estado que uma limpeza parcial produz —, a linha não era tocada e o rótulo ficava
    //    pra trás. Agora basta QUALQUER um dos três estar sujo pra a faxina rodar.
    await supabaseAdmin.from("tenants")
      .update({ asaas_card_token: null, card_brand: null, card_last4: null })
      .eq("id", tenantId)
      .or("asaas_card_token.not.is.null,card_brand.not.is.null,card_last4.not.is.null")
    return { ok: true }
  }

  try {
    await asaas.del(`/subscriptions/${id}`)
  } catch (e) {
    if (!(e instanceof AsaasError && e.status === 404)) {
      console.error(JSON.stringify({
        src: "asaas", kind: "cancelamento-falhou-CANCELAR-A-MAO",
        tenant: tenantId, subscription: id, msg: (e as Error).message,
      }))
      return { error: "Não foi possível cancelar a assinatura no gateway." }
    }
  }

  // 🔒 O TOKEN MORRE COM A ASSINATURA. Sem recorrência não há motivo pra manter uma
  //    credencial de cobrança guardada — e credencial que sobrevive ao seu propósito é
  //    exatamente o tipo de resíduo que uma auditoria acha depois. Recontratar tokeniza
  //    de novo, com o cartão que a pessoa informar naquele momento.
  await supabaseAdmin.from("tenants")
    .update({ asaas_subscription_id: null, asaas_card_token: null, card_brand: null, card_last4: null })
    .eq("id", tenantId)

  console.log(JSON.stringify({ src: "asaas", kind: "assinatura-cancelada", tenant: tenantId, subscription: id }))
  return { ok: true }
}
