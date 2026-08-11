import "server-only"
import { logAudit } from "@/lib/audit"

// ═══════════════════════════════════════════════════════════════
// Trilha do dinheiro — quem mexeu, o quê, e o que mudou
// ═══════════════════════════════════════════════════════════════
//
// 🔴 O ESTADO ANTERIOR, MEDIDO EM 08/08: **zero** chamadas de auditoria em
//    `webhook-handler`, `admin-billing`, `trial-housekeeping`, `billing.ts` e
//    `lifecycle-core`. O único ator cujas ações ficavam registradas era o **cliente**
//    (escolher plano, trocar cartão, regularizar). As do operador e as do sistema, não.
//    Se um cliente ligasse dizendo *"vocês me suspenderam sem avisar"* ou *"eu não
//    cancelei"*, não havia o que responder — e com dois operadores, nem como saber qual
//    dos dois agiu.
//
// 🔑 DIRETRIZ DO DONO (08/08): *"TUDO o que acontece precisa ser auditado."* E ele separou
//    o escopo: as tentativas de pagamento do cliente, tudo o que volta do Asaas, e tudo o
//    que o god mode faz.
//
// 🔑 O QUE ESTA TRILHA ACRESCENTA que o `asaas_webhook_events` não tem: aquela tabela
//    guarda o EVENTO (o que o gateway disse); esta guarda o EFEITO (o que mudou por causa
//    dele). Sem a segunda, dá pra saber que um `PAYMENT_OVERDUE` chegou e não dá pra saber
//    que ele derrubou o acesso de sete pessoas.
//
// ⚠️ NUNCA passe dado de cartão, payload cru ou PII por aqui. O que entra é **estado**:
//    de qual valor para qual valor, e por quê. É o que responde a pergunta de uma disputa
//    sem virar um segundo lugar onde dado sensível mora.

/**
 * Vocabulário fechado. Ação nova entra AQUI — não como string solta no chamador.
 *
 * 🔑 Fechado porque trilha só serve se for CONSULTÁVEL: com string livre, metade vira
 *    `billing.cancel` e metade `billing.canceled`, e a busca por uma delas mente.
 */
export type AcaoDeCobranca =
  // ── o gateway mandou, o sistema agiu ──────────────────────────────────────
  | "billing.liberado"            // pagamento confirmado ⇒ voltou a poder usar
  | "billing.restringido"         // venceu ⇒ degrau 2
  | "billing.assinatura_encerrada" // cancelada no gateway ⇒ carimba até quando vale
  // ── o relógio virou (cron) ────────────────────────────────────────────────
  | "billing.paywall_encerrou"    // passou da carência ⇒ desliga a cobrança
  | "billing.ciclo_encerrado"     // o ciclo pago do cancelamento acabou
  // ── a mão do operador (god mode) ──────────────────────────────────────────
  | "billing.status_alterado"     // mexeu em subscription_status / carência / dia
  | "billing.fatura_baixada"      // marcou paga à mão
  | "billing.fatura_anulada"      // anulou
  | "billing.cobranca_criada"     // add-on ou avulsa
  | "billing.cobranca_removida"

/** De onde partiu a ação. `humano` exige `actorId` — sem ele a trilha não serve pra nada. */
export type OrigemDaAcao = "webhook" | "cron" | "humano"

export interface RegistroDeCobranca {
  tenantId: string
  acao:     AcaoDeCobranca
  origem:   OrigemDaAcao
  /** Obrigatório quando `origem = "humano"`. */
  actorId?:    string | null
  actorEmail?: string | null
  /** O que a ação mirou: a fatura, a cobrança, o pagamento do gateway. */
  alvo?:    { tipo: string; id: string | null }
  /** Estado ANTES e DEPOIS — só campos de cobrança, nunca payload nem cartão. */
  antes?:   Record<string, unknown>
  depois?:  Record<string, unknown>
  /** Contexto: id do pagamento no gateway, valor em centavos, motivo. */
  extra?:   Record<string, unknown>
}

/**
 * Registra um fato de cobrança. Best-effort por herança do `logAudit` — falhar aqui
 * **nunca** pode derrubar a operação que já aconteceu.
 *
 * ⚠️ `system:webhook` / `system:cron` no `actorEmail` é a convenção que distingue máquina
 *    de gente. Não use esses valores numa ação humana: já aconteceu de uma transição feita
 *    à mão ficar marcada como `system:cron` e induzir a leitura errada depois.
 */
export async function auditarCobranca(r: RegistroDeCobranca): Promise<void> {
  await logAudit({
    tenantId:   r.tenantId,
    actorId:    r.origem === "humano" ? (r.actorId ?? null) : null,
    actorEmail: r.origem === "humano" ? (r.actorEmail ?? null) : `system:${r.origem}`,
    action:     r.acao,
    targetType: r.alvo?.tipo ?? "tenant",
    targetId:   r.alvo?.id ?? r.tenantId,
    before:     r.antes  ?? null,
    after:      r.depois ?? null,
    metadata:   { origem: r.origem, ...(r.extra ?? {}) },
  })
}
