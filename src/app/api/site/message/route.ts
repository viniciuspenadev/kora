import { NextRequest, NextResponse, after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"
import { isOriginAllowed } from "@/lib/site/domain-guard"
import { getOrCreateSiteContact, getOrCreateSiteConversation } from "@/lib/channels/site"
import { routeAutomationTurn } from "@/lib/ai-v2/dispatch"
import { siteAiWithinBudget } from "@/lib/ai-v2/site-budget"

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
    .from("site_widget_config").select("enabled, mode, allowed_domains").eq("tenant_id", tenant.id).maybeSingle()
  if (!cfg?.enabled || cfg.mode !== "chat") {
    return cors(NextResponse.json({ error: "chat não habilitado" }, { status: 403 }))
  }

  // Origin allowlist (fail-closed)
  if (!isOriginAllowed(req, cfg.allowed_domains as string[] | null)) {
    return cors(NextResponse.json({ error: "origem não autorizada" }, { status: 403 }))
  }

  // ⚠️ O comentário antigo aqui dizia "instance_id é NOT NULL na conversa". Era FALSO — a
  // coluna é nullable desde 20260626. O widget do site NÃO tem número, e emprestar um
  // escondia o canal de atendente escopado, mentia no selo e sujava relatório por número.
  // Pior: a busca era `.limit(1)` SEM `order` — escolha arbitrária. Por isso as conversas
  // de site em produção acabaram espalhadas por DOIS números diferentes.
  //
  // A instância continua sendo carregada, mas só pro motor de automação (contrato do
  // `routeAutomationTurn`); ela NÃO entra mais na conversa. Tenant sem número deixa de
  // levar 409: o widget passa a funcionar em conta site-first.
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, tenant_id, provider, evolution_url, evolution_key, instance_name, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  try {
    const contactId = await getOrCreateSiteContact(tenant.id, visitorId)
    const conv      = await getOrCreateSiteConversation(tenant.id, contactId, null)
    const convId    = conv.id

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
      last_message_dir:     "in",
      updated_at:           new Date().toISOString(),
    }).eq("id", convId)

    // Dispara a IA fora do request (a resposta cai como mensagem 'bot', o
    // widget pega via polling). Sem debounce: chat ao vivo quer resposta já.
    after(async () => {
      try {
        // H-07/H-08: disjuntor de custo de IA anônima. Estourou o budget das últimas 24h →
        // silêncio total (mensagem do visitante já persistida; sem resposta do bot; sem erro).
        if (!(await siteAiWithinBudget(tenant.id))) {
          console.warn(`[/api/site/message] budget de IA do site estourado (tenant ${tenant.id}) — turno ignorado`)
          return
        }
        // Tenant site-first (sem número nenhum) → `instance` é null. O motor exige a forma
        // do provider no contrato, mas o canal `site` não transmite por provider — a
        // resposta é persistida e o widget busca por polling. Objeto vazio satisfaz o
        // contrato sem prometer um provider que não existe.
        await routeAutomationTurn({ tenantId: tenant.id, conversationId: convId, incomingText: text, instance: instance ?? {}, signals: { isReopened: conv.reopened } })
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
