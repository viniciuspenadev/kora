import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { isMobilePhoneBR } from "@/lib/masks"
import { asaas, AsaasError, mensagemSeguraDoGateway } from "./client"
import { ensureAsaasCustomer } from "./customers"
import { abaixoDoMinimoDoCartao, assinaturaRealId, novaReservaDeClaim } from "@/lib/billing/gateway-limits"
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets"
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
/** Uma cobrança em aberto DESTE tenant, já corroborada no gateway. */
export interface CobrancaEmAberto {
  id:          string
  valorCents:  number
  vencimento:  string | null
  /** Quantas outras continuam em aberto depois desta. */
  outras:      number
}

/**
 * A cobrança em aberto mais ANTIGA deste tenant — a que ele tem que pagar primeiro.
 *
 * 🔒 TENANCY EM DUAS CAMADAS, e as duas importam:
 *    1. a listagem é filtrada pelo `customer` que está NA NOSSA LINHA do tenant — nunca por
 *       um id vindo da tela;
 *    2. cada cobrança ainda é conferida contra a nossa assinatura (`payment.subscription`).
 *    A primeira já isola por cliente; a segunda protege do caso em que o mesmo customer
 *    tenha cobrança avulsa criada no painel — pagar aquilo aqui seria quitar uma dívida
 *    que não é da assinatura, com o cartão que a pessoa acabou de digitar pra outra coisa.
 *
 * ⚠️ Devolve UMA, não todas. Pagar tudo em lote surpreenderia o cliente com um total que a
 *    tela não prometeu; `outras` existe pra a tela poder dizer que ainda sobra.
 * ⚠️ `undefined` = a consulta ao gateway falhou. Diferente de `null` ("perguntei, não há
 *    nada em aberto") — quem chama precisa dos três casos, senão trata indisponibilidade
 *    como "está tudo pago".
 */
export async function acharCobrancaEmAberto(tenantId: string): Promise<CobrancaEmAberto | null | undefined> {
  const { data, error } = await supabaseAdmin
    .from("tenants").select("asaas_customer_id, asaas_subscription_id, billing_mode")
    .eq("id", tenantId).maybeSingle()
  if (error) return undefined

  const row  = data as { asaas_customer_id?: string | null; asaas_subscription_id?: string | null; billing_mode?: string | null } | null
  const cust = row?.asaas_customer_id ?? null
  const sub  = assinaturaRealId(row?.asaas_subscription_id)
  if (!cust || row?.billing_mode !== "gateway") return null

  try {
    // `OVERDUE` e `PENDING`: a vencida é o caso do degrau 2/3, a pendente cobre a janela
    // entre a cobrança nascer e vencer (cartão recusado no dia, cliente quer resolver já).
    const r = await asaas.get<{ data?: Array<{ id?: string; value?: number; dueDate?: string; status?: string; subscription?: string }> }>(
      `/payments?customer=${encodeURIComponent(cust)}&status=OVERDUE&limit=20`,
    )
    const p2 = await asaas.get<{ data?: Array<{ id?: string; value?: number; dueDate?: string; status?: string; subscription?: string }> }>(
      `/payments?customer=${encodeURIComponent(cust)}&status=PENDING&limit=20`,
    )

    // 🔴 PENDENTE NÃO É O MESMO QUE EM ABERTO (achado em teste ao vivo, 09/08).
    //
    //    Toda assinatura ativa tem, PERMANENTEMENTE, uma cobrança `PENDING` do próximo
    //    ciclo — ela nasce assim que o ciclo anterior é pago. Como ela é da nossa
    //    assinatura, passava nos dois filtros abaixo e virava "cobrança em aberto".
    //
    //    O estrago: um cliente **em dia** que clicava em "Trocar cartão" caía no modo
    //    REGULARIZAR e lia *"Pagar R$ X e salvar cartão"* — e, ao clicar, era **cobrado
    //    hoje pela fatura do mês que vem**, sem ter pedido. É o inverso exato do defeito
    //    que a gente corrigiu ontem: antes o modal dizia "nada é cobrado agora" quando ia
    //    cobrar; agora dizia "vamos cobrar" pra quem só queria trocar o cartão.
    //
    // 🔑 O `PENDING` entrou por um caso legítimo (documentado logo acima): a cobrança
    //    nasceu, o cartão falhou HOJE, e o cliente quer resolver antes de vencer. Nesse
    //    caso ela vence hoje. O que não pode entrar é a do mês que vem.
    // ⚠️ `OVERDUE` não precisa do filtro: por definição já passou do vencimento.
    const hoje = new Date().toISOString().slice(0, 10)
    const jaCobravel = (p: { status?: string; dueDate?: string }) =>
      p.status !== "PENDING" || (p.dueDate ?? "9999-12-31") <= hoje

    const nossas = [...(r?.data ?? []), ...(p2?.data ?? [])]
      // 🔒 A segunda camada: só cobrança DA NOSSA ASSINATURA. Avulsa criada no painel do
      //    Asaas não tem `subscription` e fica de fora — é dívida de outra natureza.
      .filter((p) => !!p?.id && !!sub && p.subscription === sub)
      .filter(jaCobravel)
      .sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? "")))

    const alvo = nossas[0]
    if (!alvo?.id) return null

    return {
      id:         alvo.id,
      valorCents: Math.round((alvo.value ?? 0) * 100),
      vencimento: alvo.dueDate ?? null,
      outras:     Math.max(0, nossas.length - 1),
    }
  } catch (e) {
    console.error("[asaas] busca de cobrança em aberto falhou:", tenantId, (e as Error).message)
    return undefined
  }
}

