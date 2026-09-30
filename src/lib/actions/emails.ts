"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Actions de gestão do outbox de emails (admin god mode).
 *
 * Acesso restrito a platform admin — usuários do tenant não veem outbox.
 * Pra ver o histórico de envios do próprio tenant, futura Sprint adiciona
 * UI tenant-scoped em /configuracoes/emails.
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

export interface EmailOutboxRow {
  id:            string
  tenantId:      string | null
  tenantName:    string | null
  templateSlug:  string
  toEmail:       string
  subject:       string
  resendId:      string | null
  status:        "pending" | "sent" | "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed"
  error:         string | null
  metadata:      Record<string, unknown>
  createdAt:     string
  sentAt:        string | null
  deliveredAt:   string | null
  openedAt:      string | null
  clickedAt:     string | null
  bouncedAt:     string | null
  complainedAt:  string | null
}

export interface EmailOutboxFilters {
  status?:       string  // 'all' | um dos status
  templateSlug?: string
  tenantId?:     string
  search?:       string  // ILIKE em to_email
  limit?:        number
}

export async function listEmailOutbox(filters: EmailOutboxFilters = {}): Promise<{
  rows:  EmailOutboxRow[]
  total: number
}> {
  await requirePlatformAdmin()
  const limit = Math.min(filters.limit ?? 100, 500)

  let q = supabaseAdmin
    .from("email_outbox")
    .select(`
      id, tenant_id, template_slug, to_email, subject, resend_id, status, error, metadata,
      created_at, sent_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at,
      tenants ( name )
    `, { count: "exact" })

  if (filters.status && filters.status !== "all") q = q.eq("status", filters.status)
  if (filters.templateSlug)                       q = q.eq("template_slug", filters.templateSlug)
  if (filters.tenantId)                           q = q.eq("tenant_id", filters.tenantId)
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_\\]/g, (m) => "\\" + m)}%`
    q = q.ilike("to_email", term)
  }

  q = q.order("created_at", { ascending: false }).limit(limit)

  const { data, error, count } = await q
  if (error) throw new Error(`listEmailOutbox: ${error.message}`)

  const rows: EmailOutboxRow[] = (data ?? []).map((r) => {
    const tRaw = (r as unknown as { tenants: unknown }).tenants
    const t = Array.isArray(tRaw) ? (tRaw[0] as { name: string } | undefined) : (tRaw as { name: string } | null)
    return {
      id:            r.id,
      tenantId:      r.tenant_id,
      tenantName:    t?.name ?? null,
      templateSlug:  r.template_slug,
      toEmail:       r.to_email,
      subject:       r.subject,
      resendId:      r.resend_id,
      status:        r.status as EmailOutboxRow["status"],
      error:         r.error,
      metadata:      (r.metadata ?? {}) as Record<string, unknown>,
      createdAt:     r.created_at,
      sentAt:        r.sent_at,
      deliveredAt:   r.delivered_at,
      openedAt:      r.opened_at,
      clickedAt:     r.clicked_at,
      bouncedAt:     r.bounced_at,
      complainedAt:  r.complained_at,
    }
  })

  return { rows, total: count ?? rows.length }
}

export interface OutboxStats {
  total:       number
  delivered:   number
  opened:      number
  bounced:     number
  failed:      number
  deliveryPct: number
  openPct:     number
  bouncePct:   number
}

/**
 * KPIs agregados últimos N dias. Usado nos cards do topo da página de log.
 */
export async function getEmailOutboxStats(daysBack = 30): Promise<OutboxStats> {
  await requirePlatformAdmin()
  const since = new Date(Date.now() - daysBack * 86400_000).toISOString()

  const { data } = await supabaseAdmin
    .from("email_outbox")
    .select("status")
    .gte("created_at", since)

  const rows = data ?? []
  const total = rows.length
  const delivered = rows.filter((r) => ["delivered", "opened", "clicked"].includes(r.status)).length
  const opened    = rows.filter((r) => ["opened", "clicked"].includes(r.status)).length
  const bounced   = rows.filter((r) => r.status === "bounced").length
  const failed    = rows.filter((r) => r.status === "failed").length

  return {
    total,
    delivered,
    opened,
    bounced,
    failed,
    deliveryPct: total > 0 ? Math.round((delivered / total) * 100) : 0,
    openPct:     total > 0 ? Math.round((opened    / total) * 100) : 0,
    bouncePct:   total > 0 ? Math.round((bounced   / total) * 100) : 0,
  }
}
