import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Foto de um usuário (atendente) por id — pra mostrar o agente responsável no
 * inbox/chat. Autorização: só serve se o alvo for do MESMO tenant do solicitante
 * (ou ele mesmo) → sem enumeração cross-tenant de avatares.
 */
export const runtime = "nodejs"

const AVATAR_BUCKET = "chat-attachments"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  const { userId } = await params

  // Autorização: ele mesmo, ou colega do mesmo tenant.
  if (userId !== session.user.id) {
    if (!session.user.tenantId) return new NextResponse("Not found", { status: 404 })
    const { data: member } = await supabaseAdmin
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", userId)
      .eq("tenant_id", session.user.tenantId)
      .maybeSingle()
    if (!member) return new NextResponse("Not found", { status: 404 })
  }

  const { data } = await supabaseAdmin
    .from("profiles").select("avatar_path").eq("id", userId).maybeSingle()
  const path = data?.avatar_path
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).download(path)
  if (error || !blob) return new NextResponse("Not found", { status: 404 })

  const buffer = Buffer.from(await blob.arrayBuffer())
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":  blob.type || "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  })
}
