"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { validatePassword } from "@/lib/password"
import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"

const AVATAR_BUCKET = "chat-attachments"
const PAGE = "/configuracoes/perfil"

export interface MyProfile {
  name:      string
  email:     string
  hasAvatar: boolean
}

export async function getMyProfile(): Promise<MyProfile> {
  const session = await auth()
  if (!session?.user?.id) return { name: "", email: "", hasAvatar: false }
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email, avatar_path")
    .eq("id", session.user.id)
    .maybeSingle()
  return { name: data?.full_name ?? "", email: data?.email ?? "", hasAvatar: !!data?.avatar_path }
}

/** Sobe (ou troca) a foto de perfil do usuário logado. */
export async function uploadMyAvatar(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Não autenticado." }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, error: "Selecione uma imagem." }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return { ok: false, error: "Use uma imagem JPG, PNG ou WebP." }
  }
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Imagem muito grande (máx. 5MB)." }

  const buffer = Buffer.from(await file.arrayBuffer())
  const path = `user-avatars/${session.user.id}`
  const { error: upErr } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })
  if (upErr) return { ok: false, error: upErr.message }

  await supabaseAdmin.from("profiles").update({ avatar_path: path }).eq("id", session.user.id)
  revalidatePath(PAGE)
  return { ok: true }
}

export async function removeMyAvatar(): Promise<{ ok: boolean }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false }
  await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([`user-avatars/${session.user.id}`]).catch(() => {})
  await supabaseAdmin.from("profiles").update({ avatar_path: null }).eq("id", session.user.id)
  revalidatePath(PAGE)
  return { ok: true }
}

/** Troca a senha: confirma a atual, valida a nova e (opcional) derruba os outros devices. */
export async function changeMyPassword(
  current: string,
  next: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Não autenticado." }

  const pwErr = validatePassword(next)
  if (pwErr) return { ok: false, error: pwErr }

  const { data: profile } = await supabaseAdmin
    .from("profiles").select("password_hash").eq("id", session.user.id).maybeSingle()
  if (!profile?.password_hash) return { ok: false, error: "Perfil sem senha cadastrada." }

  const valid = await bcrypt.compare(current, profile.password_hash)
  if (!valid) return { ok: false, error: "Senha atual incorreta." }

  const hash = await bcrypt.hash(next, 10)
  await supabaseAdmin.from("profiles").update({ password_hash: hash }).eq("id", session.user.id)

  // Boa prática: trocar a senha encerra as OUTRAS sessões (mantém a atual).
  if (session.user.sid) {
    await supabaseAdmin.from("user_sessions").delete()
      .eq("user_id", session.user.id).neq("sid", session.user.sid)
  }

  revalidatePath(PAGE)
  return { ok: true }
}

export interface MySession {
  id:         string
  ip:         string | null
  userAgent:  string | null
  lastSeenAt: string
  createdAt:  string
  current:    boolean
  active:     boolean
}

export async function listMySessions(): Promise<MySession[]> {
  const session = await auth()
  if (!session?.user?.id) return []
  const { data } = await supabaseAdmin
    .from("user_sessions")
    .select("id, sid, last_ip, user_agent, last_seen_at, created_at")
    .eq("user_id", session.user.id)
    .order("last_seen_at", { ascending: false })

  const cur = session.user.sid
  const now = Date.now()
  return (data ?? []).map((r) => ({
    id:         r.id,
    ip:         r.last_ip,
    userAgent:  r.user_agent,
    lastSeenAt: r.last_seen_at,
    createdAt:  r.created_at,
    current:    !!cur && r.sid === cur,
    active:     now - new Date(r.last_seen_at).getTime() < 10 * 60_000,
  }))
}

/** Revoga uma sessão própria (não dá pra revogar de outro usuário — escopo por user_id). */
export async function revokeMySession(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: "Não autenticado." }
  if (!id) return { ok: false, error: "Sessão inválida." }
  const { error } = await supabaseAdmin
    .from("user_sessions").delete().eq("id", id).eq("user_id", session.user.id)
  if (error) return { ok: false, error: error.message }
  revalidatePath(PAGE)
  return { ok: true }
}
