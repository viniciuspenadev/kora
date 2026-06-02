"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { autoProvisionWhatsApp, generateWebhookSecret } from "@/lib/whatsapp/provisioning"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  return session
}

export interface InstanceUpdateInput {
  provider?:        "baileys" | "meta_cloud"
  evolution_url?:   string
  evolution_key?:   string
  instance_name?:   string
  webhook_url?:     string | null
}

export async function adminUpdateInstance(id: string, input: InstanceUpdateInput) {
  await requireAdmin()

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.provider      !== undefined) payload.provider      = input.provider
  if (input.evolution_url !== undefined) payload.evolution_url = input.evolution_url.trim().replace(/\/$/, "")
  if (input.evolution_key !== undefined) payload.evolution_key = input.evolution_key.trim()
  if (input.instance_name !== undefined) payload.instance_name = input.instance_name.trim()
  if (input.webhook_url   !== undefined) payload.webhook_url   = input.webhook_url

  const { error } = await supabaseAdmin
    .from("whatsapp_instances")
    .update(payload)
    .eq("id", id)

  if (error) return { error: error.message }

  // Se mudou o webhook_url (e não é nulo), sincroniza com a Evolution.
  // Sem isso, o registro fica no Kora mas a Evolution não sabe pra onde mandar webhooks.
  let webhookSyncError: string | undefined
  if (input.webhook_url) {
    const { data: fresh } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", id)
      .single()

    if (fresh) {
      try {
        const provider = getProvider(fresh)
        await provider.setWebhook(input.webhook_url)
      } catch (err) {
        webhookSyncError = (err as Error).message
      }
    }
  }

  revalidatePath("/admin/whatsapp")
  return { ok: true as const, webhookSyncError }
}

/**
 * Re-empurra o webhook_url atual do DB pra Evolution. Útil quando a
 * instância existe na Evolution mas o webhook foi perdido (restart,
 * recriação, etc) ou quando a instância foi adicionada manualmente.
 */
export async function adminSyncWebhook(id: string) {
  await requireAdmin()

  const { data: instance, error } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !instance) return { error: error?.message ?? "Instância não encontrada" }
  if (!instance.webhook_url) return { error: "Webhook URL vazio. Preencha e salve antes." }

  try {
    const provider = getProvider(instance)
    await provider.setWebhook(instance.webhook_url)
    revalidatePath("/admin/whatsapp")
    return { ok: true as const }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function adminRestartInstance(id: string) {
  await requireAdmin()

  const { data: instance, error } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !instance) return { error: error?.message ?? "Instância não encontrada" }

  try {
    const provider = getProvider(instance)
    await provider.restart()

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        status:             "connecting",
        reconnect_attempts: 0,
        last_error:         null,
        last_heartbeat_at:  new Date().toISOString(),
      })
      .eq("id", id)

    revalidatePath("/admin/whatsapp")
    return { ok: true as const }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function adminForceDisconnect(id: string) {
  await requireAdmin()

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", id)
    .single()

  if (!instance) return { error: "Instância não encontrada" }

  try {
    const provider = getProvider(instance)
    await provider.logout()
  } catch {
    // Provider já desconectado — não bloqueia atualização do DB
  }

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({
      status:            "disconnected",
      phone_number:      null,
      user_disconnected: true,
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", id)

  revalidatePath("/admin/whatsapp")
  return { ok: true as const }
}

/**
 * S3 — Migra uma instância pra URL autenticada do webhook.
 *
 * 1. Gera webhook_secret se ainda não tem
 * 2. Calcula URL nova: `/api/webhooks/evolution/<secret>`
 * 3. Chama Evolution pra reconfigurar (POST setWebhook)
 * 4. Salva URL nova no DB
 *
 * Rota antiga sem secret continua aceitando até esta migração rodar
 * pra todas as instâncias — zero downtime garantido.
 */
export async function adminMigrateWebhookToSecret(id: string) {
  await requireAdmin()

  const { data: instance, error: fetchErr } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", id)
    .single()
  if (fetchErr || !instance) return { error: fetchErr?.message ?? "Instância não encontrada" }

  const webhookBase = process.env.WEBHOOK_BASE_URL
  if (!webhookBase) return { error: "WEBHOOK_BASE_URL não configurada" }

  // Reusa secret se já tem; senão gera novo
  const secret = instance.webhook_secret ?? generateWebhookSecret()
  const newUrl = `${webhookBase.replace(/\/$/, "")}/api/webhooks/evolution/${secret}`

  // 1. Salva secret no DB primeiro (idempotente — se Evolution falhar, retry usa o mesmo secret)
  if (!instance.webhook_secret) {
    const { error: updateErr } = await supabaseAdmin
      .from("whatsapp_instances")
      .update({ webhook_secret: secret })
      .eq("id", id)
    if (updateErr) return { error: `Erro ao salvar secret: ${updateErr.message}` }
  }

  // 2. Chama Evolution pra reconfigurar webhook
  try {
    const provider = getProvider({ ...instance, webhook_secret: secret })
    await provider.setWebhook(newUrl)
  } catch (err) {
    return { error: `Falha ao chamar Evolution: ${(err as Error).message}` }
  }

  // 3. Salva URL nova
  await supabaseAdmin
    .from("whatsapp_instances")
    .update({ webhook_url: newUrl })
    .eq("id", id)

  revalidatePath("/admin/whatsapp")
  return { ok: true as const, newUrl }
}

export async function adminReprovisionInstance(id: string) {
  await requireAdmin()

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, tenant_id, tenants(slug)")
    .eq("id", id)
    .single()

  if (!instance) return { error: "Instância não encontrada" }

  const slug = (instance.tenants as unknown as { slug: string } | null)?.slug
  if (!slug) return { error: "Tenant da instância não encontrado" }

  // Remove o registro atual e recria
  await supabaseAdmin.from("whatsapp_instances").delete().eq("id", id)

  const result = await autoProvisionWhatsApp(instance.tenant_id, slug)
  if (!result.ok) return { error: result.error ?? "Falha no reprovisionamento" }

  revalidatePath("/admin/whatsapp")
  return { ok: true as const, instanceId: result.instanceId }
}

export async function adminDeleteInstance(id: string) {
  await requireAdmin()

  const { error } = await supabaseAdmin
    .from("whatsapp_instances")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/admin/whatsapp")
  return { ok: true as const }
}

export async function adminProvisionForTenant(tenantId: string) {
  await requireAdmin()

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single()

  if (!tenant) return { error: "Tenant não encontrado" }

  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) return { error: "Tenant já tem instância. Use Reprovisionar." }

  const result = await autoProvisionWhatsApp(tenantId, tenant.slug)
  if (!result.ok) return { error: result.error ?? "Falha no provisionamento" }

  revalidatePath("/admin/whatsapp")
  return { ok: true as const, instanceId: result.instanceId }
}
