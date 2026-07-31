import { NextRequest, NextResponse, after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { dispatchEvolutionEvent } from "../route"
import { readWebhookBody } from "@/lib/webhooks/read-capped"

// Cap do body do webhook Evolution (H-01). Generoso: payload Baileys pode carregar mídia
// (base64) — mídia legítima (img/vídeo/áudio ≤16MB) cabe folgado; doc de 100MB já estoura
// o bodySizeLimit global antes de chegar aqui. Env-configurável se um tenant precisar.
const EVOLUTION_WEBHOOK_MAX_BYTES = Number(process.env.EVOLUTION_WEBHOOK_MAX_BYTES ?? 50 * 1024 * 1024)

/**
 * POST /api/webhooks/evolution/[secret]
 *
 * Rota AUTENTICADA pelo secret na URL. Cada instância tem o seu próprio
 * `whatsapp_instances.webhook_secret`. Se o secret não bate, 401.
 *
 * Padrão da indústria (Stripe/GitHub/Slack/Twilio webhooks também
 * usam ou path-secret ou HMAC do payload).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ secret: string }> },
) {
  try {
    const { secret } = await params

    // Validação básica do formato (defesa contra timing attack mais leve;
    // PostgREST com index já é constante o suficiente pra produção)
    if (!secret || secret.length < 16 || secret.length > 128) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 })
    }

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, tenant_id, evolution_url, evolution_key, instance_name")
      .eq("webhook_secret", secret)
      .maybeSingle()

    if (!instance) {
      // Resposta genérica — não confirma se secret existe ou não
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // H-01: teto de bytes ANTES de materializar (secret-gated, mas evita heap-DoS
    // de quem possui/vaza o secret). Só lê o corpo APÓS validar o secret + a instância.
    const read = await readWebhookBody(req, EVOLUTION_WEBHOOK_MAX_BYTES)
    if ("reject" in read) return read.reject
    let body
    try { body = JSON.parse(read.raw) } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }) }
    if (!body.event) {
      return NextResponse.json({ error: "Missing event" }, { status: 400 })
    }

    // ACK 200 imediato. Evolution não re-tenta = sem duplicatas no DB.
    // O processamento (insert, mídia, AI, automações) roda em background.
    after(async () => {
      try {
        await dispatchEvolutionEvent(instance, body)
      } catch (err) {
        console.error("[Webhook Evolution] dispatch failed in after():", err)
      }
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[Webhook Evolution] secret-route", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
