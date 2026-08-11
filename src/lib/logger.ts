// ═══════════════════════════════════════════════════════════════
// Logger estruturado (pino) com redaction de PII e secrets
// ═══════════════════════════════════════════════════════════════
// Substitui console.log/.error pra:
//   - Output estruturado JSON em produção (parseable por log aggregators)
//   - Pretty print em dev
//   - Redaction automática de campos sensíveis (LGPD + OWASP)
//
// Uso:
//   import { logger } from "@/lib/logger"
//   logger.info({ tenantId, conversationId }, "message dispatched")
//   logger.error({ err, where: "webhook" }, "failed to process")
//
// Os campos listados em `redact` viram "[REDACTED]" antes de gravar log.

import pino from "pino"

const isDev    = process.env.NODE_ENV !== "production"
const logLevel = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info")

// Caminhos a redatar. Cobre PII pessoal + credenciais.
// Sintaxe pino: dot notation, suporta wildcards `*`.
const REDACT_PATHS = [
  // Credenciais / tokens
  "password",
  "password_hash",
  "token",
  "secret",
  "evolution_key",
  "webhook_secret",
  "instance_token",
  "meta_access_token",
  "meta_app_secret",
  "meta_verify_token",
  "supabase_token",
  "auth_token",
  "api_key",
  "apikey",
  "authorization",
  "*.password",
  "*.password_hash",
  "*.token",
  "*.secret",
  "*.evolution_key",
  "*.webhook_secret",
  "*.api_key",
  "*.apikey",
  "*.authorization",
  // PII sensível (LGPD)
  "doc_id",
  "cpf",
  "cnpj",
  "*.doc_id",
  "*.cpf",
  "*.cnpj",
  // Headers de request (que podem ter Bearer tokens)
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",

  // ── 💳 DADO DE CARTÃO (PCI-DSS) ──────────────────────────────────────────
  // 🔴 ADICIONADO ANTES DE EXISTIR ROTA DE CARTÃO, de propósito (2026-08-04).
  //    O dono decidiu processar o pagamento no Kora (não em checkout hospedado), então a
  //    API do Asaas recebe número e CVV no corpo da requisição — o dado transita pelo
  //    nosso backend. Cartão em log é o achado que encerra uma auditoria de PCI, e o
  //    momento de fechar isso é ANTES da primeira linha que toca no cartão, não depois:
  //    depois, o vazamento já aconteceu e vive nos logs retidos.
  //
  // ⚠️ Os wildcards do pino são de UM nível só. Por isso a lista tem as três formas de
  //    cada campo — raiz, `*.campo` e `creditCard.campo`. Confiar só em `*.number` deixaria
  //    passar `body.creditCard.number`, que é exatamente a forma que o Asaas usa.
  //
  // ⚠️ Isto é a SEGUNDA parede. A primeira é não logar o corpo: `lib/asaas/client.ts` loga
  //    só a FORMA (método, caminho, status). Este redactor existe pro dia em que alguém
  //    escrever `logger.error({ ...contexto })` num catch e o contexto carregar o payload.
  "creditCard",
  "*.creditCard",
  "creditCard.number",
  "creditCard.ccv",
  "creditCard.holderName",
  "creditCard.expiryMonth",
  "creditCard.expiryYear",
  "creditCardToken",
  "*.creditCardToken",
  "creditCardHolderInfo",
  "*.creditCardHolderInfo",
  "ccv",
  "*.ccv",
  "holderName",
  "*.holderName",
  "expiryMonth",
  "*.expiryMonth",
  "expiryYear",
  "*.expiryYear",
  // ⚠️ `number` é genérico e vai redatar campos inocentes chamados "number" em log de
  //    debug. É o preço certo a pagar: um log menos legível vale menos que um número de
  //    cartão em texto puro.
  "number",
  "*.number",
]

export const logger = pino({
  level: logLevel,
  base: {
    env: process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths:    REDACT_PATHS,
    censor:   "[REDACTED]",
    remove:   false,
  },
  // Pretty print em dev pra leitura fácil; JSON em prod
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize:     true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore:       "pid,hostname,env",
        },
      }
    : undefined,
})

/**
 * Cria um logger filho com contexto pré-aplicado.
 * Útil pra adicionar tenantId / requestId em todo log de um request:
 *
 *   const log = childLogger({ tenantId: session.user.tenantId })
 *   log.info("doing stuff")
 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings)
}
