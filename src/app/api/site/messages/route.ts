import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"
import { isOriginAllowed } from "@/lib/site/domain-guard"

/**
 * POST /api/site/messages
 *
 * Polling do widget (modo chat): retorna as RESPOSTAS (bot/atendente) da
 * conversa desde `since`. O visitante só lê a PRÓPRIA conversa (validado por
 * visitor_id == primary_external_id do contato).
 *
 * Body: { slug, visitor_id, conversation_id, since? (ISO) }
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = rateLimit(`site:messages:${ip}`, 120, 60_000)   // polling: 120/min/IP (~2s)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  let body: { slug?: string; visitor_id?: string; conversation_id?: string; since?: string }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json({ error: "json inválido" }, { status: 400 }))
  }

  const slug      = body.slug?.trim()
  const visitorId = body.visitor_id?.trim()
  const convId    = body.conversation_id?.trim()
  if (!slug || !visitorId || !convId) {
    return cors(NextResponse.json({ error: "campos obrigatórios" }, { status: 400 }))
  }

  const { data: tenant } = await supabaseAdmin
    .from("tenants").select("id, active").eq("slug", slug).maybeSingle()
  if (!tenant?.active) return cors(NextResponse.json({ error: "tenant not found" }, { status: 404 }))

  // Origin allowlist (fail-closed)
  const { data: wcfg } = await supabaseAdmin
    .from("site_widget_config").select("allowed_domains").eq("tenant_id", tenant.id).maybeSingle()
  if (!isOriginAllowed(req, wcfg?.allowed_domains as string[] | null)) {
    return cors(NextResponse.json({ error: "origem não autorizada" }, { status: 403 }))
  }

  // Segurança: a conversa tem que ser do contato-site DESTE visitante.
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, status, chat_contacts!inner ( primary_channel, primary_external_id )")
    .eq("id", convId)
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  const contact = conv?.chat_contacts as unknown as { primary_channel: string | null; primary_external_id: string | null } | null
  if (!conv || !contact || contact.primary_channel !== "site" || contact.primary_external_id !== visitorId) {
    return cors(NextResponse.json({ error: "acesso negado" }, { status: 403 }))
  }

  // Respostas (bot/atendente) desde `since`. Nota interna fica de fora.
  let q = supabaseAdmin
    .from("chat_messages")
    .select("content, sender_type, created_at")
    .eq("conversation_id", convId)
    .in("sender_type", ["bot", "agent"])
    .eq("is_private_note", false)
    .not("content", "is", null)
    .order("created_at", { ascending: true })
    .limit(50)
  if (body.since) q = q.gt("created_at", body.since)

  const { data: msgs } = await q

  const messages = (msgs ?? []).map((m) => ({
    sender: m.sender_type === "agent" ? "agent" : "bot",
    text:   m.content as string,
    at:     m.created_at as string,
  }))

  return cors(NextResponse.json({ messages, status: conv.status }))
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
