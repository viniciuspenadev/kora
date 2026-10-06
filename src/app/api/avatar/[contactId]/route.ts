import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Proxy estável da foto de perfil do contato. A URL do CDN da WhatsApp expira, então
 * guardamos os bytes no storage e servimos por aqui (URL fixa = nunca quebra).
 *   - auth + isolamento por tenant (contato precisa ser do tenant da sessão)
 *   - stream dos bytes com Cache-Control → browser cacheia, não martela o proxy
 */
export const runtime = "nodejs"

const AVATAR_BUCKET = "chat-attachments"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) return new NextResponse("Unauthorized", { status: 401 })

  const { contactId } = await params

  const { data: contact } = await supabaseAdmin
    .from("chat_contacts")
    .select("metadata")
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  const path = (contact?.metadata as { avatar_path?: string } | null)?.avatar_path
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).download(path)
  if (error || !blob) return new NextResponse("Not found", { status: 404 })

  const buffer = Buffer.from(await blob.arrayBuffer())
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":  blob.type || "image/jpeg",
      "Cache-Control": "private, max-age=86400",   // 1 dia no browser
    },
  })
}
