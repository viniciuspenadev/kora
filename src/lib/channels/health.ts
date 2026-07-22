import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { sendPushToUsers } from "@/lib/push/send"
import { sendEmail, buildHealthAlertEmail } from "@/lib/email/send"

/**
 * Saúde do número oficial — ingestão dos webhooks de conta/qualidade da Cloud API
 * (account_update / phone_number_quality_update / account_alerts /
 *  phone_number_name_update / account_review_update).
 *
 * Estratégia DEFENSIVA (os campos variam por versão da API): o webhook é o
 * GATILHO; a qualidade/tier autoritativos vêm do `getPhoneInfo`. Guardamos o
 * `value` cru pra auditoria. Restrição/ban só existem no webhook → mapeados aqui.
 *
 * Best-effort: nada aqui pode derrubar o webhook (a verdade segue na Meta).
 */

export const HEALTH_FIELDS = new Set([
  "account_update",
  "account_alerts",
  "phone_number_quality_update",
  "phone_number_name_update",
  "account_review_update",
])

type Severity = "info" | "warning" | "critical"

interface MappedHealth {
  event:          string
  severity:       Severity
  reason:         string | null
  /** Novo account_status normalizado (null = não mexe). */
  accountStatus:  string | null
}

interface HealthValue {
  event?:            string
  decision?:         string
  restriction_info?: Array<{ restriction_type?: string; expiration?: number }>
  ban_info?:         { waba_ban_state?: string; waba_ban_date?: string }
  violation_info?:   { violation_type?: string }
  rejection_reason?: string
  current_limit?:    string
}

function joinReasons(v: HealthValue): string | null {
  if (v.restriction_info?.length) return v.restriction_info.map((r) => r.restriction_type).filter(Boolean).join(", ") || null
  if (v.ban_info?.waba_ban_state)  return `Conta desativada (${v.ban_info.waba_ban_state})`
  if (v.violation_info?.violation_type) return v.violation_info.violation_type
  if (v.rejection_reason) return v.rejection_reason
  return null
}

/** Mapeia o (field, value) cru → evento normalizado + severidade + status. */
function mapHealthEvent(field: string, value: HealthValue): MappedHealth {
  const event = (value.event ?? value.decision ?? field).toUpperCase()
  const reason = joinReasons(value)

  if (field === "account_update") {
    if (event === "ACCOUNT_RESTRICTION")               return { event, severity: "critical", reason, accountStatus: "RESTRICTED" }
    if (event === "ACCOUNT_VIOLATION")                 return { event, severity: "critical", reason, accountStatus: "FLAGGED" }
    if (event === "DISABLED_UPDATE" || event === "ACCOUNT_DELETED")
                                                       return { event, severity: "critical", reason, accountStatus: "BANNED" }
    return { event, severity: "info", reason, accountStatus: null }   // VERIFIED_ACCOUNT / PARTNER_ADDED / ...
  }

  if (field === "phone_number_quality_update") {
    if (event === "FLAGGED")   return { event, severity: "warning", reason, accountStatus: "FLAGGED" }
    if (event === "UNFLAGGED") return { event, severity: "info",    reason, accountStatus: "CONNECTED" }
    return { event, severity: "info", reason, accountStatus: null }   // THROUGHPUT_* → só refresca tier
  }

  if (field === "account_review_update") {
    if (event === "REJECTED") return { event, severity: "critical", reason, accountStatus: "REVIEW_REJECTED" }
    return { event, severity: "info", reason, accountStatus: "CONNECTED" }
  }

  if (field === "phone_number_name_update") {
    return { event, severity: event === "REJECTED" ? "warning" : "info", reason, accountStatus: null }
  }

  // account_alerts — alerta genérico da conta.
  return { event, severity: "warning", reason, accountStatus: null }
}

interface HealthInstance {
  id: string; tenant_id: string; provider?: string | null
  meta_phone_number_id?: string | null; meta_business_account_id?: string | null
  meta_access_token?: string | null; meta_app_secret?: string | null
}

async function findInstanceByWaba(wabaId: string): Promise<HealthInstance | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, tenant_id, provider, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("meta_business_account_id", wabaId)
    .eq("provider", "meta_cloud")
    .maybeSingle()
  return (data ?? null) as HealthInstance | null
}

