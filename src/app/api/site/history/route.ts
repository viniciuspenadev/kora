import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"

/**
 * POST /api/site/history
 *
 * Carga inicial do chat ao (re)abrir o widget: devolve o histórico COMPLETO
 * (visitante + bot + atendente) da conversa do visitante. Sem isso, quem fecha
 * o widget e volta perde as respostas dadas enquanto estava fora (o polling só
 * pega "desde agora"). Resolve a conversa pelo visitor_id — o widget perde o
 * conversation_id no reload da página.
 *
 * Body: { slug, visitor_id }
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = rateLimit(`site:history:${ip}`, 60, 60_000)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  let body: { slug?: string; visitor_id?: string }
  try {
    body = await req.json()
  } catch {
    return cors(NextResponse.json({ error: "json inválido" }, { status: 400 }))
  }

  const slug      = body.slug?.trim()
  const visitorId = body.visitor_id?.trim()
  if (!slug || !visitorId) {
    return cors(NextResponse.json({ error: "campos obrigatórios" }, { status: 400 }))
  }

  const { data: tenant } = await supabaseAdmin
    .from("tenants").select("id, active").eq("slug", slug).maybeSingle()
  if (!tenant?.active) return cors(NextResponse.json({ error: "tenant not found" }, { status: 404 }))

  // Contato-site deste visitante (identidade = primary_external_id).
  const { data: contact } = await supabaseAdmin
    .from("chat_contacts")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("primary_channel", "site")
    .eq("primary_external_id", visitorId)
    .maybeSingle()
  if (!contact) return cors(NextResponse.json({ conversation_id: null, messages: [] }))

  // Conversa de site mais recente do contato.
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, status")
    .eq("tenant_id", tenant.id)
    .eq("contact_id", contact.id)
    .eq("channel", "site")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!conv) return cors(NextResponse.json({ conversation_id: null, messages: [] }))

  // Histórico completo (visitante + bot + atendente). Nota interna fica de fora.
  const { data: msgs } = await supabaseAdmin
    .from("chat_messages")
    .select("content, sender_type, created_at")
    .eq("conversation_id", conv.id)
    .in("sender_type", ["contact", "bot", "agent"])
    .eq("is_private_note", false)
    .not("content", "is", null)
    .order("created_at", { ascending: true })
    .limit(100)

  const messages = (msgs ?? []).map((m) => ({
    sender: m.sender_type === "contact" ? "me" : m.sender_type === "agent" ? "agent" : "bot",
    text:   m.content as string,
    at:     m.created_at as string,
  }))

  return cors(NextResponse.json({ conversation_id: conv.id, messages, status: conv.status }))
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
