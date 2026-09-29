import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret, isEncryptionEnabled } from "@/lib/crypto/secrets"

/**
 * Backfill ÚNICO de cifragem dos segredos das instâncias (ver docs/security.md §5).
 * Roda no servidor (onde a ENCRYPTION_KEY está setada). Idempotente: valor já
 * cifrado (`enc:v1:`) passa direto. Platform admin only.
 *
 * Uso: logado como platform admin, acessar /api/admin/secrets-backfill UMA vez
 * depois de setar a ENCRYPTION_KEY no EasyPanel. Pode rodar de novo sem risco.
 */
export const runtime = "nodejs"

const SECRET_COLS = ["evolution_key", "meta_access_token", "meta_app_secret", "meta_verify_token"] as const

export async function GET() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  if (!isEncryptionEnabled()) {
    return NextResponse.json({ error: "ENCRYPTION_KEY não configurada no servidor." }, { status: 503 })
  }

  const { data: rows, error } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, evolution_key, meta_access_token, meta_app_secret, meta_verify_token")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let instancesUpdated = 0
  let secretsEncrypted = 0
  for (const row of rows ?? []) {
    const patch: Record<string, string> = {}
    for (const col of SECRET_COLS) {
      const val = (row as Record<string, string | null>)[col]
      if (val && !val.startsWith("enc:v1:")) {
        patch[col] = encryptSecret(val) as string
        secretsEncrypted++
      }
    }
    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabaseAdmin.from("whatsapp_instances").update(patch).eq("id", row.id)
      if (!upErr) instancesUpdated++
    }
  }

  return NextResponse.json({ ok: true, instancesUpdated, secretsEncrypted })
}
