"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * A tela do Kora avisa que a pessoa está usando (a cada minuto, só com a aba à vista ou
 * mexida nos últimos 10 min). Marca a SESSÃO dela — nunca a de outro: o `sid` vem do
 * login, não do navegador. Grava no máximo 1× a cada 45 s por sessão. Leitura em
 * lib/atendimento/presence.ts.
 */
export async function touchPresence(): Promise<void> {
  const session = await auth()
  const sid = session?.user?.sid
  if (!sid || !session.user.id) return
  const now = Date.now()
  await supabaseAdmin.from("user_sessions")
    .update({ last_seen_at: new Date(now).toISOString() })
    .eq("sid", sid).eq("user_id", session.user.id)
    .lt("last_seen_at", new Date(now - 45_000).toISOString())
}
