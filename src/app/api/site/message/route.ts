import { NextRequest, NextResponse, after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"
import { getOrCreateSiteContact, getOrCreateSiteConversation } from "@/lib/channels/site"
import { runAITurn } from "@/lib/ai/run"

/**
 * POST /api/site/message
 *
 * Widget em modo CHAT: visitante mandou uma mensagem. Persiste como mensagem
 * de contato e dispara a Kora IA (fire-and-forget). O widget busca a resposta
 * via polling em /api/site/messages.
 *
 * Body: { slug, visitor_id, text }
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = rateLimit(`site:message:${ip}`, 30, 60_000)   // 30 msgs/min/IP
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  let body: { slug?: string; visitor_id?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json({ error: "json inválido" }, { status: 400 }))
  }

  const slug      = body.slug?.trim()
  const visitorId = body.visitor_id?.trim()
  const text      = body.text?.trim()
  if (!slug || !visitorId || !text) {
    return cors(NextResponse.json({ error: "campos obrigatórios" }, { status: 400 }))
  }
  if (text.length > 2000) {
    return cors(NextResponse.json({ error: "mensagem muito longa" }, { status: 400 }))
  }

  // Tenant + modo do widget
  const { data: tenant } = await supabaseAdmin
    .from("tenants").select("id, active").eq("slug", slug).maybeSingle()
  if (!tenant?.active) return cors(NextResponse.json({ error: "tenant not found" }, { status: 404 }))

  const { data: cfg } = await supabaseAdmin
    .from("site_widget_config").select("enabled, mode").eq("tenant_id", tenant.id).maybeSingle()
  if (!cfg?.enabled || cfg.mode !== "chat") {
    return cors(NextResponse.json({ error: "chat não habilitado" }, { status: 403 }))
  }

  // Instância WhatsApp do tenant (instance_id é NOT NULL na conversa; não envia no site)
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, tenant_id, provider, evolution_url, evolution_key, instance_name, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenant.id)
    .limit(1)
    .maybeSingle()
  if (!instance) return cors(NextResponse.json({ error: "tenant sem instância" }, { status: 409 }))

  try {
    const contactId = await getOrCreateSiteContact(tenant.id, visitorId)
    const convId    = await getOrCreateSiteConversation(tenant.id, contactId, instance.id)

    // Persiste a mensagem do visitante
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: convId,
      tenant_id:       tenant.id,
      sender_type:     "contact",
      content_type:    "text",
      content:         text,
      status:          "delivered",
      is_private_note: false,
      metadata:        { kind: "site_chat" },
    })
    await supabaseAdmin.from("chat_conversations").update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: text.substring(0, 100),
      updated_at:           new Date().toISOString(),
    }).eq("id", convId)

    // Dispara a IA fora do request (a resposta cai como mensagem 'bot', o
    // widget pega via polling). Sem debounce: chat ao vivo quer resposta já.
    after(async () => {
      try {
        await runAITurn({ tenantId: tenant.id, conversationId: convId, incomingText: text, instance })
      } catch (err) {
        console.error("[/api/site/message] runAITurn falhou:", err)
      }
    })

    return cors(NextResponse.json({ ok: true, conversation_id: convId }))
  } catch (err) {
    console.error("[/api/site/message] erro:", err)
    return cors(NextResponse.json({ error: "erro ao processar" }, { status: 500 }))
  }
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

function cors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*")
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.headers.set("Access-Control-Allow-Headers", "Content-Type")
  return res
}