/**
 * Regulariza: paga a cobrança em aberto com o cartão novo e **só então** troca o cartão.
 *
 * 🔑 A ORDEM É A DECISÃO (dono, 08/08): *"primeiro efetiva, depois efetuar a troca"*.
 *    Cobrar antes de trocar significa que o cartão só vira o cartão da assinatura depois de
 *    provar que funciona. Se ele for recusado, **nada muda** — o cliente não termina com a
 *    assinatura apontando pra um cartão pior que o anterior.
 *
 * ✅ Três garantias vieram do PRÓPRIO GATEWAY, verificadas no sandbox em 08/08 — por isso
 *    não precisei construí-las aqui (e construir seria pior, porque a minha versão teria
 *    corrida entre réplicas):
 *      • pagar a MESMA cobrança duas vezes é **recusado** pelo Asaas;
 *      • o `value` mandado por quem chama é **ignorado** — vale o valor da cobrança
 *        (testado: mandei 1,00 numa de 10,00 e cobrou 10,00);
 *      • a cobrança paga é a MESMA (mesmo id) — não nasce uma segunda, então não existe
 *        janela com duas cobranças vivas.
 *
 * ⚠️ O ESTADO RESIDUAL QUE NÃO DÁ PRA ELIMINAR: pagou e a troca falhou. O dinheiro entrou
 *    (a fatura baixa pelo webhook) e a assinatura segue no cartão velho. Escolhi esta ordem
 *    porque a inversa é pior — trocaria o cartão e deixaria a fatura aberta, que é o
 *    problema do cliente **intacto**. Este caso devolve `cartaoTrocado: false` pra a tela
 *    poder dizer as duas coisas em vez de um "erro" genérico.
 */
