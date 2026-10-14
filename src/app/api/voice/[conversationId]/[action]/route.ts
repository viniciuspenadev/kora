import { after, NextResponse, type NextRequest } from "next/server"
import { voiceRequest, voiceStatus, voiceTarget } from "@/lib/voice/blue"
import { beginVoiceTimeline, failVoiceTimeline, observeVoiceTimeline } from "@/lib/voice/timeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ conversationId: string; action: string }> }

function result(status: number, data: unknown) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } })
}

function sameOrigin(req: NextRequest) {
  const expected = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!expected || req.headers.get("sec-fetch-site") === "cross-site") return false
  try { return req.headers.get("origin") === new URL(expected).origin }
  catch { return false }
}

async function handle(req: NextRequest, params: Params["params"]) {
  const { conversationId, action } = await params
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return result(404, { error: "Conversa não encontrada" })
  if (req.method === "GET" ? action !== "status" : !["media-ticket", "dial", "hangup"].includes(action)) {
    return result(404, { error: "Operação indisponível" })
  }
  if (req.method === "POST" && (!sameOrigin(req) || !(req.headers.get("content-type") ?? "").startsWith("application/json"))) {
    return result(403, { error: "Requisição não autorizada" })
  }
  try {
    const { config, number, scope } = await voiceTarget(conversationId)
    if (action === "status") {
      const status = await voiceStatus(config)
      const presentedId = req.nextUrl.searchParams.get("callId")
      return result(200, { enabled: status.enabled, ready: status.ready,
        call: status.call ? (presentedId === status.call.id ? status.call : { id: "", state: "busy" }) : null })
    }
    const status = await voiceStatus(config)
    if (action === "media-ticket") {
      if (!status.ready || status.call) return result(409, { error: "Linha ocupada ou voz indisponível" })
      const upstream = await voiceRequest(config, action, "POST")
      if (upstream.status !== 200) return result(upstream.status, { error: "Não foi possível abrir o áudio" })
      const ticket = (upstream.data as { ticket?: unknown }).ticket
      if (typeof ticket !== "string") return result(502, { error: "Ticket inválido" })
      const mediaUrl = new URL(`/voice/media/${encodeURIComponent(config.instanceName)}`, config.url)
      mediaUrl.protocol = "wss:"
      return result(200, { ticket, mediaUrl: mediaUrl.toString() })
    }
    if (action === "dial") {
      if (!status.ready || status.call) return result(409, { error: "Linha ocupada ou voz indisponível" })
      const record = await beginVoiceTimeline(scope.tenantId, conversationId, scope.userId, { instanceId: config.instanceId, destinationNumber: number })
      try {
        const upstream = await fetch(new URL(`/voice/dial/${encodeURIComponent(config.instanceName)}`, config.url), {
          method: "POST", headers: { apikey: config.key, "content-type": "application/json" },
          body: JSON.stringify({ number }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000),
        })
        if (!upstream.ok) {
          await failVoiceTimeline(record, [400, 401, 403, 409, 422].includes(upstream.status))
          return result(upstream.status, { error: "Não foi possível iniciar a ligação" })
        }
        const data = await upstream.json()
        if (typeof data.id !== "string" || !data.id) throw new Error("Ligação sem identificador")
        after(() => observeVoiceTimeline(record, config, data.id))
        return result(202, data)
      } catch (error) { await failVoiceTimeline(record, false); throw error }
    }
    if (!status.call) return result(409, { error: "Nenhuma ligação ativa" })
    const body: unknown = await req.json().catch(() => null)
    const callId = body && typeof body === "object" && "callId" in body ? (body as { callId: unknown }).callId : null
    if (typeof callId !== "string" || callId !== status.call.id) return result(409, { error: "Identificador da ligação inválido" })
    const upstream = await voiceRequest(config, "hangup", "POST")
    return result(upstream.status, upstream.status === 202 ? upstream.data : { error: "Não foi possível desligar" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Voz indisponível"
    if (message === "Não foi possível registrar a tentativa de ligação") return result(503, { error: message })
    const denied = ["Voz não configurada para este número", "Conversa não encontrada", "Ligação não habilitada para este atendente", "Assuma ou participe do atendimento para ligar", "Contato sem telefone válido para ligação"].includes(message)
    return result(denied ? 403 : 502, { error: denied ? message : "Voz indisponível" })
  }
}

export async function GET(req: NextRequest, { params }: Params) { return handle(req, params) }
export async function POST(req: NextRequest, { params }: Params) { return handle(req, params) }
