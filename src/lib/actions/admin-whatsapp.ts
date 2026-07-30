"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { encryptSecret } from "@/lib/crypto/secrets"
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
  if (input.evolution_key !== undefined) payload.evolution_key = encryptSecret(input.evolution_key.trim())
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

  // ⚠️ As conversas apontam pra este número. A FK é `ON DELETE SET NULL` (migration
  // 20260729) — antes era CASCADE, que APAGAVA conversa, mensagem e linha do tempo junto.
  // Só que SET NULL sozinho também quebra: conversa de WhatsApp sem instância não consegue
  // mais ser respondida (`getProviderForInstance(null)` lança) e o contato acaba com dois
  // fios ativos. Por isso o reprovisionamento RE-APONTA explicitamente, em vez de confiar
  // no comportamento da FK.
  // Só as da família WhatsApp: as de Instagram/site que ainda carregam este id emprestado
  // NÃO devem ser reatadas a número nenhum — elas nascem sem número por desenho.
  const { count: convCount } = await supabaseAdmin
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("instance_id", id)
    .or("channel.is.null,channel.in.(whatsapp,meta_cloud)")

  // Marca QUAIS conversas eram deste número, pra reatar exatamente elas depois. Sem isso
  // o repoint pegava toda órfã do tenant — inclusive as deixadas por um delete anterior de
  // um número DIFERENTE — e realocava histórico entre números, sem rastro.
  const { data: ownedConvs } = await supabaseAdmin
    .from("chat_conversations")
    .select("id")
    .eq("instance_id", id)
    .or("channel.is.null,channel.in.(whatsapp,meta_cloud)")
  const ownedIds = (ownedConvs ?? []).map((c) => c.id as string)

  await supabaseAdmin.from("whatsapp_instances").delete().eq("id", id)

  const result = await autoProvisionWhatsApp(instance.tenant_id, slug)
  if (!result.ok) return { error: result.error ?? "Falha no reprovisionamento" }

  // Reata as conversas órfãs ao número novo. Falhar aqui é grave (o tenant fica com
  // conversa que não responde), então o erro sobe em vez de sumir no log.
  if (ownedIds.length > 0 && result.instanceId) {
    const { error: repointErr } = await supabaseAdmin
      .from("chat_conversations")
      .update({ instance_id: result.instanceId })
      .in("id", ownedIds)            // exatamente as que eram deste número
      .is("instance_id", null)       // e que a FK acabou de zerar
      .eq("tenant_id", instance.tenant_id)
    if (repointErr) {
      console.error("[admin-whatsapp] repoint:", repointErr.code, repointErr.message)
      return { error: `Número recriado, mas ${convCount} conversa(s) ficaram sem número. Contate o suporte antes de usar.` }
    }
  }

  revalidatePath("/admin/whatsapp")
  return { ok: true as const, instanceId: result.instanceId }
}

export async function adminDeleteInstance(id: string, opts?: { force?: boolean }) {
  await requireAdmin()

  // ⚠️ Apagar um número NÃO é operação isolada: as conversas apontam pra ele. Com a FK
  // `ON DELETE SET NULL` (migration 20260729) o histórico sobrevive — mas as conversas
  // ficam órfãs e não podem mais ser respondidas. Antes da migration era CASCADE: apagava
  // conversa, mensagem e linha do tempo junto, sem aviso.
  // Por isso: avisa e exige confirmação explícita quando há dependência.
  const { count } = await supabaseAdmin
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("instance_id", id)

  if ((count ?? 0) > 0 && !opts?.force) {
    return {
      error: `Este número tem ${count} conversa(s). Apagá-lo deixa esse histórico sem número e sem como responder. Prefira reprovisionar (que reata as conversas ao número novo) ou confirme para apagar mesmo assim.`,
      needsConfirm: true as const,
      conversationCount: count ?? 0,
    }
  }

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