export async function regularizarComCartao(
  tenantId: string,
  card: CardInput,
  holder: HolderInput,
  remoteIp: string,
): Promise<{ ok: true; pagoCents: number; cartaoTrocado: boolean; outras: number } | { error: string }> {
  const cobranca = await acharCobrancaEmAberto(tenantId)
  if (cobranca === undefined) return { error: "Não conseguimos consultar sua fatura agora. Tente de novo em instantes." }
  if (cobranca === null)      return { error: "Não há cobrança em aberto nesta conta." }

  const { data } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id, asaas_customer_id, billing_mode")
    .eq("id", tenantId).maybeSingle()
  const row  = data as { asaas_subscription_id?: string | null; asaas_customer_id?: string | null; billing_mode?: string | null } | null
  const sub  = assinaturaRealId(row?.asaas_subscription_id)
  const cust = row?.asaas_customer_id ?? null
  if (!sub || row?.billing_mode !== "gateway") return { error: "Esta conta não tem assinatura ativa no gateway." }
  if (!cust) return { error: "Cadastro incompleto no gateway. Fale com a gente." }

  // 1 · Tokeniza. Falhou aqui = cartão inválido, e **nada foi tocado**.
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
        ...(isMobilePhoneBR(holder.phone)
          ? { phone: digits(holder.phone), mobilePhone: digits(holder.phone) }
          : { phone: digits(holder.phone) }),
      },
      remoteIp,
    })
    if (!tok?.creditCardToken) return { error: "O gateway não devolveu o token do cartão." }
    token  = tok.creditCardToken
    rotulo = rotuloDoGateway(tok, card.number)
  } catch (e) {
    console.error("[asaas] tokenize da regularização recusado:", tenantId, (e as Error).message)
    return { error: mensagemSeguraDoGateway(e, "Não foi possível validar o cartão.") }
  }

  // Cifra ANTES de cobrar — mesma regra do P0-1: a única falha local possível acontece
  // enquanto nada foi cobrado ainda.
  let tokenCifrado: string
  try {
    tokenCifrado = encryptSecret(token)
  } catch (e) {
    console.error("[asaas] cifragem falhou ANTES de regularizar:", tenantId, (e as Error).message)
    return { error: "Não foi possível concluir com segurança. Tente de novo em instantes." }
  }

  // 2 · COBRA. É aqui que o cartão prova que presta. Recusou ⇒ para, sem trocar nada.
  try {
    const pago = await asaas.post<{ status?: string; value?: number }>(
      `/payments/${cobranca.id}/payWithCreditCard`,
      { creditCardToken: token, remoteIp },
    )
    const st = pago?.status ?? ""
    if (!["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(st)) {
      console.error(JSON.stringify({ src: "asaas", kind: "regularizacao-status-inesperado",
        tenant: tenantId, payment: cobranca.id, status: st }))
      return { error: "Não conseguimos confirmar o pagamento. Tente de novo ou fale com a gente." }
    }
  } catch (e) {
    // 🔴 "NÃO SEI SE COBROU" ≠ "NÃO COBROU" (H-03 do pentest de 08/08). Um timeout aqui é
    //    ambíguo: o POST pode ter sido processado e só a RESPOSTA ter se perdido. Antes o
    //    catch devolvia erro seco — e a próxima tentativa do cliente refazia a busca, que
    //    já não enxergava a cobrança recém-paga e pousava na **seguinte**. Ele clicava uma
    //    vez achando que estava pagando uma parcela e pagava duas.
    //
    // 🔑 MAS RECUSA NÃO É AMBIGUIDADE — e confundir as duas foi o primeiro jeito que eu
    //    escrevi isto (o teste da frase única pegou). Um 4xx do Asaas significa que ele
    //    RESPONDEU e negou: o cartão foi bloqueado, os dados estão errados, não há dinheiro.
    //    Nada foi cobrado, e reconsultar só atrasaria a resposta pra dizer o mesmo. Ambíguo
    //    é o silêncio: timeout, rede caída, 5xx — onde o POST pode ter sido processado.
    if (e instanceof AsaasError && e.status >= 400 && e.status < 500) {
      console.error("[asaas] cobrança da regularização recusada:", tenantId, (e as Error).message)
      return { error: mensagemSeguraDoGateway(e, "Não foi possível concluir o pagamento.") }
    }

    // 🔑 A desambiguação é perguntar pelo pagamento EXATO — nunca refazer a busca. Se ele
    //    já está confirmado, o POST tinha dado certo: seguimos como sucesso.
    // ⚠️ A releitura também pode falhar (o gateway está instável, foi o que nos trouxe
    //    aqui). Aí a resposta honesta é "não sabemos" — e a frase pede pra CONFERIR antes
    //    de tentar de novo, em vez de convidar a um segundo clique às cegas.
    let confirmado = false
    try {
      const conf = await asaas.get<{ status?: string }>(`/payments/${cobranca.id}`)
      confirmado = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(conf?.status ?? "")
    } catch {
      console.error(JSON.stringify({ src: "asaas", kind: "REGULARIZACAO-AMBIGUA-nao-reconsultou",
        tenant: tenantId, payment: cobranca.id }))
      return { error: "Não conseguimos confirmar se o pagamento foi concluído. Confira sua fatura antes de tentar de novo — não repita a cobrança." }
    }

    if (!confirmado) {
      console.error("[asaas] cobrança da regularização recusada:", tenantId, (e as Error).message)
      return { error: mensagemSeguraDoGateway(e, "Não foi possível concluir o pagamento.") }
    }

    // O POST tinha dado certo; só a resposta se perdeu. Segue o fluxo normal (troca de
    // cartão + rótulo) em vez de mandar o cliente pagar de novo.
    console.warn(JSON.stringify({ src: "asaas", kind: "regularizacao-confirmada-apos-timeout",
      tenant: tenantId, payment: cobranca.id }))
  }

  // 3 · Pagou. Daqui pra frente NADA desfaz — o dinheiro entrou e a fatura vai baixar pelo
  //     webhook. A troca do cartão é melhoria; falhar nela não anula o pagamento.
  let cartaoTrocado = true
  try {
    await asaas.post(`/subscriptions/${sub}/creditCard`, { creditCardToken: token, remoteIp })
  } catch (e) {
    cartaoTrocado = false
    console.error(JSON.stringify({ src: "asaas", kind: "PAGOU-MAS-CARTAO-NAO-TROCADO",
      tenant: tenantId, subscription: sub, payment: cobranca.id, msg: (e as Error).message }))
  }

  if (cartaoTrocado) {
    const { error: upErr } = await supabaseAdmin
      .from("tenants")
      .update({ asaas_card_token: tokenCifrado, card_brand: rotulo.bandeira, card_last4: rotulo.ultimos4 })
      .eq("id", tenantId)
    if (upErr) {
      console.error(JSON.stringify({ src: "asaas", kind: "regularizou-mas-rotulo-nao-gravado",
        tenant: tenantId, msg: upErr.message }))
    }
  }

  console.log(JSON.stringify({ src: "asaas", kind: "regularizado",
    tenant: tenantId, payment: cobranca.id, cartaoTrocado, outras: cobranca.outras }))

  return { ok: true, pagoCents: cobranca.valorCents, cartaoTrocado, outras: cobranca.outras }
}

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
/**
 * @param opts.manterCartaoAteOFim — NÃO apaga o cartão agora; ele morre quando o ciclo
 *   pago fecha (bloco 1.b do housekeeping). **Só o cancelamento pedido pelo CLIENTE usa.**
 *
 * 🔑 POR QUE A EXCEÇÃO EXISTE (11/08). A regra "o token morre com a assinatura" está certa
 *    e continua sendo o padrão: credencial de cobrança sem nada a cobrar é resíduo. Mas ela
 *    não descreve ESTE caso — no cancelamento a pedido do cliente, a relação **não acabou**:
 *    ele segue cliente, com acesso, até o fim do período que pagou. O cartão dele é meio de
 *    pagamento de um contrato VIVO, não sobra de um contrato morto.
 * ⚠️ O efeito prático de apagar cedo: quem cancela por engano às 9h e se arrepende às 9h05
 *    precisa digitar o cartão de novo — sendo que continua cliente por mais 30 dias. A
 *    porta de volta fica mais cara que a de saída, que é o desenho errado.
 * 🔒 O resíduo continua não existindo: o cartão é apagado quando o ciclo fecha, que é o
 *    instante em que a relação de fato termina. Só muda QUANDO, não SE.
 */
