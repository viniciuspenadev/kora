import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canViewConversation } from "@/lib/visibility"

/**
 * GET /api/media/[id]
 *
 * Proxy URL estável pra mídia de mensagem. Stream-through: o servidor baixa
 * do Supabase Storage e devolve os bytes pro browser. Browser NUNCA vê a
 * signed URL do Storage.
 *
 * Por que stream-through (e não redirect 302):
 *   - Antes: redirect expunha signed URL com TTL 60s — qualquer um copiando
 *     a URL final podia ver o arquivo por 60s sem autenticação.
 *   - Agora: URL pública é só /api/media/<id>, sempre exige sessão. Sem
 *     sessão → 401. Não importa onde a URL é copiada.
 *
 * Padrão: Notion, Linear, apps com dado privado.
 *
 * Performance: 1 hop extra via Vercel (~50ms). Bandwidth cost trivial pra
 * nosso volume — plano Pro tem 1TB/mês.
 */

const STORAGE_BUCKET = "chat-attachments"

interface LogEntry {
  event:    "media_request"
  msgId:    string
  status:   number
  reason?:  string
  tenantId?: string
  userId?:   string
  sizeBytes?: number
  mime?:     string
  ms:        number
}

function logMedia(entry: LogEntry) {
  // Estruturado em JSON pra Vercel logs serem parseáveis
  // (futuro: enviar pra Logflare/Datadog/etc)
  console.log(JSON.stringify(entry))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const start = Date.now()
  const { id: msgId } = await params

  // ── 1. Auth ─────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user?.tenantId) {
    logMedia({ event: "media_request", msgId, status: 401, reason: "no_session", ms: Date.now() - start })
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  // ── 2. Lookup msg + conv (tenant_id explícito previne IDOR) ─
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from("chat_messages")
    .select(`
      id, conversation_id, tenant_id, metadata, media_mime_type, media_file_name,
      chat_conversations ( assigned_to, participants )
    `)
    .eq("id", msgId)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  if (msgErr || !msg) {
    logMedia({ event: "media_request", msgId, status: 404, reason: "msg_not_found", tenantId: session.user.tenantId, userId: session.user.id, ms: Date.now() - start })
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
  }

  const storagePath = (msg.metadata as { storage_path?: string } | null)?.storage_path
  if (!storagePath) {
    logMedia({ event: "media_request", msgId, status: 404, reason: "no_storage_path", tenantId: session.user.tenantId, userId: session.user.id, ms: Date.now() - start })
    return NextResponse.json({ error: "Mídia indisponível" }, { status: 404 })
  }

  // ── 3. Visibilidade — regra única do sistema (@/lib/visibility) ─
  const conv = msg.chat_conversations as unknown as { assigned_to: string | null; participants: string[] | null } | null
  if (!conv) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 })
  }
  const scope = await getViewerScope()
  if (!canViewConversation(scope, conv)) {
    logMedia({ event: "media_request", msgId, status: 403, reason: "no_visibility", tenantId: session.user.tenantId, userId: session.user.id, ms: Date.now() - start })
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 })
  }

  // ── 4. Download direto do Storage (Blob) ────────────────────
  const { data: blob, error: dlErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .download(storagePath)

  if (dlErr || !blob) {
    logMedia({ event: "media_request", msgId, status: 500, reason: "storage_download_failed", tenantId: session.user.tenantId, userId: session.user.id, ms: Date.now() - start })
    return NextResponse.json({ error: "Falha ao baixar mídia" }, { status: 500 })
  }

  // ── 5. Stream bytes pro browser com headers apropriados ─────
  const mimeType = msg.media_mime_type || blob.type || "application/octet-stream"
  const fileName = (msg.media_file_name as string | null) || `${msgId}`

  logMedia({
    event: "media_request", msgId, status: 200,
    tenantId: session.user.tenantId, userId: session.user.id,
    sizeBytes: blob.size, mime: mimeType, ms: Date.now() - start,
  })

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type":   mimeType,
      "Content-Length": String(blob.size),
      // Cacheável no browser por 1h. Url estável = cache hit em re-renders.
      "Cache-Control":  "private, max-age=3600",
      // Inline em vez de attachment — quem clica em "baixar" usa download
      // attribute do <a>. Vídeo/áudio/imagem renderiza em linha.
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
      // Permite range requests pra audio/video seek (browser pode pular trechos)
      "Accept-Ranges": "bytes",
    },
  })
}
