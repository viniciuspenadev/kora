import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Foto de perfil do usuário LOGADO. URL estável (auth pela sessão). Só serve a
 * própria foto — sem parâmetro de id, então não dá pra enumerar avatares alheios.
 */
export const runtime = "nodejs"

const AVATAR_BUCKET = "chat-attachments"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })

  const { data } = await supabaseAdmin
    .from("profiles").select("avatar_path").eq("id", session.user.id).maybeSingle()
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