export async function cancelSubscriptionForTenant(
  tenantId: string,
  opts?: { manterCartaoAteOFim?: boolean },
): Promise<{ ok: true } | { error: string }> {
  // 🔴 O `error` NÃO PODE SER DESCARTADO AQUI (C-03 do pentest 10/08, F1 em 11/08).
  //    Antes: `const { data } = …`. Num timeout do PostgREST, `data` vem null, a função
  //    concluía "não há assinatura", pulava o DELETE e devolvia `{ok:true}`. Os chamadores
  //    (`admin-billing`, `trial-housekeeping`) são fail-closed contra `{error}` — e por isso
  //    seguiam confiantes: o gate estava certo, quem mentia era esta função. Resultado
  //    medido: acesso cortado e cartão debitado todo mês, sem nada varrendo esse estado.
  //    A regra: **"não sei" ≠ "não existe"**. Indisponibilidade tem que falhar alto.
  const { data, error: erroLeitura } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id").eq("id", tenantId).maybeSingle()

  if (erroLeitura) {
    console.error(JSON.stringify({
      src: "asaas", kind: "cancelamento-abortado-leitura-falhou",
      tenant: tenantId, msg: erroLeitura.message,
    }))
    return { error: "Não foi possível consultar a assinatura agora. Nada foi cancelado — tente de novo." }
  }

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
    // ⚠️ Zero linhas afetadas aqui é NORMAL (nada sujo pra limpar) — por isso só o `error`
    //    é conferido, não a contagem. Contagem de linhas/CAS é escopo da F4.
    const { error: erroFaxina } = await supabaseAdmin.from("tenants")
      .update({ asaas_card_token: null, card_brand: null, card_last4: null })
      .eq("id", tenantId)
      .or("asaas_card_token.not.is.null,card_brand.not.is.null,card_last4.not.is.null")
    if (erroFaxina) {
      console.error(JSON.stringify({
        src: "asaas", kind: "faxina-do-cartao-falhou", tenant: tenantId, msg: erroFaxina.message,
      }))
      return { error: "Não foi possível limpar os dados de cobrança agora. Tente de novo." }
    }
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
  // 🔴 A LIMPEZA LOCAL PRECISA SER CONFIRMADA (C-03, terceira perna). Antes o retorno era
  //    ignorado e a função devolvia `ok` de qualquer jeito — deixando id/token/rótulo
  //    residuais que BLOQUEIAM nova contratação, com o sistema achando que deu tudo certo.
  // ⚠️ `manterCartaoAteOFim` (11/08): o vínculo da assinatura SEMPRE cai — ela morreu no
  //    gateway e deixar o id seria mentir. O que a exceção preserva é só o CARTÃO, e só
  //    para o cancelamento a pedido do cliente (ver o docblock). Quem apaga nesse caminho é
  //    o bloco 1.b, quando a data passa e a relação de fato acaba.
  const limpeza = opts?.manterCartaoAteOFim
    ? { asaas_subscription_id: null }
    : { asaas_subscription_id: null, asaas_card_token: null, card_brand: null, card_last4: null }

  const { error: erroLimpeza } = await supabaseAdmin.from("tenants")
    .update(limpeza)
    .eq("id", tenantId)

  if (erroLimpeza) {
    // ⚠️ Estado divergente REAL e deliberadamente visível: a assinatura JÁ MORREU no
    //    gateway (o DELETE acima passou), mas o vínculo local sobreviveu. Devolver erro é
    //    o desfecho seguro — o chamador não marca `canceled`, e a varredura do `reconcile`
    //    reencontra "vínculo local vivo × gateway 404" e conclui a limpeza. O oposto
    //    (devolver `ok`) é o que produzia o resíduo silencioso.
    console.error(JSON.stringify({
      src: "asaas", kind: "cancelou-no-gateway-mas-limpeza-local-falhou-CONFERIR",
      tenant: tenantId, subscription: id, msg: erroLimpeza.message,
    }))
    return { error: "A assinatura foi cancelada no gateway, mas o cadastro local não pôde ser atualizado. Confira antes de recontratar." }
  }

  console.log(JSON.stringify({ src: "asaas", kind: "assinatura-cancelada", tenant: tenantId, subscription: id }))
  return { ok: true }
}