export async function processHealthWebhook(wabaId: string | undefined, field: string, value: HealthValue): Promise<void> {
  if (!wabaId) { console.warn("[meta-health] sem WABA id"); return }
  const instance = await findInstanceByWaba(wabaId)
  if (!instance) { console.warn("[meta-health] instância não achada p/ WABA", wabaId); return }

  const mapped = mapHealthEvent(field, value)

  // 1) Histórico (com value cru pra auditoria — campos variam por versão).
  await supabaseAdmin.from("wa_health_events").insert({
    tenant_id: instance.tenant_id, instance_id: instance.id, waba_id: wabaId,
    field, event: mapped.event, severity: mapped.severity, reason: mapped.reason, detail: value,
  }).then(({ error }) => { if (error) console.error("[meta-health] event", error.message) })

  // 2) Estado autoritativo de qualidade/tier via getPhoneInfo (best-effort).
  let quality: string | null = null
  let tier: string | null = null
  try {
    const provider = new MetaCloudProvider({
      meta_phone_number_id:     instance.meta_phone_number_id ?? "",
      meta_business_account_id: instance.meta_business_account_id ?? "",
      meta_access_token:        decryptSecret(instance.meta_access_token ?? ""),
      meta_app_secret:          decryptSecret(instance.meta_app_secret ?? ""),
    })
    const info = await provider.getPhoneInfo()
    quality = info.quality_rating ?? null
    tier    = info.messaging_limit_tier ?? value.current_limit ?? null
  } catch (e) { console.warn("[meta-health] getPhoneInfo", (e as Error).message); tier = value.current_limit ?? null }

  const patch: Record<string, unknown> = { health_updated_at: new Date().toISOString() }
  if (quality) patch.quality_rating = quality
  if (tier)    patch.messaging_tier = tier
  if (mapped.accountStatus) { patch.account_status = mapped.accountStatus; patch.health_reason = mapped.reason }
  await supabaseAdmin.from("whatsapp_instances").update(patch).eq("id", instance.id)
    .then(({ error }) => { if (error) console.error("[meta-health] instance update", error.message) })

  // 3) Alerta proativo: crítico (restrição/ban/review rejeitado) OU qualidade vermelha.
  const critical = mapped.severity === "critical"
  if (critical || quality === "RED") {
    await notifyHealthAlert(instance.tenant_id, {
      status:  mapped.accountStatus ?? (quality === "RED" ? "Qualidade baixa" : mapped.event),
      reason:  mapped.reason,
      quality, critical: critical,
    }).catch((e) => console.error("[meta-health] alert", e))
  }
}

/** Notifica donos/admins do tenant (push + e-mail) sobre um problema de saúde. */
async function notifyHealthAlert(
  tenantId: string,
  a: { status: string; reason: string | null; quality: string | null; critical: boolean },
): Promise<void> {
  // Donos + admins (quem pode agir sobre a conta).
  const { data: members } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id, role, profiles!tenant_users_user_id_fkey(email, full_name)")
    .eq("tenant_id", tenantId).eq("active", true)
    .in("role", ["owner", "admin"])

  const rows = (members ?? []) as Array<{ user_id: string; profiles?: { email?: string; full_name?: string } | null }>
  const userIds = rows.map((m) => m.user_id)

  const label = a.critical ? "🔴 Número oficial em risco" : "🟡 Qualidade do número caiu"
  const body  = a.critical
    ? `Seu número foi ${a.status.toLowerCase()} pela Meta${a.reason ? ` (${a.reason})` : ""}. Os envios podem estar limitados.`
    : `A qualidade do seu número oficial está baixa. Reveja seus envios para não ser restrito.`

  // Push (best-effort).
  await sendPushToUsers(userIds, { title: label, body, url: "/integracoes/whatsapp-oficial", tag: "wa-health" })

  // E-mail (best-effort) — só pra quem tem e-mail.
  await Promise.all(rows
    .filter((m) => m.profiles?.email)
    .map((m) => {
      const email = buildHealthAlertEmail({ name: m.profiles?.full_name ?? null, status: a.status, reason: a.reason, critical: a.critical })
      return sendEmail({
        to:           m.profiles!.email!,
        subject:      email.subject,
        html:         email.html,
        text:         email.text,
        templateSlug: "whatsapp_health_alert",
        tenantId,
      }).catch(() => {})
    }),
  )
}
