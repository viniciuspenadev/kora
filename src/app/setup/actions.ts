"use server"

import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"

export async function registerSuperAdmin(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { count } = await supabaseAdmin
    .from("platform_admins")
    .select("id", { count: "exact", head: true })

  if ((count ?? 0) > 0) {
    return { error: "Setup já foi concluído." }
  }

  const email    = (formData.get("email") as string)?.trim().toLowerCase()
  const fullName = (formData.get("full_name") as string)?.trim()
  const password = formData.get("password") as string

  if (!email || !password || password.length < 8) {
    return { error: "Preencha todos os campos. Senha mínima de 8 caracteres." }
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({ email, full_name: fullName, password_hash: passwordHash })
    .select("id")
    .single()

  if (profileError) return { error: `Erro ao criar perfil: ${profileError.message}` }

  const { error: adminError } = await supabaseAdmin
    .from("platform_admins")
    .insert({ user_id: profile.id })

  if (adminError) {
    await supabaseAdmin.from("profiles").delete().eq("id", profile.id)
    return { error: `Erro ao registrar admin: ${adminError.message}` }
  }

  return { ok: true }
}