/**
 * Atualiza o VALOR da recorrência no gateway (decisão do dono, 08/08: opção A —
 * *"não pagou tudo, perde acesso. Excedente de usuário faz parte do pacote"*).
 *
 * 🔴 POR QUE ISTO PRECISOU EXISTIR (H-02 do pentest). A assinatura nascia com o preço do
 *    plano e **nunca mais era tocada** — não havia um único `PUT` de valor no repositório.
 *    A fatura, porém, soma plano + excedente + adicionais. Resultado: o excedente era
 *    entregue, entrava no livro como devido, era declarado quitado e **desaparecia**. Perda
 *    de receita no caminho normal, sem falha e sem atacante.
 *
 * 🔑 O VALOR É CALCULADO DO ZERO A CADA CICLO, e é isso que faz ele **descer** quando o
 *    cliente reduz a equipe. O risco desta abordagem nunca foi subir — é ficar preso em
 *    cima: quem tira 5 logins e continua pagando por eles descobre sozinho, e aí já não
 *    confia mais na conta.
 *
 * ⚠️ AVULSA NÃO ENTRA. O que entra aqui se repete **todo mês** — é uma recorrência. Uma
 *    cobrança de setup que virasse valor de assinatura seria cobrada para sempre. Avulsa
 *    tem que ser cobrança separada; enquanto não for, ela vive só no nosso livro.
 *
 * ⚠️ DEFASAGEM DE UM CICLO, e é inerente: o Asaas gera a cobrança antes do vencimento,
 *    então um `PUT` de hoje vale para a PRÓXIMA. O cliente vê no cartão o excedente do
 *    ciclo que fechou — igual conta de luz. Decisão do dono: manter assim e **explicar na
 *    tela**, em vez de mexer no valor no meio do ciclo (que trocaria um ticket por uma
 *    classe de divergência).
 */
