"use server"

import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { validatePassword } from "@/lib/password"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"

export async function registerSuperAdmin(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  // Camada 1 — kill-switch durável: uma vez concluído o bootstrap da plataforma,
  // o owner seta SETUP_DISABLED=true no ambiente e o endpoint fica trancado
  // permanentemente, antes de qualquer query no banco.
  if (process.env.SETUP_DISABLED === "true") {
    return { error: "Setup desabilitado." }
  }

  // Camada 2 — fail-CLOSED no count: o error precisa abortar. Se o SELECT
  // falhar (count undefined) NÃO podemos prosseguir e criar um super-admin.
  const { count, error: countErr } = await supabaseAdmin
    .from("platform_admins")
    .select("id", { count: "exact", head: true })
  if (countErr || count == null) {
    console.error("[setup] falha ao validar estado do setup:", countErr)
    return { error: "Não foi possível validar o estado do setup. Tente novamente." }
  }
  if (count > 0) {
    return { error: "Setup já foi concluído." }
  }

  const email    = (formData.get("email") as string)?.trim().toLowerCase()
  const fullName = (formData.get("full_name") as string)?.trim()
  const password = formData.get("password") as string

  if (!email || !fullName) return { error: "Preencha todos os campos." }
  const pwErr = validatePassword(password)
  if (pwErr) return { error: pwErr }

  const passwordHash = await bcrypt.hash(password, 10)

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({ email, full_name: fullName, password_hash: passwordHash })
    .select("id")
    .single()

  if (profileError) {
    console.error("[setup] falha ao criar profile:", profileError)
    return { error: "Não foi possível concluir o cadastro. Tente novamente." }
  }

  // Camada 3 — trava atômica de corrida: advisory lock serializa concorrentes
  // e o insert condicional só funciona com platform_admins VAZIA. Fecha o TOCTOU.
  const { data: bootstrapped, error: bootErr } = await supabaseAdmin
    .rpc("bootstrap_platform_admin", { p_user_id: profile.id })

  if (bootErr || bootstrapped !== true) {
    // corrida perdeu OU já existia admin → desfaz o profile órfão
    await supabaseAdmin.from("profiles").delete().eq("id", profile.id)
    if (bootErr) console.error("[setup] falha no bootstrap_platform_admin:", bootErr)
    return { error: bootErr ? "Erro ao registrar admin." : "Setup já foi concluído." }
  }

  // Device trust: bootstrap único da plataforma, a pessoa acabou de criar a
  // própria conta → semeia confiança pro auto-login não cair em desafio.
  await seedTrustForCurrentDevice(profile.id)

  return { ok: true }
}
