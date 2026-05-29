"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"
import { autoProvisionWhatsApp } from "@/lib/whatsapp/provisioning"
import { applyDefaultModules } from "@/lib/modules"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  return session
}

const DEFAULT_STAGES = [
  { name: "Triagem",     color: "#94A3B8", is_triage: true,  probability_pct: 0   },
  { name: "Lead",        color: "#3B82F6",                   probability_pct: 20  },
  { name: "Qualificado", color: "#8B5CF6",                   probability_pct: 40  },
  { name: "Proposta",    color: "#F59E0B",                   probability_pct: 70  },
  { name: "Ganho",       color: "#10B981", is_won:  true,    probability_pct: 100 },
  { name: "Perdido",     color: "#EF4444", is_lost: true,    probability_pct: 0   },
] as const

export async function createTenant(formData: FormData): Promise<{ error?: string } | void> {
  const session = await requireAdmin()

  const name       = (formData.get("name") as string)?.trim()
  const slug       = (formData.get("slug") as string)?.trim().toLowerCase()
  const plan       = (formData.get("plan") as string) || "trial"
  const ownerName  = (formData.get("owner_name") as string)?.trim()
  const ownerEmail = (formData.get("owner_email") as string)?.trim().toLowerCase()
  const ownerPass  = formData.get("owner_password") as string

  if (!name || !slug || !ownerName || !ownerEmail || !ownerPass) {
    return { error: "Preencha todos os campos obrigatórios" }
  }
  if (ownerPass.length < 8) {
    return { error: "Senha do owner deve ter pelo menos 8 caracteres" }
  }

  // Slug: minúsculas, dígitos, hífens — 3 a 40 chars
  // Bloqueia path traversal (/api/...), reserved words, lookalike unicode
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) {
    return { error: "Slug inválido. Use 3-40 caracteres entre a-z, 0-9 e hífens (não pode começar/terminar com hífen)." }
  }
  const RESERVED = new Set([
    "admin","api","auth","setup","invite","inbox","kanban","contatos","configuracoes",
    "automacao","w","app","www","help","support","docs","blog","public","static","null","undefined",
  ])
  if (RESERVED.has(slug)) {
    return { error: "Slug reservado pelo sistema. Escolha outro." }
  }

  // Email: validação RFC-ish simples
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || ownerEmail.length > 254) {
    return { error: "Email do owner inválido" }
  }

  let ownerId: string
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", ownerEmail)
    .maybeSingle()

  if (existing) {
    ownerId = existing.id
  } else {
    const passwordHash = await bcrypt.hash(ownerPass, 10)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({ email: ownerEmail, full_name: ownerName, password_hash: passwordHash })
      .select("id")
      .single()
    if (profileError) return { error: `Erro ao criar perfil: ${profileError.message}` }
    ownerId = profile.id
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from("tenants")
    .insert({ name, slug, plan, active: true })
    .select("id")
    .single()
  if (tenantError) return { error: `Erro ao criar tenant: ${tenantError.message}` }

  const { error: muError } = await supabaseAdmin.from("tenant_users").insert({
    tenant_id:  tenant.id,
    user_id:    ownerId,
    role:       "owner",
    active:     true,
    invited_by: session.user.id,
  })
  if (muError) return { error: `Erro ao vincular owner: ${muError.message}` }

  const { data: pipeline } = await supabaseAdmin
    .from("pipelines")
    .insert({
      tenant_id:  tenant.id,
      name:       "Funil padrão",
      color:      "#3B82F6",
      is_default: true,
      position:   0,
      active:     true,
      created_by: ownerId,
    })
    .select("id")
    .single()

  if (pipeline) {
    const stages = DEFAULT_STAGES.map((s, i) => ({
      pipeline_id:     pipeline.id,
      tenant_id:       tenant.id,
      name:            s.name,
      color:           s.color,
      position:        ("is_triage" in s && s.is_triage) ? -1 : i,
      probability_pct: s.probability_pct,
      is_won:          ("is_won"    in s && s.is_won)    ? true : false,
      is_lost:         ("is_lost"   in s && s.is_lost)   ? true : false,
      is_triage:       ("is_triage" in s && s.is_triage) ? true : false,
      show_in_kanban:  ("is_triage" in s && s.is_triage) ? false : true,
    }))
    await supabaseAdmin.from("pipeline_stages").insert(stages)

    await supabaseAdmin
      .from("tenant_config")
      .upsert({ tenant_id: tenant.id, default_pipeline_id: pipeline.id }, { onConflict: "tenant_id" })
  } else {
    await supabaseAdmin.from("tenant_config").insert({ tenant_id: tenant.id })
  }

  // God Mode: habilita módulos default_on (kanban, widget, automações leves, etc).
  // Super-admin pode ajustar depois em /admin/tenants/[id]/modulos.
  await applyDefaultModules(tenant.id)

  // Auto-provisiona instância WhatsApp (fire-and-forget — não falha o createTenant)
  try {
    const result = await autoProvisionWhatsApp(tenant.id, slug)
    if (!result.ok && !result.skipped) {
      console.warn(`[createTenant] auto-provision falhou pra tenant ${slug}:`, result.error)
    }
  } catch (err) {
    console.error("[createTenant] auto-provision throw:", err)
  }

  revalidatePath("/admin/tenants")
  redirect("/admin/tenants")
}

export async function createInvite(formData: FormData): Promise<{ error?: string } | void> {
  const session = await requireAdmin()

  const tenantId = formData.get("tenant_id") as string
  const email    = (formData.get("email") as string)?.trim().toLowerCase()
  const role     = (formData.get("role") as string) || "agent"

  if (!tenantId || !email) return { error: "Selecione tenant e informe email" }
  if (!["owner", "admin", "agent"].includes(role)) return { error: "Papel inválido" }

  const token = randomBytes(24).toString("hex")

  const { error } = await supabaseAdmin.from("invites").insert({
    tenant_id:  tenantId,
    email,
    role,
    token,
    invited_by: session.user.id,
  })
  if (error) return { error: error.message }

  revalidatePath("/admin/invites")
}

export async function deleteInvite(inviteId: string): Promise<void> {
  await requireAdmin()
  await supabaseAdmin.from("invites").delete().eq("id", inviteId)
  revalidatePath("/admin/invites")
}
