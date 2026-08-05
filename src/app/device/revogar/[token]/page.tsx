import { verifyRevokeToken } from "@/lib/auth/revoke-link"
import { supabaseAdmin } from "@/lib/supabase"
import { RevokeClient } from "./revoke-client"

// ═══════════════════════════════════════════════════════════════
// Revogação em 1 clique (device trust — F5) — página PÚBLICA
// ═══════════════════════════════════════════════════════════════
// O token assinado do e-mail new_device_login É a credencial (a pessoa pode
// estar longe da própria máquina — não exige login). O GET só VALIDA e mostra;
// a revogação executa no clique (server action) — Outlook/SafeLinks fazem
// prefetch de link de e-mail, revogar no GET viraria auto-revogação acidental.

export const dynamic = "force-dynamic"

export default async function RevokeDevicePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const parsed = verifyRevokeToken(token)

  if (!parsed) {
    return <RevokeClient state="invalid" token={token} deviceLabel={null} />
  }

  const { data: device } = await supabaseAdmin
    .from("auth_devices")
    .select("label")
    .eq("id", parsed.deviceId)
    .maybeSingle()

  return (
    <RevokeClient
      state="ready"
      token={token}
      deviceLabel={(device?.label as string | null) ?? "Dispositivo"}
    />
  )
}
