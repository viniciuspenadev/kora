"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { runDailyReportForTenant } from "@/lib/reports/daily"
import { getEmailTemplate } from "@/lib/email/catalog"
import { sendEmail } from "@/lib/email/send"

/**
 * Actions de teste de email no god mode (platform admin).
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

export interface TenantOption {
  id:   string
  name: string
  slug: string
}

export async function listTenantsForEmailTest(): Promise<TenantOption[]> {
  await requirePlatformAdmin()
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id, name, slug")
    .eq("active", true)
    .order("name")
  return (data ?? []) as TenantOption[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface SendTestResult {
  ok:          boolean
  status:      "sent" | "skipped" | "failed"
  recipients?: number
  reason?:     string
  tenantName:  string
}

/**
 * Dispara o relatório diário pra UM tenant específico do god mode.
 *
 * Comportamento:
 *   - force=true → ignora idempotência (last_sent_at)
 *   - overrideEmails → manda só pra essa lista, ignora config do tenant
 *   - skipUpdateLastSent=true (sempre) → testes não interferem no ciclo normal
 */
export async function adminSendDailyReportTest(opts: {
  tenantId:       string
  overrideEmails?: string[]
}): Promise<SendTestResult> {
  await requirePlatformAdmin()

  let recipientsOverride: string[] | undefined
  if (opts.overrideEmails && opts.overrideEmails.length > 0) {
    const cleaned = opts.overrideEmails
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
    const invalid = cleaned.filter((e) => !EMAIL_RE.test(e))
    if (invalid.length > 0) {
      return { ok: false, status: "failed", reason: `Email inválido: ${invalid[0]}`, tenantName: "—" }
    }
    recipientsOverride = Array.from(new Set(cleaned))
  }

  const result = await runDailyReportForTenant(opts.tenantId, {
    forceSend:           true,
    ignoreDisabled:      true,
    skipUpdateLastSent:  true,
    recipientsOverride,
  })

  return {
    ok:         result.status === "sent",
    status:     result.status,
    recipients: result.recipients,
    reason:     result.reason,
    tenantName: result.tenantName,
  }
}

/**
 * Envio de TESTE de qualquer template do catálogo (preview real via Resend)
 * pra um único email. Não é broadcast — é só pra validar render/entrega.
 */
export async function adminSendTemplateTest(opts: {
  slug:    string
  toEmail: string
}): Promise<{ ok: boolean; error?: string; configured?: boolean }> {
  await requirePlatformAdmin()

  const email = opts.toEmail.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Email inválido" }

  const tpl = getEmailTemplate(opts.slug)
  if (!tpl) return { ok: false, error: "Template não encontrado" }

  const built = tpl.build()
  const res = await sendEmail({
    to:           email,
    subject:      built.subject,
    html:         built.html,
    text:         built.text,
    templateSlug: opts.slug,
    metadata:     { test: true },
  })

  if (res.ok) return { ok: true }
  if (!res.configured) return { ok: false, configured: false, error: "Resend não configurado (RESEND_API_KEY / EMAIL_FROM)" }
  return { ok: false, error: res.error }
}
