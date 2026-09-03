import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { buildInviteEmail, getAppBaseUrl, sendEmail } from "@/lib/email/send"

export async function deliverOwnerInvite(tenantId: string, inviteId: string): Promise<boolean> {
  const { data: invite, error } = await supabaseAdmin.from("invites")
    .select("email,token,expires_at,accepted_at,tenants(name)").eq("tenant_id", tenantId).eq("id", inviteId).maybeSingle()
  if (error || !invite || invite.accepted_at || new Date(invite.expires_at).getTime() <= Date.now()) return false
  const tenant = invite.tenants as unknown as { name: string } | null
  const mail = buildInviteEmail({
    inviteUrl: `${getAppBaseUrl().replace(/\/$/, "")}/invite/${encodeURIComponent(invite.token)}`,
    tenantName: tenant?.name ?? "sua empresa", roleLabel: "responsável pela empresa", expiresInDays: 7,
  })
  try {
    const result = await sendEmail({ ...mail, to: invite.email, tenantId, templateSlug: "invite",
      dedupeKey: `onboarding:${inviteId}:${invite.expires_at}` })
    if (!result.ok) return false
    // A dedupe receipt alone does not prove delivery to the provider.
    if ("duplicate" in result && result.duplicate) {
      const { data } = await supabaseAdmin.from("email_outbox").select("status")
        .eq("dedupe_key", `onboarding:${inviteId}:${invite.expires_at}`).maybeSingle()
      return ["sent", "delivered", "opened", "clicked"].includes(data?.status ?? "")
    }
    return true
  } catch { return false }
}
