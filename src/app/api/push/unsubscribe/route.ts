import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Remove a subscription deste device (usuário desligou avisos ou trocou de conta).
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const endpoint = (body as { endpoint?: string } | null)?.endpoint
  if (!endpoint) return NextResponse.json({ error: "bad" }, { status: 400 })

  await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", session.user.id)

  return NextResponse.json({ ok: true })
}
