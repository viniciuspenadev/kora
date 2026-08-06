import "server-only"

// ═══════════════════════════════════════════════════════════════
// Limites impostos pelo GATEWAY (não por nós)
// ═══════════════════════════════════════════════════════════════
//
// 🔑 Vive num arquivo próprio porque é consumido pelos DOIS lados da mesma regra: o god
//    mode, que cadastra o preço, e a vitrine do cliente, que oferece o plano. Deixar o
//    número escrito nos dois é exatamente o erro que custou o dia de hoje — a regra
//    "dá pra cobrar?" existia em quatro cópias e a quarta divergiu.

/**
 * Valor mínimo que o Asaas aceita cobrar no cartão de crédito: **R$ 5,00**.
 *
 * 🔴 Medido na prática (05/08): um plano salvo a R$ 1,00 atravessou o god mode, a vitrine,
 *    a escolha, o cadastro e o formulário de cartão — e só o gateway recusou, com
 *    *"O valor mínimo para cobranças via cartão de crédito é R$ 5,00"*. Ou seja: a
 *    plataforma publicou, e vendeu, um plano impossível de contratar.
 * ⚠️ Preço ZERO segue legítimo (plano gratuito não cria assinatura no gateway). O piso só
 *    vale pra quem vai virar cobrança de verdade — por isso a checagem é sempre
 *    `> 0 && < MINIMO`, nunca `< MINIMO` sozinho.
 */
export const MINIMO_CARTAO_CENTS = 500

/** `true` quando o preço vai ser recusado pelo gateway (cobrável, mas abaixo do piso). */
export function abaixoDoMinimoDoCartao(priceCents: number | null | undefined): boolean {
  const v = priceCents ?? 0
  return v > 0 && v < MINIMO_CARTAO_CENTS
}

/**
 * A data que o gateway vai usar como PRIMEIRA COBRANÇA, já com o piso em hoje.
 *
 * 🔴 As telas mostravam `trial_ends_at` cru e o motor aplicava piso em hoje — então no
 *    caso MAIS COMUM (teste já vencido, pessoa vem pagar) o resumo prometia *"a primeira
 *    cobrança acontece em 4 de agosto"*, uma data no passado, enquanto o cartão era
 *    debitado hoje. Duas verdades sobre a mesma cobrança, e a errada era a que o cliente
 *    lia (achado do QA, 05/08).
 * ⚠️ Espelha `primeiraCobranca` de `asaas/subscriptions.ts`. As duas trabalham em
 *    `America/Sao_Paulo` porque é o fuso que o Asaas usa pra virar o dia.
 */
export function dataDaPrimeiraCobranca(trialEndsAt: string | null | undefined): string | null {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  const hoje = fmt(new Date())
  if (!trialEndsAt) return null
  const fim = new Date(trialEndsAt)
  if (Number.isNaN(fim.getTime())) return null
  const d = fmt(fim)
  return d < hoje ? hoje : d
}

/**
 * O id de assinatura REAL do gateway, ou `null`.
 *
 * 🔴 EXISTE PORQUE EU CRIEI O PROBLEMA (06/08). O claim atômico reserva a vaga gravando
 *    `pending:<uuid>` em `tenants.asaas_subscription_id` — e **sete leitores** pelo
 *    repositório tratavam qualquer string ali como "tem assinatura". O estrago, medido
 *    pelos dois revisores:
 *      • `/pagamento` e `escolherPlano` diziam *"sua assinatura já está ativa"* e
 *        **escondiam o formulário de cartão** ⇒ o cliente nunca conseguia pagar;
 *      • `createSubscriptionForTenant` devolvia `{ id: "pending:…" }` como SUCESSO ⇒ a tela
 *        anunciava compra feita sem assinatura nenhuma;
 *      • o cron de trial pulava o tenant ⇒ teste vitalício, gastando IA na nossa chave;
 *      • o banner perdia o "faltam N dias";
 *      • o cadastro fiscal travava o CPF/CNPJ.
 *    Ou seja: a correção da corrida criou um estado que trancava o cliente por fora.
 *
 * 🔑 Um lugar só decide o que é assinatura de verdade. Quem pergunta, chama daqui.
 */
export function assinaturaRealId(valor: string | null | undefined): string | null {
  if (!valor || valor.startsWith("pending:")) return null
  return valor
}

/** Idade máxima de uma reserva de claim antes de ser considerada órfã (crash/deploy). */
export const RESERVA_TTL_MS = 10 * 60_000

/**
 * Cria o marcador de reserva do claim atômico, **com o relógio dentro dele**.
 *
 * 🔴 A 1ª versão usava `tenants.updated_at` pra medir a idade da reserva — e essa coluna
 *    **não é mantida**: não há trigger em `tenants` (verificado em produção) e nenhum
 *    escritor do caminho de cobrança a atualiza. Medido ao vivo: o tenant tinha
 *    `updated_at` de ontem 22:54 com eventos processados hoje 07:01.
 *    Efeito: `updated_at < agora-10min` era SEMPRE verdadeiro ⇒ a faxina apagava
 *    **qualquer** reserva, inclusive uma escrita 3 segundos antes, no meio da tokenização
 *    do cartão. Isso desarma o claim atômico e devolve o bug da assinatura em dobro —
 *    e o cron de 15 em 15 minutos multiplicava a janela de exposição por ~96.
 * 🔑 O timestamp viaja NO token: autocontido, sem coluna nova, sem trigger, sem depender
 *    de ninguém lembrar de carimbar. Todos os leitores usam `startsWith("pending:")` e
 *    continuam funcionando sem mudança.
 */
export function novaReservaDeClaim(): string {
  return `pending:${Date.now()}:${crypto.randomUUID()}`
}

/**
 * Idade da reserva em ms, ou `null` se não for uma reserva (ou for de formato antigo).
 *
 * ⚠️ Formato legado `pending:<uuid>` (sem timestamp) devolve `null` ⇒ a faxina **não** o
 *    remove. Fail-safe deliberado: preferir uma reserva presa (que alguém repara à mão) a
 *    apagar a de um cliente que está com o cartão na tela agora.
 */
export function idadeDaReservaMs(valor: string | null | undefined): number | null {
  if (!valor || !valor.startsWith("pending:")) return null
  const partes = valor.split(":")
  if (partes.length < 3) return null
  const ts = Number(partes[1])
  if (!Number.isFinite(ts) || ts <= 0) return null
  return Date.now() - ts
}
