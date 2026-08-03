// ═══════════════════════════════════════════════════════════════
// LGPD Audit Log helper
// ═══════════════════════════════════════════════════════════════
// Art. 37 LGPD — registro de operações de tratamento de dados.
//
// Uso típico (em server actions):
//
//   await logAudit({
//     tenantId:   session.user.tenantId,
//     actorId:    session.user.id,
//     action:     "contact.delete",
//     targetType: "contact",
//     targetId:   contactId,
//     before:     contactSnapshot,
//   })
//
// Fire-and-forget OK: erros no log NÃO devem bloquear a operação principal.

import { supabaseAdmin } from "@/lib/supabase"

export interface AuditEntry {
  tenantId?:    string | null
  actorId?:     string | null
  actorEmail?:  string | null
  action:       string        // "contact.delete" | "tag.apply" | ...
  targetType:   string        // "contact" | "conversation" | "tag" | "tenant"
  targetId?:    string | null
  before?:      unknown
  after?:       unknown
  ip?:          string | null
  userAgent?:   string | null
  metadata?:    Record<string, unknown>
}

/**
 * Grava entrada de audit log. Best-effort: erros são logados mas não lançados,
 * pra não derrubar a operação principal.
 *
 * Nunca logue PII bruta em `before`/`after` — passe `sanitizeForAudit(...)` antes.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await supabaseAdmin.from("audit_log").insert({
      tenant_id:     entry.tenantId ?? null,
      actor_user_id: entry.actorId ?? null,
      actor_email:   entry.actorEmail?.slice(0, 254) ?? null,
      action:        entry.action.slice(0, 80),
      target_type:   entry.targetType.slice(0, 40),
      target_id:     entry.targetId?.slice(0, 80) ?? null,
      before_data:   entry.before ?? null,
      after_data:    entry.after  ?? null,
      ip:            entry.ip?.slice(0, 64) ?? null,
      user_agent:    entry.userAgent?.slice(0, 500) ?? null,
      metadata:      entry.metadata ?? null,
    })
  } catch (err) {
    // NÃO lance — audit log falhar não pode quebrar fluxo principal.
    console.error("[audit] failed to insert", err)
  }
}

/**
 * Remove campos sensíveis (password_hash, tokens, secrets) de um snapshot
 * antes de gravar no audit_log.
 *
 * O audit log tem RLS por tenant, mas é boa prática redact mesmo assim
 * (defense-in-depth + LGPD princípio de minimização).
 */
export function sanitizeForAudit<T extends Record<string, unknown>>(obj: T | null | undefined): Partial<T> | null {
  if (!obj) return null
  const REDACT = new Set([
    "password", "password_hash", "token", "secret",
    "evolution_key", "instance_token", "webhook_secret",
    "meta_access_token", "meta_app_secret", "meta_verify_token",
    "supabase_token", "auth_token", "api_key", "apikey",
  ])
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k.toLowerCase())) {
      clean[k] = "[REDACTED]"
    } else {
      clean[k] = v
    }
  }
  return clean as Partial<T>
}