export async function atualizarValorDaAssinatura(
  tenantId: string,
  valorCents: number,
): Promise<{ ok: true; aplicado: boolean } | { error: string }> {
  if (!Number.isInteger(valorCents) || valorCents <= 0) {
    return { error: "Valor de assinatura inválido" }
  }

  const { data, error } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id").eq("id", tenantId).maybeSingle()
  if (error) return { error: `leitura do vínculo falhou: ${error.message}` }

  const id = assinaturaRealId((data as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id)
  // Sem assinatura vigente (cliente manual, legado, ou ativação em curso): não é erro —
  // simplesmente não há recorrência para atualizar.
  if (!id) return { ok: true, aplicado: false }

  try {
    // ⚠️ O Asaas fala em REAIS. Mandar centavos aqui multiplicaria a cobrança por 100 —
    //    o tipo de engano que só aparece no extrato do cliente.
    await asaas.put(`/subscriptions/${id}`, { value: valorCents / 100 })
  } catch (e) {
    // Não desfaz nada e não bloqueia o ciclo: a fatura do nosso lado está correta, e o
    // gateway continua cobrando o valor anterior. Grita porque a diferença é receita.
    console.error(JSON.stringify({ src: "asaas", kind: "VALOR-DA-ASSINATURA-NAO-ATUALIZADO",
      tenant: tenantId, subscription: id, valorCents, msg: (e as Error).message }))
    return { error: mensagemSeguraDoGateway(e, "Não foi possível atualizar o valor da assinatura.") }
  }

  console.log(JSON.stringify({ src: "asaas", kind: "valor-da-assinatura-atualizado",
    tenant: tenantId, subscription: id, valorCents }))
  return { ok: true, aplicado: true }
}

// ═══════════════════════════════════════════════════════════════
// Retomar — desfazer o cancelamento antes que o ciclo pago acabe
// ═══════════════════════════════════════════════════════════════
//
// 🔑 A JANELA QUE ESTA FUNÇÃO OCUPA. Entre o clique em "cancelar" e o fim do período pago o
//    cliente **continua cliente**: acesso inteiro, cartão guardado, nada cortado. A única
//    coisa que morreu foi a recorrência no gateway. Retomar é recriá-la — e nada além disso.
//
// 🔴 ELA NÃO COBRA NADA. `nextDueDate` é o dia SEGUINTE ao fim do ciclo já pago, ou seja o
//    mesmo dia em que a cobrança cairia se ele nunca tivesse cancelado. É a diferença que
//    separa isto de `createSubscriptionForTenant`, que cobra HOJE por decisão do dono
//    (06/08): lá o cliente está comprando acesso que ainda não tem; aqui ele já pagou o
//    período em curso, e cobrar de novo agora seria cobrar duas vezes o mesmo mês.
//
// 🔒 O CARTÃO NÃO PASSA POR AQUI. Usa o `creditCardToken` que já estava guardado cifrado —
//    esta é a **primeira leitura desse token em todo o código**; até 11/08 ele era escrito
//    em quatro lugares e nunca lido. Nenhum dado de cartão entra nesta função: as três
//    regras de PCI do topo do arquivo continuam valendo sem esforço, porque não há PAN.
//
// ⚠️ O claim atômico é o MESMO de `createSubscriptionForTenant` e pelo mesmo motivo: duas
//    abas retomando ao mesmo tempo criariam duas assinaturas mensais, e a segunda
//    sobrescreveria o id da primeira — que cobraria para sempre, invisível. Aqui o dano
//    demora um mês a aparecer (nada é debitado hoje), o que o torna MAIS perigoso, não menos.
export async function resumeSubscriptionForTenant(
  tenantId: string,
  remoteIp: string,
): Promise<{ id: string } | { error: string }> {
  const { data: row, error: tErr } = await supabaseAdmin
    .from("tenants")
    .select("asaas_subscription_id, subscription_ends_at, asaas_card_token, billing_mode, plan_id")
    .eq("id", tenantId)
    .maybeSingle()

  if (tErr) return { error: "Não foi possível ler o cliente." }
  if (!row) return { error: "Cliente não encontrado." }

  const t = row as unknown as {
    asaas_subscription_id: string | null; subscription_ends_at: string | null
    asaas_card_token: string | null; billing_mode: string | null; plan_id: string | null
  }

  // Já tem recorrência viva: idempotente. Clicar duas vezes não cria a segunda.
  const jaExiste = assinaturaRealId(t.asaas_subscription_id)
  if (jaExiste) return { id: jaExiste }

  if (t.billing_mode !== "gateway") {
    return { error: "A cobrança desta conta é combinada com a nossa equipe. Fale com a gente." }
  }

  // 🔴 SEM DATA FUTURA NÃO HÁ O QUE RETOMAR. Ou o cancelamento não existe, ou o ciclo já
  //    fechou — e nesse caso a varredura 1.b já apagou o cartão e virou o estado. Retomar
  //    ali seria contratar de novo, com data e cobrança novas: é o fluxo de escolher plano,
  //    não este. Colapsar os dois daria ao cliente um mês de graça a cada cancelamento.
  const fim = t.subscription_ends_at ? new Date(t.subscription_ends_at) : null
  if (!fim || Number.isNaN(fim.getTime()) || fim.getTime() <= Date.now()) {
    return { error: "Não há cancelamento em andamento para retomar." }
  }

  // ⚠️ Sem cartão guardado não dá pra recriar em silêncio: o gateway pediria o cartão e a
  //    tela prometeu um clique. Quem chama trata isto mandando pro fluxo com cartão.
  const tokenSalvo = decryptSecret(t.asaas_card_token)
  if (!tokenSalvo) return { error: "Não encontramos um cartão salvo. Informe o cartão para retomar." }

  const { data: planoRow, error: erroPlano } = await supabaseAdmin
    .from("plans").select("id, name, price_cents").eq("id", t.plan_id ?? "").eq("active", true).maybeSingle()
  // 🔴 "A consulta falhou" ≠ "o plano saiu do ar" (catraca do `check-money-io`). Colapsar os
  //    dois mandaria escolher plano de novo quem só pegou um blip de rede — e o preço dele
  //    está certo, guardado, esperando.
  if (erroPlano) return { error: "Não foi possível ler seu plano agora. Tente de novo em instantes." }
  const plano = planoRow as { id: string; name: string; price_cents: number } | null
  // ⚠️ Plano desativado depois da contratação: recriar cobraria um preço que saiu da
  //    prateleira. Manda escolher de novo em vez de perpetuar a tabela velha.
  if (!plano) return { error: "Seu plano não está mais disponível. Escolha um plano para continuar." }

  const valorCents = plano.price_cents ?? 0
  // Mesmos dois pisos do caminho de criação, pelo mesmo motivo: o motor não delega a
  // validação de valor ao gateway, e assinatura de R$ 0 cobra zero para sempre parecendo ok.
  if (abaixoDoMinimoDoCartao(valorCents)) return { error: "Este plano está indisponível para cobrança no cartão. Fale com a gente." }
  if (valorCents <= 0) return { error: "O plano desta conta está com preço zero. Fale com a gente antes de retomar." }

  // 🔑 A DATA: o dia seguinte ao fim do ciclo pago — exatamente onde a próxima cobrança
  //    cairia se ele nunca tivesse cancelado. Fatia em UTC porque é assim que a data foi
  //    carimbada (`period_end` + `T23:59:59Z`), então a fatia devolve o mesmo dia civil.
  const proximo = new Date(fim.getTime() + 24 * 60 * 60 * 1000)
  const nextDueDate = proximo.toISOString().slice(0, 10)

  // ── Claim atômico (idêntico ao da criação; ver o racional lá) ───────────────
  const reserva = novaReservaDeClaim()
  const { data: claimed, error: erroClaim } = await supabaseAdmin
    .from("tenants")
    .update({ asaas_subscription_id: reserva })
    .eq("id", tenantId)
    .is("asaas_subscription_id", null)
    .select("id")

  // 🔴 FALHA DE ESCRITA ≠ CORRIDA PERDIDA (catraca do `check-money-io`). As duas produzem
  //    `claimed` vazio e as duas devem parar aqui — mas a frase precisa ser diferente:
  //    "aguarde alguns segundos" manda esperar por uma operação que não existe, e a pessoa
  //    fica recarregando enquanto o problema é do banco.
  if (erroClaim) {
    console.error("[asaas] claim da retomada falhou:", tenantId, erroClaim.message)
    return { error: "Não foi possível iniciar a retomada agora. Tente de novo em instantes." }
  }
  if (!claimed || claimed.length === 0) {
    return { error: "Já existe uma operação em andamento para esta conta. Aguarde alguns segundos." }
  }
  const soltarReserva = async () => {
    await supabaseAdmin.from("tenants")
      .update({ asaas_subscription_id: null })
      .eq("id", tenantId)
      .eq("asaas_subscription_id", reserva)
  }

  const cust = await ensureAsaasCustomer(tenantId)
  if ("error" in cust) { await soltarReserva(); return cust }

  try {
    const sub = await asaas.post<{ id?: string }>("/subscriptions", {
      customer:          cust.id,
      billingType:       "CREDIT_CARD",
      value:             valorCents / 100,
      nextDueDate,
      cycle:             "MONTHLY",
      description:       `Kora — plano ${plano.name}`.trim(),
      externalReference: tenantId,
      creditCardToken:   tokenSalvo,
      remoteIp,
    })
    if (!sub?.id) { await soltarReserva(); return { error: "O gateway não devolveu o id da assinatura." } }

    // 🔴 `subscription_ends_at` E `subscription_ended_reason` CAEM JUNTOS. A data é o que
    //    faz a varredura 1.b encerrar o cliente quando ela passar — deixá-la aqui derrubaria,
    //    no dia do vencimento, um cliente que voltou a pagar. E o motivo sozinho mentiria no
    //    god mode ("cancelou a pedido") sobre uma assinatura viva.
    // ⚠️ `billing_day` NÃO é reescrito: o ciclo não mudou de âncora, a recorrência volta pro
    //    mesmo dia. Recalcular aqui só criaria oportunidade de drift (o teto em 28) sem
    //    nenhum ganho.
    const { error: upErr } = await supabaseAdmin
      .from("tenants")
      .update({
        asaas_subscription_id:     sub.id,
        subscription_ends_at:      null,
        subscription_ended_reason: null,
      })
      .eq("id", tenantId)

    if (upErr) {
      // Mesma regra da criação: NÃO solta a vaga — a assinatura existe lá fora. Soltar
      // deixaria o cliente retomar de novo e ficar com duas cobranças mensais.
      console.error("[asaas] assinatura retomada mas NÃO vinculada:", tenantId, sub.id, upErr.message)
      return { error: `Assinatura recriada no gateway (${sub.id}) mas não vinculada. Contate o suporte.` }
    }

    console.log(JSON.stringify({ src: "asaas", kind: "assinatura-retomada",
      tenant: tenantId, subscription: sub.id, proximaCobranca: nextDueDate }))
    return { id: sub.id }
  } catch (e) {
    console.error("[asaas] retomada de assinatura falhou:", tenantId, (e as Error).message)

    // 🔴 Timeout ≠ "não criou" — a mesma rede da criação, e aqui ela importa MAIS: como nada
    //    é debitado hoje, uma segunda assinatura criada por engano fica um mês inteira
    //    invisível antes de cobrar em dobro.
    if (e instanceof AsaasError && e.status === 0) {
      const existente = await procurarAssinaturaNoGateway(tenantId)
      if (existente) {
        const { error: upErr } = await supabaseAdmin
          .from("tenants")
          .update({ asaas_subscription_id: existente, subscription_ends_at: null, subscription_ended_reason: null })
          .eq("id", tenantId)
        if (!upErr) {
          console.error(JSON.stringify({ src: "asaas", kind: "retomada-recuperada-pos-timeout",
            tenant: tenantId, subscription: existente }))
          return { id: existente }
        }
        console.error("[asaas] assinatura achada pós-timeout mas NÃO vinculada:", tenantId, existente, upErr.message)
        return { error: `Assinatura recriada no gateway (${existente}) mas não vinculada. Contate o suporte.` }
      }
      // "Não sei" mantém a vaga presa: reparável à mão, ao contrário de cobrar duas vezes.
      if (existente === undefined) {
        return { error: "Não recebemos a confirmação do gateway. Aguarde um minuto e recarregue esta tela antes de tentar de novo." }
      }
    }

    await soltarReserva()
    return { error: mensagemSeguraDoGateway(e, "Não foi possível retomar a assinatura.") }
  }
}
