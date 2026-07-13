"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { getProvider, type WhatsAppProvider } from "@/lib/providers"
import { autoProvisionWhatsApp } from "@/lib/whatsapp/provisioning"
import { encryptSecret } from "@/lib/crypto/secrets"
import { transcodeForMeta } from "@/lib/media/transcode"
import { getViewerScope, canViewConversation, seesAllContacts, reachableContactIds } from "@/lib/visibility"
import { isWindowOpen } from "@/lib/channels/policy"
import { getInstagramSender, sendInstagramText } from "@/lib/instagram/api"
import { validateMediaFile } from "@/lib/chat/media-validation"
import { rateLimit } from "@/lib/rate-limit"
import { requireLimit } from "@/lib/limits"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { normalizeWhatsAppPhone } from "@/lib/phone-utils"
import { createNotification } from "@/lib/notifications"
import { logConversationEvent } from "@/lib/atendimento/events"

// ── Helpers ─────────────────────────────────────────────────

/**
 * Provider da instância ESPECÍFICA de uma conversa (multi-instância).
 * Envio sempre sai pela instância dona da conversa (conv.instance_id).
 */
async function getProviderForInstance(instanceId: string, tenantId: string): Promise<WhatsAppProvider> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", instanceId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!data) throw new Error("Instância da conversa não encontrada.")
  return getProvider(data)
}

const QUOTED_LABEL: Record<string, string> = {
  image: "📷 Imagem", video: "🎥 Vídeo", audio: "🎧 Áudio", document: "📎 Documento",
  sticker: "Sticker", location: "📍 Localização", contact: "👤 Contato",
}

/**
 * Monta o `metadata.quoted` de uma mensagem citada (replyTo = whatsapp_msg_id).
 * Resolve o preview a partir da mensagem original já gravada — assim a bolha
 * enviada mostra o card "em resposta a" igual ao recebido.
 */
async function buildQuotedMeta(tenantId: string, replyTo: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from("chat_messages")
    .select("content, content_type, sender_type")
    .eq("tenant_id", tenantId)
    .eq("whatsapp_msg_id", replyTo)
    .maybeSingle()
  if (!data) return { msg_id: replyTo, kind: null, preview: null, participant: null }
  const kind    = (data.content_type as string) ?? "text"
  const preview = ((data.content as string)?.trim()) || QUOTED_LABEL[kind] || "Mensagem"
  return { msg_id: replyTo, kind, preview: preview.slice(0, 200), participant: null }
}

/**
 * Resolve a instância-alvo Baileys: a passada (UI multi-número) ou a 1ª baileys
 * (default/back-compat). Retorna a ROW (pra escopar o update por `id`, não por
 * tenant — senão mexer numa instância afetava TODAS do tenant).
 */
async function resolveBaileysInstance(tenantId: string, instanceId?: string) {
  const base = supabaseAdmin.from("whatsapp_instances").select("*").eq("tenant_id", tenantId)
  const { data } = instanceId
    ? await base.eq("id", instanceId).maybeSingle()
    : await base.eq("provider", "baileys").order("created_at", { ascending: true }).limit(1).maybeSingle()
  return data
}

// ── Configuração ────────────────────────────────────────────

export async function saveWhatsAppConfig(formData: {
  evolution_url:   string
  evolution_key:   string
  instance_name:   string
  webhook_url?:    string
}) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")

  const tenantId = session.user.tenantId

  // Multi-número: dedup pelo instance_name (UNIQUE por tenant), NÃO por "a 1ª baileys".
  // Nome existente → edita aquela instância; nome novo → cria um número novo.
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("instance_name", formData.instance_name)
    .maybeSingle()

  if (existing) {
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        evolution_url:  formData.evolution_url.replace(/\/$/, ""),
        evolution_key:  encryptSecret(formData.evolution_key),
        instance_name:  formData.instance_name,
        webhook_url:    formData.webhook_url || null,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", existing.id)
  } else {
    // Gate de plano (fail-closed): número QR novo conta na cota. requireLimit lança
    // "Limite atingido" — propaga pro cliente (mesmo estilo dos throws desta action).
    await requireLimit(tenantId, "whatsapp_qr")
    await supabaseAdmin
      .from("whatsapp_instances")
      .insert({
        tenant_id:      tenantId,
        provider:       "baileys",
        evolution_url:  formData.evolution_url.replace(/\/$/, ""),
        evolution_key:  encryptSecret(formData.evolution_key),
        instance_name:  formData.instance_name,
        webhook_url:    formData.webhook_url || null,
        status:         "disconnected",
      })
  }

  revalidatePath("/configuracoes/whatsapp")
  return { success: true }
}

/**
 * Adiciona um número QR (Baileys) NOVO — provisiona uma instância na Evolution com um
 * nome amigável (display_name). Gated pelo limite `whatsapp_qr` do plano (fail-closed).
 * owner/admin. Retorna o id da instância criada (pra UI abrir a tela de QR dela).
 */
export async function addQrNumber(displayName: string): Promise<{ id?: string; error?: string }> {
  const session = await auth()
  if (!session) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  const tenantId = session.user.tenantId

  const name = displayName.trim()
  if (!name) return { error: "Dê um nome ao número (ex: Clínica Lotus II)." }

  // Gate de plano (fail-closed): número QR novo conta na cota.
  try { await requireLimit(tenantId, "whatsapp_qr") }
  catch (e) { return { error: (e as Error).message } }

  const { data: t } = await supabaseAdmin.from("tenants").select("slug").eq("id", tenantId).maybeSingle()
  const slug = (t?.slug as string | undefined)?.trim() || tenantId.slice(0, 8)

  const res = await autoProvisionWhatsApp(tenantId, slug, name, { ignoreFeatureFlag: true })
  if (!res.ok || !res.instanceId) return { error: res.error ?? "Falha ao criar o número." }

  revalidatePath("/configuracoes/whatsapp")
  revalidatePath("/integracoes/whatsapp")
  return { id: res.instanceId }
}

/**
 * Renomeia um número (display_name) — Meta ou QR. owner/admin; anti-IDOR via tenant_id
 * (só renomeia instância DO tenant). Nome vazio → volta pro default (display_name null).
 */
export async function renameNumber(instanceId: string, displayName: string): Promise<{ error?: string }> {
  const session = await auth()
  if (!session) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }

  const { error } = await supabaseAdmin
    .from("whatsapp_instances")
    .update({ display_name: displayName.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("tenant_id", session.user.tenantId)
  if (error) return { error: error.message }

  revalidatePath("/integracoes/whatsapp")
  revalidatePath("/configuracoes/whatsapp")
  return {}
}

export async function connectWhatsApp(instanceId?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  // Multi-número: alvo = a instância passada (UI multi-número) OU a 1ª baileys
  // (default/back-compat). Atualiza o status SÓ dessa instância — não de todas do
  // tenant (senão conectar o Baileys marcava a Oficial como qr_pending).
  const base = supabaseAdmin.from("whatsapp_instances").select("*").eq("tenant_id", tenantId)
  const { data: instance } = instanceId
    ? await base.eq("id", instanceId).maybeSingle()
    : await base.eq("provider", "baileys").order("created_at", { ascending: true }).limit(1).maybeSingle()
  if (!instance) throw new Error("WhatsApp não configurado. Acesse Configurações → WhatsApp.")
  const provider = getProvider(instance)
  const now      = new Date().toISOString()

  try {
    const statusResult = await provider.getStatus()
    if (statusResult.state === "open") {
      await supabaseAdmin
        .from("whatsapp_instances")
        .update({
          status:             "connected",
          user_disconnected:  false,
          reconnect_attempts: 0,
          last_heartbeat_at:  now,
          last_error:         null,
          updated_at:         now,
        })
        .eq("id", instance.id)

      return { status: "connected" as const, qrCode: null }
    }
  } catch {
    try {
      await provider.createInstance()
    } catch {
      // Ignora se já existe
    }
  }

  try {
    const qr = await provider.getQrCode()

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        status:             "qr_pending",
        user_disconnected:  false,
        reconnect_attempts: 0,
        last_heartbeat_at:  now,
        last_error:         null,
        updated_at:         now,
      })
      .eq("id", instance.id)

    return {
      status: "qr_pending" as const,
      qrCode: qr.base64 ?? null,
      pairingCode: qr.pairingCode ?? null,
    }
  } catch (err) {
    throw new Error(`Erro ao gerar QR Code: ${(err as Error).message}`)
  }
}

export async function checkConnectionStatus(instanceId?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const instance = await resolveBaileysInstance(session.user.tenantId, instanceId)
  if (!instance) throw new Error("WhatsApp não configurado. Acesse Configurações → WhatsApp.")
  const provider = getProvider(instance)
  const now      = new Date().toISOString()

  try {
    const result = await provider.getStatus()
    const state  = result.state

    const statusMap: Record<string, string> = {
      open:       "connected",
      close:      "disconnected",
      connecting: "connecting",
    }
    const status = statusMap[state ?? "close"] ?? "disconnected"

    const update: Record<string, unknown> = {
      status,
      last_heartbeat_at: now,
      updated_at:        now,
    }
    if (status === "connected") {
      update.reconnect_attempts = 0
      update.last_error         = null
    }

    await supabaseAdmin
      .from("whatsapp_instances")
      .update(update)
      .eq("id", instance.id)

    return { status }
  } catch (err) {
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        last_heartbeat_at: now,
        last_error:        `Health check falhou: ${(err as Error).message}`,
        updated_at:        now,
      })
      .eq("id", instance.id)

    return { status: "disconnected" }
  }
}

export async function disconnectWhatsApp(instanceId?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const instance = await resolveBaileysInstance(session.user.tenantId, instanceId)
  if (!instance) throw new Error("WhatsApp não configurado. Acesse Configurações → WhatsApp.")
  const provider = getProvider(instance)

  // Resiliente: se a sessão na Evolution já não existe (número meio-desconectado),
  // o logout estoura — mas o "desconectar" local NÃO pode falhar por isso. Best-effort.
  try {
    await provider.logout()
  } catch (e) {
    console.error("[disconnectWhatsApp] logout falhou (segue marcando desconectado):", (e as Error).message)
  }

  const now = new Date().toISOString()
  await supabaseAdmin
    .from("whatsapp_instances")
    .update({
      status:             "disconnected",
      phone_number:       null,
      user_disconnected:  true,
      reconnect_attempts: 0,
      last_heartbeat_at:  now,
      last_error:         null,
      updated_at:         now,
    })
    .eq("id", instance.id)

  revalidatePath("/configuracoes/whatsapp")
  return { success: true }
}

export async function configureWebhook(webhookUrl: string, instanceId?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const instance = await resolveBaileysInstance(session.user.tenantId, instanceId)
  if (!instance) throw new Error("WhatsApp não configurado. Acesse Configurações → WhatsApp.")
  const provider = getProvider(instance)
  await provider.setWebhook(webhookUrl)

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
    .eq("id", instance.id)

  return { success: true }
}

// ── Mensagens ───────────────────────────────────────────────

export async function sendMessage(
  conversationId: string,
  content:        string,
  isPrivateNote?: boolean,
  replyTo?:       string,
) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, instance_id, assigned_to, participants, department_id, channel, last_inbound_at, whatsapp_instances!instance_id(provider), chat_contacts(whatsapp_id, phone_number, primary_channel, bsuid, primary_external_id)")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const assignedTo = (conv as { assigned_to: string | null }).assigned_to
  const scope = await getViewerScope()
  if (!canViewConversation(scope, { assigned_to: assignedTo, participants: (conv as { participants?: string[] | null }).participants, department_id: (conv as { department_id?: string | null }).department_id, instance_id: (conv as { instance_id?: string | null }).instance_id })) {
    throw new Error("Sem permissão para responder nesta conversa. Peça para o atendente atribuído te adicionar como participante.")
  }

  // Gate fail-closed da janela de sessão (motor de canal, lib/channels/policy): fora da janela
  // o texto livre é bloqueado — só template reabre. Nota privada é interna (isenta). A UI já
  // avisa, mas a regra de verdade mora aqui — frontend é manipulável.
  const sendInst = (conv as unknown as { whatsapp_instances?: { provider: string | null } | { provider: string | null }[] | null }).whatsapp_instances
  const sendProvider = Array.isArray(sendInst) ? (sendInst[0]?.provider ?? null) : (sendInst?.provider ?? null)
  if (!isPrivateNote && !isWindowOpen((conv as { channel: string | null }).channel, sendProvider, (conv as { last_inbound_at: string | null }).last_inbound_at)) {
    throw new Error("Janela de atendimento fechada — envie um template aprovado pra reabrir a conversa.")
  }

  const isPool = assignedTo === null

  // Pool — primeiro a responder vira responsável (auto-assign).
  // Notas privadas não atribuem (são internas).
  if (isPool && !isPrivateNote) {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ assigned_to: session.user.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .is("assigned_to", null)
    // Evento do ciclo (relatórios): pegou uma conversa da fila/pool.
    await logConversationEvent({ tenantId, conversationId, type: "assigned", actorKind: "agent", actorId: session.user.id, toAgentId: session.user.id, reason: "auto_assign_pool" })
  }

  const contact = conv.chat_contacts as unknown as {
    whatsapp_id: string | null; phone_number: string | null; primary_channel: string | null; bsuid: string | null; primary_external_id: string | null
  }

  // Citação (responder a uma mensagem). Notas privadas não citam pro WhatsApp.
  const quotedMeta = !isPrivateNote && replyTo ? await buildQuotedMeta(tenantId, replyTo) : null
  const replyCtx = !isPrivateNote && replyTo
    ? { id: replyTo, text: typeof quotedMeta?.preview === "string" ? quotedMeta.preview : undefined }
    : undefined

  const { data: msg, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "agent",
      sender_id:       session.user.id,
      content_type:    "text",
      content,
      status:          isPrivateNote ? "delivered" : "pending",
      is_private_note: isPrivateNote ?? false,
      ...(quotedMeta ? { metadata: { quoted: quotedMeta } } : {}),
    })
    .select("id")
    .single()

  if (error || !msg) throw new Error(error?.message ?? "Erro ao salvar mensagem")

  if (!isPrivateNote) {
    const channel = contact.primary_channel ?? "whatsapp"
    if (channel === "whatsapp") {
      try {
        const provider = await getProviderForInstance((conv as { instance_id: string }).instance_id, tenantId)
        const result   = await provider.sendText(contact.phone_number ?? contact.bsuid ?? "", content, replyCtx)

        await supabaseAdmin
          .from("chat_messages")
          .update({ whatsapp_msg_id: result.messageId || null, status: "sent" })
          .eq("id", msg.id)

        // Sinal de "envio ativo" — atualiza health da instance
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({ last_outbound_message_at: new Date().toISOString() })
          .eq("id", (conv as { instance_id: string }).instance_id)
      } catch (err) {
        await supabaseAdmin
          .from("chat_messages")
          .update({ status: "failed" })
          .eq("id", msg.id)
        const m = (err as Error).message ?? ""
        // #131047 = "re-engagement message": a Meta recusou pq a janela de 24h fechou.
        // É a verdade definitiva — sobrepõe nosso cálculo. Mensagem acionável pro atendente.
        if (m.includes("131047")) {
          throw new Error("A janela de 24h fechou — envie um template aprovado pra reabrir a conversa.")
        }
        throw new Error(`Erro ao enviar: ${m}`)
      }
    } else if (channel === "site") {
      // Site-chat: nada a enviar externamente. A msg 'agent' já está persistida;
      // o visitante recebe via polling do widget. Só marca como enviada.
      await supabaseAdmin
        .from("chat_messages")
        .update({ status: "sent" })
        .eq("id", msg.id)
    } else if (channel === "instagram") {
      // Instagram Direct — envia via Graph API (token cifrado da conexão), dentro da
      // janela 24h. Destinatário = IGSID (primary_external_id do contato).
      try {
        const sender = await getInstagramSender(tenantId)
        const igsid  = contact.primary_external_id
        if (!sender) throw new Error("Conta do Instagram não conectada (conecte em Integrações).")
        if (!igsid)  throw new Error("Contato sem identidade do Instagram.")
        const r = await sendInstagramText(sender.igAccountId, igsid, sender.token, content)
        if ("error" in r) throw new Error(r.error)
        await supabaseAdmin.from("chat_messages")
          .update({ whatsapp_msg_id: r.messageId || null, status: "sent" }).eq("id", msg.id)
      } catch (err) {
        await supabaseAdmin.from("chat_messages").update({ status: "failed" }).eq("id", msg.id)
        throw new Error(`Erro ao enviar no Instagram: ${(err as Error).message}`)
      }
    } else {
      await supabaseAdmin
        .from("chat_messages")
        .update({ status: "failed" })
        .eq("id", msg.id)
      throw new Error(`Resposta no canal '${channel}' ainda não suportada`)
    }
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:     new Date().toISOString(),
      last_message_preview: content.substring(0, 100),
      last_message_dir:     "out",
      flagged_pending:      false,
      ai_handling:          false,   // atendente respondeu = humano assumiu, IA sai (decouple)
      updated_at:          new Date().toISOString(),
    })
    .eq("id", conversationId)

  revalidatePath("/inbox")
  return { id: msg.id }
}

/**
 * Envia um TEMPLATE aprovado pra conversa (WhatsApp Oficial). Usado pelo composer
 * quando a janela de 24h está fechada (única forma de reabrir). Espelha o
 * `sendMessage` (permissão + auto-assign + insert + update), mas via template.
 * `displayText` = corpo já renderizado com as variáveis (pra exibir no chat).
 */
export async function sendOfficialTemplate(
  conversationId: string,
  templateName:   string,
  language:       string,
  params:         Array<{ paramName?: string; text: string }>,
  displayText:    string,
  /** Carrossel: corpo/botões por card (pra bolha). A MÍDIA é carregada do storage
   *  server-side por templateName+language — nunca confiada do cliente. */
  carousel?:      Array<{ body: string; buttons: Array<{ type: string; text: string; url?: string }> }>,
): Promise<{ id: string }> {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, instance_id, assigned_to, participants, department_id, chat_contacts(phone_number, primary_channel, bsuid)")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()
  if (!conv) throw new Error("Conversa não encontrada")

  // Carrossel: mídia dos cards mora no NOSSO storage (card_assets) — carrega server-side.
  let cardAssets: Array<{ path: string; mime: string; format: "IMAGE" | "VIDEO" }> | null = null
  if (carousel?.length) {
    const { data: tpl } = await supabaseAdmin.from("wa_templates")
      .select("card_assets").eq("tenant_id", tenantId).eq("name", templateName).eq("language", language).maybeSingle()
    cardAssets = (tpl as { card_assets: Array<{ path: string; mime: string; format: "IMAGE" | "VIDEO" }> | null } | null)?.card_assets ?? null
    if (!cardAssets?.length) throw new Error("Mídia do carrossel não encontrada — recrie o template.")
  }

  const assignedTo = (conv as { assigned_to: string | null }).assigned_to
  const scope = await getViewerScope()
  if (!canViewConversation(scope, { assigned_to: assignedTo, participants: (conv as { participants?: string[] | null }).participants, department_id: (conv as { department_id?: string | null }).department_id, instance_id: (conv as { instance_id?: string | null }).instance_id })) {
    throw new Error("Sem permissão para responder nesta conversa.")
  }
  const isPool = assignedTo === null
  if (isPool) {
    await supabaseAdmin.from("chat_conversations")
      .update({ assigned_to: session.user.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .is("assigned_to", null)
    await logConversationEvent({ tenantId, conversationId, type: "assigned", actorKind: "agent", actorId: session.user.id, toAgentId: session.user.id, reason: "auto_assign_pool" })
  }

  const contact = conv.chat_contacts as unknown as { phone_number: string | null; primary_channel: string | null; bsuid: string | null }

  const { data: msg, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "agent",
      sender_id:       session.user.id,
      content_type:    "text",
      content:         displayText,
      status:          "pending",
      is_private_note: false,
      // metadata.carousel → a bolha renderiza os cards; mídia via /api/template-card.
      metadata:        { template: templateName, language, ...(carousel?.length ? { carousel } : {}) },
    })
    .select("id")
    .single()
  if (error || !msg) throw new Error(error?.message ?? "Erro ao salvar mensagem")

  try {
    const provider = await getProviderForInstance((conv as { instance_id: string }).instance_id, tenantId)
    if (!provider.sendTemplate) throw new Error("Esta instância não suporta templates (use o canal oficial).")
    // Carrossel: sobe a mídia de cada card → media_id, na ordem dos cards.
    let carouselCards: Array<{ index: number; mediaType: "image" | "video"; mediaId: string }> | undefined
    if (carousel?.length && cardAssets?.length) {
      carouselCards = []
      for (let i = 0; i < carousel.length; i++) {
        const asset = cardAssets[i]
        if (!asset) throw new Error(`Card ${i + 1} sem mídia.`)
        const { data: signed } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUrl(asset.path, 300)
        if (!signed?.signedUrl) throw new Error(`Falha ao ler a mídia do card ${i + 1}.`)
        const mediaType = asset.format === "VIDEO" ? "video" as const : "image" as const
        const mediaId = await (provider as unknown as { uploadMediaIdFromUrl: (u: string, t: "image" | "video") => Promise<string> }).uploadMediaIdFromUrl(signed.signedUrl, mediaType)
        carouselCards.push({ index: i, mediaType, mediaId })
      }
    }
    const result   = await provider.sendTemplate(contact.phone_number ?? contact.bsuid ?? "", templateName, language, params.length > 0 ? params : undefined, undefined, carouselCards)
    await supabaseAdmin.from("chat_messages")
      .update({ whatsapp_msg_id: result.messageId || null, status: "sent" })
      .eq("id", msg.id)
    await supabaseAdmin.from("whatsapp_instances")
      .update({ last_outbound_message_at: new Date().toISOString() })
      .eq("id", (conv as { instance_id: string }).instance_id)
  } catch (err) {
    await supabaseAdmin.from("chat_messages").update({ status: "failed" }).eq("id", msg.id)
    throw new Error(`Erro ao enviar template: ${(err as Error).message}`)
  }

  await supabaseAdmin.from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: displayText.substring(0, 100),
      last_message_dir:     "out",
      flagged_pending:      false,
      ai_handling:          false,   // template enviado pelo atendente = humano assumiu (decouple)
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conversationId)

  revalidatePath("/inbox")
  return { id: msg.id }
}

// ── Envio de mídia ──────────────────────────────────────────

const CHAT_BUCKET = "chat-attachments"

function detectMediaType(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  return "document"
}

// Formatos aceitos pela WhatsApp Cloud API (oficial). Documento não restringe.
// Sem transcodificação (ffmpeg) por ora — ver backlog. O Evolution transcodifica, libera tudo.
const META_ACCEPTED_MEDIA: Record<string, string[]> = {
  image: ["image/jpeg", "image/png"],
  video: ["video/mp4", "video/3gpp"],
  audio: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
}
function metaAcceptsMedia(type: string, mime: string): boolean {
  const list = META_ACCEPTED_MEDIA[type]
  if (!list) return true // documento e afins
  return list.includes(mime.toLowerCase().split(";")[0].trim())
}
function metaFormatMessage(type: string): string {
  if (type === "video") return "O WhatsApp Oficial aceita vídeo só em .mp4. Converta o arquivo e envie de novo."
  if (type === "audio") return "O WhatsApp Oficial aceita áudio em .mp3, .ogg, .m4a ou .aac (áudio gravado no navegador não é aceito). Envie um arquivo nesses formatos."
  if (type === "image") return "O WhatsApp Oficial aceita imagem só em .jpg ou .png."
  return "Formato não aceito pelo WhatsApp Oficial."
}

export async function sendChatMedia(conversationId: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado." }

  const file    = formData.get("file") as File | null
  const caption = (formData.get("caption") as string) || ""
  // Flag PTT — gravação de voice note nativa. Quando true e mediaType=audio,
  // usa endpoint sendWhatsAppAudio (cliente vê bolha de áudio nativa do WhatsApp).
  const isVoiceNote = formData.get("ptt") === "1"
  const replyTo     = (formData.get("replyTo") as string) || undefined

  // Validação server-side (defesa em profundidade — client já valida)
  const validation = validateMediaFile(file)
  if (!validation.ok || !file) return { error: validation.error ?? "Arquivo inválido." }

  const tenantId  = session.user.tenantId
  const mediaType = detectMediaType(file.type)

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, instance_id, assigned_to, participants, department_id, channel, last_inbound_at, whatsapp_instances!instance_id(provider), chat_contacts(phone_number, primary_channel, bsuid)")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) return { error: "Conversa não encontrada." }

  // Gate fail-closed da janela de sessão (motor de canal) — fora da janela, mídia/texto livre
  // é bloqueado; só template reabre. A UI já avisa; a regra de verdade mora aqui.
  const mediaInst = (conv as unknown as { whatsapp_instances?: { provider: string | null } | { provider: string | null }[] | null }).whatsapp_instances
  const mediaProvider = Array.isArray(mediaInst) ? (mediaInst[0]?.provider ?? null) : (mediaInst?.provider ?? null)
  if (!isWindowOpen((conv as { channel: string | null }).channel, mediaProvider, (conv as { last_inbound_at: string | null }).last_inbound_at)) {
    return { error: "Janela de atendimento fechada — envie um template aprovado pra reabrir a conversa." }
  }

  // Mídia hoje só sai no WhatsApp. Em canais sem envio de mídia (site-chat),
  // bloqueia com mensagem clara em vez de tentar enviar pra um destino vazio.
  const mediaChannel = (conv.chat_contacts as unknown as { primary_channel: string | null } | null)?.primary_channel ?? "whatsapp"
  if (mediaChannel !== "whatsapp") {
    return { error: "Envio de mídia ainda não disponível nesse canal. Use texto." }
  }

  // WhatsApp Oficial (Meta Cloud) só aceita formatos específicos. Em vez de rejeitar,
  // TRANSCODIFICA pro formato aceito (ffmpeg) — áudio→ogg/opus (voice note), vídeo→mp4,
  // imagem→jpg. O Evolution transcodifica sozinho, então só mexe no oficial.
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("provider")
    .eq("id", (conv as { instance_id: string }).instance_id)
    .maybeSingle()

  let uploadBuffer: Buffer = Buffer.from(await file.arrayBuffer())
  let uploadMime   = file.type
  let uploadName   = file.name

  // No oficial, transcodifica quando: (a) formato não-aceito (webm/.mov), OU
  // (b) é NOTA DE VOZ — o WhatsApp só toca voice note em ogg/opus; mp4 do iOS é
  // "aceito" no upload mas não reproduz ("áudio não disponível"). Força ogg sempre.
  const isVoiceNoteAudio = isVoiceNote && mediaType === "audio"
  const needsTranscode = inst?.provider === "meta_cloud" &&
    (isVoiceNoteAudio || !metaAcceptsMedia(mediaType, file.type))

  if (needsTranscode) {
    try {
      const tc = await transcodeForMeta(uploadBuffer, mediaType)
      if (!tc) return { error: metaFormatMessage(mediaType) } // tipo não-transcodificável (documento)
      uploadBuffer = tc.buffer
      uploadMime   = tc.mime
      uploadName   = file.name.replace(/\.[^.]+$/, "") + "." + tc.ext
    } catch (e) {
      console.error("[sendChatMedia] transcode falhou:", (e as Error).message)
      return { error: metaFormatMessage(mediaType) }
    }
  }

  const assignedTo = (conv as { assigned_to: string | null }).assigned_to
  const scope = await getViewerScope()
  if (!canViewConversation(scope, { assigned_to: assignedTo, participants: (conv as { participants?: string[] | null }).participants, department_id: (conv as { department_id?: string | null }).department_id, instance_id: (conv as { instance_id?: string | null }).instance_id })) {
    return { error: "Sem permissão para enviar mídia nesta conversa." }
  }
  const isPool = assignedTo === null

  // Pool — primeiro a enviar mídia vira responsável
  if (isPool) {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ assigned_to: session.user.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .is("assigned_to", null)
    await logConversationEvent({ tenantId, conversationId, type: "assigned", actorKind: "agent", actorId: session.user.id, toAgentId: session.user.id, reason: "auto_assign_pool" })
  }

  const contact = conv.chat_contacts as unknown as { phone_number: string | null; bsuid: string | null }

  const safeName    = uploadName.replace(/[^a-zA-Z0-9.\-_]/g, "_")
  const storagePath = `${tenantId}/${conversationId}/${Date.now()}_${safeName}`

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(CHAT_BUCKET)
    .upload(storagePath, uploadBuffer, { contentType: uploadMime, upsert: false })
  if (uploadErr) return { error: `Falha ao salvar o arquivo: ${uploadErr.message}` }

  const { data: signed, error: urlErr } = await supabaseAdmin.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(storagePath, 3600)
  if (urlErr || !signed) {
    await supabaseAdmin.storage.from(CHAT_BUCKET).remove([storagePath])
    return { error: "Erro ao gerar a URL da mídia." }
  }

  const sendAsVoiceNote = isVoiceNote && mediaType === "audio"
  const quotedMeta = replyTo ? await buildQuotedMeta(tenantId, replyTo) : null
  const replyCtx = replyTo
    ? { id: replyTo, text: typeof quotedMeta?.preview === "string" ? quotedMeta.preview : undefined }
    : undefined

  const { data: msg, error: dbErr } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "agent",
      sender_id:       session.user.id,
      content_type:    mediaType,
      content:         caption || null,
      media_url:       signed.signedUrl,
      media_mime_type: uploadMime,
      media_file_name: uploadName,
      status:          "pending",
      is_private_note: false,
      metadata:        { storage_path: storagePath, ...(sendAsVoiceNote ? { is_voice_note: true } : {}), ...(quotedMeta ? { quoted: quotedMeta } : {}) },
    })
    .select("id")
    .single()

  if (dbErr || !msg) {
    await supabaseAdmin.storage.from(CHAT_BUCKET).remove([storagePath])
    return { error: dbErr?.message ?? "Erro ao salvar a mensagem." }
  }

  let providerName = "baileys"
  try {
    const provider = await getProviderForInstance((conv as { instance_id: string }).instance_id, tenantId)
    providerName = provider.providerName
    const result   = sendAsVoiceNote
      ? await provider.sendVoiceNote(contact.phone_number ?? contact.bsuid ?? "", signed.signedUrl)
      : await provider.sendMedia(
          contact.phone_number ?? contact.bsuid ?? "",
          signed.signedUrl,
          mediaType,
          caption || undefined,
          uploadName,
          replyCtx,
        )

    await supabaseAdmin
      .from("chat_messages")
      .update({ whatsapp_msg_id: result.messageId || null, status: "sent" })
      .eq("id", msg.id)

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ last_outbound_message_at: new Date().toISOString() })
      .eq("id", (conv as { instance_id: string }).instance_id)
  } catch (err) {
    await supabaseAdmin
      .from("chat_messages")
      .update({ status: "failed" })
      .eq("id", msg.id)
    const raw = (err as Error).message
    console.error("[sendChatMedia] envio falhou:", raw)
    // Meta Cloud rejeita formatos não suportados (navegador grava áudio/vídeo em webm;
    // iPhone grava vídeo em .mov). O Evolution transcodifica via ffmpeg; a Meta não.
    const fmtHint = providerName === "meta_cloud" && (mediaType === "audio" || mediaType === "video")
      ? ` O WhatsApp Oficial não aceita esse formato de ${mediaType === "audio" ? "áudio" : "vídeo"} (use vídeo .mp4; áudio .mp3/.ogg/.m4a).`
      : ""
    return { error: `Não consegui enviar a mídia.${fmtHint}` }
  }

  const previewLabels: Record<string, string> = {
    image: "📷 Imagem", audio: "🎤 Áudio", video: "📹 Vídeo", document: "📎 Documento",
  }
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: caption || previewLabels[mediaType] || "Mídia",
      last_message_dir:     "out",
      flagged_pending:      false,
      ai_handling:          false,   // mídia enviada pelo atendente = humano assumiu (decouple)
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conversationId)

  revalidatePath("/inbox")
  return { id: msg.id }
}

// ── Mensagens ricas: reação / localização / contato ─────────
// WhatsApp-only (não há equivalente em site-chat). Pattern espelha sendMessage:
// permissão por visibilidade → (auto-assign) → provider → persiste → bump.

interface SendContext { tenantId: string; userId: string; instanceId: string; phone: string }

/** Resolve conversa + valida permissão + (auto-assign). WhatsApp-only. */
async function resolveSendContext(
  conversationId: string, opts?: { autoAssign?: boolean },
): Promise<SendContext | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado." }
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, instance_id, assigned_to, participants, department_id, chat_contacts(phone_number, primary_channel, bsuid)")
    .eq("id", conversationId).eq("tenant_id", tenantId).single()
  if (!conv) return { error: "Conversa não encontrada." }

  const assignedTo = (conv as { assigned_to: string | null }).assigned_to
  const scope = await getViewerScope()
  if (!canViewConversation(scope, {
    assigned_to: assignedTo,
    participants: (conv as { participants?: string[] | null }).participants,
    department_id: (conv as { department_id?: string | null }).department_id,
    instance_id: (conv as { instance_id?: string | null }).instance_id,
  })) return { error: "Sem permissão para esta conversa." }

  const contact = conv.chat_contacts as unknown as { phone_number: string | null; primary_channel: string | null; bsuid: string | null }
  if ((contact.primary_channel ?? "whatsapp") !== "whatsapp") return { error: "Disponível apenas no WhatsApp." }

  if (opts?.autoAssign && assignedTo === null) {
    await supabaseAdmin.from("chat_conversations")
      .update({ assigned_to: session.user.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .is("assigned_to", null)
    await logConversationEvent({ tenantId, conversationId, type: "assigned", actorKind: "agent", actorId: session.user.id, toAgentId: session.user.id, reason: "auto_assign_pool" })
  }

  return { tenantId, userId: session.user.id, instanceId: (conv as { instance_id: string }).instance_id, phone: contact.phone_number ?? contact.bsuid ?? "" }
}

async function bumpConv(conversationId: string, preview: string) {
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: preview,
    last_message_dir: "out", flagged_pending: false, ai_handling: false,   // envio do atendente = humano assumiu (decouple)
    updated_at: new Date().toISOString(),
  }).eq("id", conversationId)
}

/** Reage a uma mensagem com um emoji ("" remove). Não bumpa a conversa (silencioso). */
export async function reactToMessage(
  conversationId: string, targetMessageId: string, emoji: string, targetFromMe?: boolean,
): Promise<{ id: string } | { error: string }> {
  const ctx = await resolveSendContext(conversationId)
  if ("error" in ctx) return ctx
  try {
    const provider = await getProviderForInstance(ctx.instanceId, ctx.tenantId)
    if (!provider.sendReaction) return { error: "Reação não suportada neste canal." }
    const result = await provider.sendReaction(ctx.phone, targetMessageId, emoji, targetFromMe)
    const { data: msg } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId, tenant_id: ctx.tenantId,
      sender_type: "agent", sender_id: ctx.userId,
      content_type: "reaction", content: emoji,
      whatsapp_msg_id: result.messageId || null, status: "sent", is_private_note: false,
      metadata: { reacted_to_id: targetMessageId },
    }).select("id").single()
    return { id: msg?.id ?? "" }
  } catch (err) { return { error: `Não consegui reagir: ${(err as Error).message}` } }
}

/** Envia uma localização (pin no mapa). */
export async function sendLocationMessage(
  conversationId: string, loc: { latitude: number; longitude: number; name?: string; address?: string },
): Promise<{ id: string } | { error: string }> {
  if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return { error: "Coordenadas inválidas." }
  const ctx = await resolveSendContext(conversationId, { autoAssign: true })
  if ("error" in ctx) return ctx
  try {
    const provider = await getProviderForInstance(ctx.instanceId, ctx.tenantId)
    if (!provider.sendLocation) return { error: "Localização não suportada neste canal." }
    const result = await provider.sendLocation(ctx.phone, loc)
    const { data: msg } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId, tenant_id: ctx.tenantId,
      sender_type: "agent", sender_id: ctx.userId,
      content_type: "location", content: `${loc.latitude},${loc.longitude}`,
      whatsapp_msg_id: result.messageId || null, status: "sent", is_private_note: false,
      metadata: { location_name: loc.name ?? null, location_address: loc.address ?? null },
    }).select("id").single()
    await bumpConv(conversationId, "📍 Localização")
    return { id: msg?.id ?? "" }
  } catch (err) { return { error: `Não consegui enviar a localização: ${(err as Error).message}` } }
}

/** Compartilha um contato (vCard). */
export async function sendContactMessage(
  conversationId: string, card: { name: string; phone: string },
): Promise<{ id: string } | { error: string }> {
  if (!card.name?.trim() || !card.phone?.trim()) return { error: "Informe nome e telefone do contato." }
  const ctx = await resolveSendContext(conversationId, { autoAssign: true })
  if ("error" in ctx) return ctx
  const name = card.name.trim(), phone = card.phone.trim()
  try {
    const provider = await getProviderForInstance(ctx.instanceId, ctx.tenantId)
    if (!provider.sendContacts) return { error: "Contato não suportado neste canal." }
    const result = await provider.sendContacts(ctx.phone, [{ name, phones: [{ phone }] }])
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL:${phone}\nEND:VCARD`
    const { data: msg } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId, tenant_id: ctx.tenantId,
      sender_type: "agent", sender_id: ctx.userId,
      content_type: "contact", content: name,
      whatsapp_msg_id: result.messageId || null, status: "sent", is_private_note: false,
      metadata: { contacts: [{ name, vcard }] },
    }).select("id").single()
    await bumpConv(conversationId, "👤 Contato")
    return { id: msg?.id ?? "" }
  } catch (err) { return { error: `Não consegui enviar o contato: ${(err as Error).message}` } }
}

/** Envia uma figurinha (webp). O cliente já manda o arquivo convertido pra webp 512². */
export async function sendStickerMessage(
  conversationId: string, formData: FormData,
): Promise<{ id: string } | { error: string }> {
  const file = formData.get("file") as File | null
  if (!file) return { error: "Arquivo inválido." }
  const ctx = await resolveSendContext(conversationId, { autoAssign: true })
  if ("error" in ctx) return ctx
  try {
    const provider = await getProviderForInstance(ctx.instanceId, ctx.tenantId)
    if (!provider.sendSticker) return { error: "Figurinha não suportada neste canal." }

    const buffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `${ctx.tenantId}/${conversationId}/${Date.now()}_sticker.webp`
    const { error: upErr } = await supabaseAdmin.storage.from(CHAT_BUCKET)
      .upload(storagePath, buffer, { contentType: "image/webp", upsert: false })
    if (upErr) return { error: `Falha ao salvar a figurinha: ${upErr.message}` }
    const { data: signed } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUrl(storagePath, 3600)
    if (!signed?.signedUrl) {
      await supabaseAdmin.storage.from(CHAT_BUCKET).remove([storagePath])
      return { error: "Erro ao gerar a URL da figurinha." }
    }

    const result = await provider.sendSticker(ctx.phone, signed.signedUrl)
    const { data: msg } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId, tenant_id: ctx.tenantId,
      sender_type: "agent", sender_id: ctx.userId,
      content_type: "sticker", content: null,
      media_url: signed.signedUrl, media_mime_type: "image/webp",
      whatsapp_msg_id: result.messageId || null, status: "sent", is_private_note: false,
      metadata: { storage_path: storagePath },
    }).select("id").single()
    await bumpConv(conversationId, "Figurinha")
    return { id: msg?.id ?? "" }
  } catch (err) { return { error: `Não consegui enviar a figurinha: ${(err as Error).message}` } }
}

/** Busca contatos do tenant pro picker de "compartilhar contato" (nome/telefone). */
export async function searchContactsForShare(query: string): Promise<{ id: string; name: string; phone: string }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  // Sanitiza: vírgula/parênteses/% quebram o parser do .or() do PostgREST.
  const q = query.trim().replace(/[,()%*]/g, "").slice(0, 60)
  let req = supabaseAdmin.from("chat_contacts")
    .select("id, custom_name, push_name, phone_number")
    .eq("tenant_id", session.user.tenantId)
    .order("updated_at", { ascending: false })
    .limit(8)
  if (q) req = req.or(`custom_name.ilike.%${q}%,push_name.ilike.%${q}%,phone_number.ilike.%${q}%`)
  const { data } = await req
  return (data ?? []).map((c) => ({
    id:    c.id as string,
    name:  (c.custom_name as string) || (c.push_name as string) || (c.phone_number as string),
    phone: c.phone_number as string,
  }))
}

// ── Gerenciamento de conversas ──────────────────────────────

export async function assignConversation(conversationId: string, agentId: string | null) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  // Gate de visibilidade (fail-closed — a tela é manipulável, a trava é aqui).
  // Modo A: pode atribuir/reatribuir quem é admin/supervisor (view_all), OU é o
  // DONO atual (repassa), OU está PEGANDO DA FILA (conversa sem dono que ele
  // enxerga — pool/setor). Participante NÃO troca o dono.
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, participants, department_id, instance_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!conv) throw new Error("Conversa não encontrada")

  const scope = await getViewerScope()
  const c = conv as { assigned_to: string | null; participants?: string[] | null; department_id?: string | null; instance_id?: string | null }
  const canAssign =
    scope.isAdmin || scope.viewAll ||
    (c.department_id != null && scope.supervisesDepartments.includes(c.department_id)) ||  // supervisor escopado do setor
    c.assigned_to === scope.userId ||
    (c.assigned_to === null && canViewConversation(scope, c))
  if (!canAssign) throw new Error("Sem permissão para atribuir esta conversa.")

  // Valida que agentId (se não-null) pertence ao tenant — bloqueia IDOR
  if (agentId) {
    const { data: member } = await supabaseAdmin
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", agentId)
      .eq("active", true)
      .maybeSingle()
    if (!member) throw new Error("Agente não pertence a este tenant")
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update({ assigned_to: agentId, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  // Evento do ciclo (relatórios): atribuição/retirada manual de dono.
  await logConversationEvent({
    tenantId, conversationId,
    type:      agentId ? "assigned" : "unassigned",
    actorKind: "agent",
    actorId:   session.user.id,
    toAgentId: agentId ?? null,
    reason:    "manual",
  })

  revalidatePath("/inbox")
}

/**
 * Transferência (handoff) — destino é um DEPARTAMENTO (fila do setor ou agente
 * específico do setor) OU um ATENDENTE direto. Distinto de "Participantes"
 * (colaborar sem largar — ver addConversationParticipant).
 *
 *   • department + sem agente → fila do setor: assigned_to=null, department_id=X
 *   • department + agente     → assigned_to=agente, department_id=X
 *   • agent                   → assigned_to=agente, department_id = depto do agente
 *                               (ou mantém o atual se o agente não tiver depto)
 *
 * `stayAsParticipant` adiciona o autor a participants (sai como responsável mas
 * segue vendo/atuando). Visibilidade é union → nunca tira acesso de ninguém.
 */
export async function transferConversation(
  conversationId: string,
  opts: {
    mode:               "department" | "agent" | "pool"
    departmentId?:      string | null
    agentId?:           string | null
    stayAsParticipant?: boolean
  },
): Promise<{ error?: string }> {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, instance_id, assigned_to, participants, department_id, metadata, contact_id, chat_contacts ( custom_name, push_name )")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()
  if (!conv) throw new Error("Conversa não encontrada")

  // Só transfere quem pode ATUAR na conversa (gate de visibilidade único).
  const scope = await getViewerScope()
  if (!canViewConversation(scope, conv as { assigned_to: string | null; participants?: string[] | null; department_id?: string | null; instance_id?: string | null })) {
    return { error: "Sem permissão para transferir esta conversa." }
  }

  // Valida agente (anti-IDOR) e devolve o depto dele. Reusado pelos dois modos.
  async function resolveAgent(agentId: string): Promise<{ deptId: string | null; name: string } | null> {
    const { data: member } = await supabaseAdmin
      .from("tenant_users")
      .select("user_id, department_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", agentId)
      .eq("active", true)
      .maybeSingle()
    if (!member) return null
    const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", agentId).maybeSingle()
    return { deptId: (member as { department_id: string | null }).department_id ?? null, name: prof?.full_name ?? "atendente" }
  }

  let nextAssigned:       string | null
  let nextDepartment:     string | null
  let nextDepartmentName: string | null = null
  let label:              string

  if (opts.mode === "pool") {
    // Devolver pra fila geral — sem responsável e sem setor.
    nextAssigned   = null
    nextDepartment = null
    label          = "a fila geral"
  } else if (opts.mode === "agent") {
    if (!opts.agentId) return { error: "Selecione um atendente." }
    const a = await resolveAgent(opts.agentId)
    if (!a) return { error: "Atendente não pertence a este tenant." }
    nextAssigned   = opts.agentId
    nextDepartment = a.deptId ?? (conv as { department_id: string | null }).department_id ?? null  // herda; não limpa à toa
    label          = a.name
  } else {
    if (!opts.departmentId) return { error: "Selecione um departamento." }
    const { data: dept } = await supabaseAdmin
      .from("tenant_departments")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("id", opts.departmentId)
      .maybeSingle()
    if (!dept) return { error: "Departamento inválido." }
    nextDepartment     = opts.departmentId
    nextDepartmentName = dept.name
    if (opts.agentId) {
      const a = await resolveAgent(opts.agentId)
      if (!a) return { error: "Atendente não pertence a este tenant." }
      nextAssigned = opts.agentId
      label        = `${a.name} (${dept.name})`
    } else {
      nextAssigned = null            // fila do setor
      label        = `o departamento ${dept.name}`
    }
  }

  // "Continuar acompanhando" → autor entra como participante (se não virou o dono).
  let nextParticipants = ((conv as { participants: string[] | null }).participants ?? []) as string[]
  if (opts.stayAsParticipant && session.user.id !== nextAssigned && !nextParticipants.includes(session.user.id)) {
    nextParticipants = [...nextParticipants, session.user.id]
  }

  const now = new Date().toISOString()
  // Controle SAI da IA: uma transferência humana tira a conversa do alcance da
  // IA (corrige o conflito #1 — a fila não é mais "roubada" pela IA na próxima
  // mensagem). Reusa o marcador que o guard já lê (`metadata.ai_routed`) e seta
  // `ai_handling=false` (forward-compat com a unificação do controle — §3 da spec).
  const prevMeta = ((conv as { metadata?: Record<string, unknown> | null }).metadata) ?? {}
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      assigned_to:     nextAssigned,
      department_id:   nextDepartment,
      participants:    nextParticipants,
      ai_handling:     false,
      metadata:        { ...prevMeta, ai_routed: { at: now, by: session.user.id, via: "manual_transfer" } },
      // Bumpa o topo do inbox (igual à IA ao rotear): a conversa sobe pra quem
      // agora a vê — a fila do setor / o novo dono — e desce naturalmente depois.
      last_message_at: now,
      updated_at:      now,
    })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  // Evento do ciclo (relatórios): transferência humana. actor = quem transferiu;
  // from/to = dono anterior → novo destino (atendente e/ou setor).
  await logConversationEvent({
    tenantId, conversationId, type: "transferred",
    actorKind:    "agent",
    actorId:      session.user.id,
    fromAgentId:  (conv as { assigned_to: string | null }).assigned_to ?? null,
    toAgentId:    nextAssigned,
    departmentId: nextDepartment,
    reason:       opts.mode,
  })

  // Nota de sistema (histórico auditável) — nomeia QUEM transferiu, voz ativa.
  const { data: actor } = await supabaseAdmin.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle()
  const who = actor?.full_name ?? "Alguém"
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         opts.mode === "pool"
      ? `${who} devolveu a conversa para ${label}.`
      : `${who} transferiu a conversa para ${label}.`,
    status:          "delivered",
    is_private_note: false,
  })

  // ── Notifica o destino (sininho + push) — ADITIVO, best-effort ──────────
  // Não toca o motor de roteamento; só avisa quem recebeu. Nunca derruba o transfer.
  // Agente-alvo → notifica ele. Fila do setor → notifica os ativos do depto.
  // Pool (fila geral) → sem destino específico, não notifica.
  try {
    const embed = (conv as { chat_contacts?: unknown }).chat_contacts
    const c = (Array.isArray(embed) ? embed[0] : embed) as { custom_name?: string | null; push_name?: string | null } | null
    const contactName = c?.custom_name?.trim() || c?.push_name?.trim() || "um cliente"

    let recipients: string[] = []
    if (nextAssigned) {
      recipients = [nextAssigned]
    } else if (opts.mode === "department" && nextDepartment) {
      const { data: deptMembers } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("department_id", nextDepartment)
        .eq("active", true)
      recipients = (deptMembers ?? []).map((m) => (m as { user_id: string }).user_id)
    }
    recipients = recipients.filter((id) => id && id !== session.user.id)

    if (recipients.length > 0) {
      const isQueue = !nextAssigned && opts.mode === "department"
      await Promise.all(recipients.map((rid) =>
        createNotification({
          tenantId,
          recipientId: rid,
          type:        "transfer_received",
          title:       isQueue ? `Nova conversa em ${nextDepartmentName ?? "seu setor"}` : "Conversa transferida pra você",
          body:        `${who} • ${contactName}`,
          payload:     { conversation_id: conversationId, by: session.user.id, department_id: nextDepartment },
        }),
      ))
    }
  } catch (e) {
    console.error("[transfer notify] falhou:", e)
  }

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return {}
}

const VALID_CONVERSATION_STATUS = new Set(["open", "pending", "resolved", "snoozed"])

export async function updateConversationStatus(conversationId: string, status: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  // Defesa em profundidade: status vem do client; só aceita valores conhecidos.
  if (!VALID_CONVERSATION_STATUS.has(status)) throw new Error("Status inválido")

  const tenantId = session.user.tenantId

  // Visibilidade (anti-IDOR): só mexe no status de conversa que o atendente pode ATUAR.
  // Concluir/Reabrir/Adiar/Pendente são ações principais do header → precisam do gate.
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, instance_id, assigned_to, participants, department_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()
  if (!conv) throw new Error("Conversa não encontrada")
  const scope = await getViewerScope()
  if (!canViewConversation(scope, conv as { assigned_to: string | null; participants?: string[] | null; department_id?: string | null; instance_id?: string | null })) {
    throw new Error("Sem permissão para alterar esta conversa.")
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status,
    updated_at: now,
  }

  if (status === "resolved") {
    updates.unread_count    = 0
    updates.flagged_pending = false
    updates.resolved_at     = now
    updates.ai_handling     = false   // atendimento concluído = IA fora até o retorno (decouple)
  } else {
    // open/pending/snoozed: limpa resolved_at (caso esteja sendo reaberta)
    updates.resolved_at  = null
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update(updates)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  // Evento do ciclo (relatórios): conclusão. Atribui ao atendente que concluiu.
  if (status === "resolved") {
    await logConversationEvent({
      tenantId, conversationId, type: "resolved",
      actorKind: "agent",
      actorId:   session.user.id,
      toAgentId: (conv as { assigned_to: string | null }).assigned_to ?? null,
    })
  }

  revalidatePath("/inbox")
}

export async function markConversationRead(conversationId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({ unread_count: 0, flagged_pending: false, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)
}

// Flag manual de "pendente" — bolinha azul volta mesmo já tendo respondido.
// Limpa sozinha quando o atendente responde (sendMessage/sendChatMedia) ou resolve.
export async function setConversationFlagged(conversationId: string, value: boolean) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({ flagged_pending: value, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

// Fixar conversa no topo da lista. pinned_at = timestamp (ordem entre fixadas) ou null.
export async function setConversationPinned(conversationId: string, value: boolean) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({ pinned_at: value ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

// ── Criar conversa manual ───────────────────────────────────

// normalizePhone unificado em phone-utils.ts → normalizeWhatsAppPhone (internacional, libphonenumber).

export async function searchContacts(query: string) {
  const scope = await getViewerScope()
  if (!scope.tenantId) throw new Error("Não autenticado")

  // Rate-limit: 30/min/sessão. Mitiga enumeração de contatos via PII.
  const rl = rateLimit(`search:contacts:${scope.userId}`, 30, 60_000)
  if (!rl.ok) return []

  const tenantId = scope.tenantId
  const q        = query.trim()
  if (q.length < 2) return []

  // Escopo de Contatos (MESMO motor de /contatos, sem paralelo): quem não vê a base
  // inteira só acha os contatos DELE (por relação). Fecha o "puxar contato alheio"
  // no novo negócio E na nova conversa — as duas telas passam por aqui.
  const reachable = seesAllContacts(scope) ? null : await reachableContactIds(scope)
  let cq = supabaseAdmin
    .from("chat_contacts")
    .select("id, phone_number, push_name, custom_name, email, company")
    .eq("tenant_id", tenantId)
    .or(`custom_name.ilike.%${q}%,push_name.ilike.%${q}%,phone_number.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`)
  if (reachable) cq = cq.in("id", reachable.length ? reachable : ["00000000-0000-0000-0000-000000000000"])
  const { data: contacts } = await cq.limit(8)

  const list = contacts ?? []
  if (list.length === 0) return []

  // Para cada contato encontrado, checa se já tem conversa (ativa OU resolved
  // não-arquivada). Usado na UI pra mostrar badge "já tem conversa" e evitar
  // o atendente pensar que tá criando algo do zero.
  const contactIds = list.map((c) => c.id)
  const { data: convs } = await supabaseAdmin
    .from("chat_conversations")
    .select("contact_id, status, archived_at")
    .eq("tenant_id", tenantId)
    .in("contact_id", contactIds)

  const statusByContact = new Map<string, "active" | "resolved" | null>()
  for (const c of (convs ?? [])) {
    const cid = (c as { contact_id: string }).contact_id
    const st  = (c as { status: string }).status
    const arch = !!(c as { archived_at: string | null }).archived_at
    const current = statusByContact.get(cid)
    // Prioriza active > resolved. Conv arquivada nunca substitui a outra.
    if (arch && current) continue
    if (["open", "pending", "snoozed"].includes(st) && current !== "active") {
      statusByContact.set(cid, "active")
    } else if (st === "resolved" && !current) {
      statusByContact.set(cid, "resolved")
    } else if (!current) {
      statusByContact.set(cid, null)
    }
  }

  return list.map((c) => ({
    ...c,
    conversation_state: statusByContact.get(c.id) ?? null,  // "active" | "resolved" | null
  }))
}

export async function createManualConversation(input: {
  phone?:        string
  contactId?:    string
  pushName?:     string
}) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!instance) throw new Error("WhatsApp não configurado.")

  let contactId = input.contactId ?? null

  if (!contactId) {
    const norm = normalizeWhatsAppPhone(input.phone)
    if (!norm) throw new Error("Telefone inválido. Use DDD + número (ex: 11999998888)")
    // Resolver canônico de identidade (merge-por-chave) — fonte única, dedup-safe.
    const r = await resolveOrCreateContact(
      tenantId,
      { jid: norm.jid, phone: norm.phone },
      { pushName: input.pushName ?? null, source: "whatsapp_outbound" },
    )
    contactId = r.id
  }

  if (!contactId) throw new Error("Falha ao resolver contato")

  // ── Dedup: regra única do Kora (1 conversa viva por contato) ──
  // - Se há ATIVA → reusa
  // - Se há fechada recente (≤7 dias) → reabre (só muda status; stage/lifecycle/won/lost intactos)
  // - Senão → cria nova (continua o fluxo abaixo)
  const dedup = await findOrReopenConversation({ tenantId, contactId, instanceId: instance.id, channel: "whatsapp" })
  if (dedup.found !== "none") {
    revalidatePath("/inbox")
    revalidatePath("/kanban")
    return { id: dedup.conversation.id, reused: true, reopened: dedup.found === "reopened" }
  }

  // Limite de conversas/mês — só conta conversa NOVA iniciada pelo tenant (outbound).
  // Reusar/reabrir acima não conta; inbound (webhooks) flui livre; IA/automação intactas.
  await requireLimit(tenantId, "conversations_per_month")

  let pipelineId: string | null = null
  let stageId:    string | null = null

  const { data: tc } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (tc?.default_pipeline_id) {
    pipelineId = tc.default_pipeline_id
    const { data: firstStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()
    stageId = firstStage?.id ?? null
  }

  const { data: newConv, error: convErr } = await supabaseAdmin
    .from("chat_conversations")
    .insert({
      tenant_id:     tenantId,
      contact_id:    contactId,
      instance_id:   instance.id,
      status:        "open",
      unread_count:  0,
      pipeline_id:   pipelineId,
      stage_id:      stageId,
      card_position: 0,
      assigned_to:   session.user.id,
    })
    .select("id")
    .single()

  // Race: outro atendente/webhook criou conv ao mesmo tempo. UNIQUE index
  // ativo-por-contato dispara 23505 — tentamos dedup de novo pra pegar
  // a conv que ganhou a corrida.
  if (convErr?.code === "23505") {
    const retry = await findOrReopenConversation({ tenantId, contactId, instanceId: instance.id, channel: "whatsapp" })
    if (retry.found !== "none") {
      revalidatePath("/inbox")
      revalidatePath("/kanban")
      return { id: retry.conversation.id, reused: true, reopened: retry.found === "reopened" }
    }
  }

  if (convErr || !newConv) throw new Error(`Erro criando conversa: ${convErr?.message}`)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: newConv.id,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "Conversa iniciada manualmente pelo atendente.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return { id: newConv.id, reused: false }
}

// ── Contato: bloquear / notas ───────────────────────────────

export async function setContactBlocked(contactId: string, blocked: boolean) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_contacts")
    .update({ is_blocked: blocked, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

export async function setContactNotes(contactId: string, notes: string | null) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_contacts")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

export interface ContactInfoInput {
  custom_name?: string | null
  email?:       string | null
  company?:     string | null
  doc_id?:      string | null
  birth_date?:  string | null  // ISO YYYY-MM-DD ou null
  // Contato adicional
  phone_secondary?:       string | null
  phone_secondary_label?: string | null
  // Endereço
  address_cep?:        string | null
  address_street?:     string | null
  address_number?:     string | null
  address_complement?: string | null
  address_district?:   string | null
  address_city?:       string | null
  address_state?:      string | null
  // Consentimento / LGPD
  consent_opt_in?:   boolean | null
  consent_source?:   string | null
  marketing_opt_in?: boolean | null
  /** Tabela de preço do cliente (T2 — "esse cliente é atacado"). Null = padrão. */
  price_table_id?: string | null
}

export async function updateContactInfo(
  contactId: string,
  input:     ContactInfoInput,
): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }

  // Normaliza: strings vazias viram null pra não poluir o banco com ""
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.custom_name !== undefined) payload.custom_name = input.custom_name?.trim() || null
  if (input.email       !== undefined) payload.email       = input.email?.trim().toLowerCase() || null
  if (input.company     !== undefined) payload.company     = input.company?.trim() || null
  if (input.doc_id      !== undefined) payload.doc_id      = input.doc_id?.replace(/\D/g, "") || null
  if (input.birth_date  !== undefined) payload.birth_date  = input.birth_date || null
  // Contato adicional
  if (input.phone_secondary       !== undefined) payload.phone_secondary       = input.phone_secondary?.trim() || null
  if (input.phone_secondary_label !== undefined) payload.phone_secondary_label = input.phone_secondary_label?.trim() || null
  // Endereço
  if (input.address_cep        !== undefined) payload.address_cep        = input.address_cep?.replace(/\D/g, "") || null
  if (input.address_street     !== undefined) payload.address_street     = input.address_street?.trim() || null
  if (input.address_number     !== undefined) payload.address_number     = input.address_number?.trim() || null
  if (input.address_complement !== undefined) payload.address_complement = input.address_complement?.trim() || null
  if (input.address_district   !== undefined) payload.address_district   = input.address_district?.trim() || null
  if (input.address_city       !== undefined) payload.address_city       = input.address_city?.trim() || null
  if (input.address_state      !== undefined) payload.address_state      = input.address_state?.trim().toUpperCase().slice(0, 2) || null
  // Consentimento / LGPD — ao ligar o opt-in, carimba a data se ainda não houver.
  if (input.consent_opt_in   !== undefined) {
    payload.consent_opt_in = input.consent_opt_in
    if (input.consent_opt_in) payload.consent_at = new Date().toISOString()
  }
  if (input.consent_source   !== undefined) payload.consent_source   = input.consent_source?.trim() || null
  if (input.marketing_opt_in !== undefined) payload.marketing_opt_in = input.marketing_opt_in
  // Tabela de preço (T2) — anti-IDOR: a tabela tem que ser DO tenant.
  if (input.price_table_id !== undefined) {
    const next = input.price_table_id || null
    if (next) {
      const { data: tb } = await supabaseAdmin.from("price_tables")
        .select("id").eq("id", next).eq("tenant_id", session.user.tenantId).maybeSingle()
      if (!tb) return { error: "Tabela de preço inválida" }
    }
    payload.price_table_id = next
  }

  // Validação rápida — email no formato básico (não vamos rodar regex perfeita)
  if (payload.email && typeof payload.email === "string" && !payload.email.includes("@")) {
    return { error: "Email inválido" }
  }

  const { error } = await supabaseAdmin
    .from("chat_contacts")
    .update(payload)
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)

  if (error) return { error: error.message }

  revalidatePath("/inbox")
  revalidatePath("/contatos")
  return {}
}

export async function archiveConversation(conversationId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const now = new Date().toISOString()
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      archived_at: now,
      unread_count: 0,
      updated_at:   now,
    })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       session.user.tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "Conversa arquivada.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
}

export async function unarchiveConversation(conversationId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      archived_at: null,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       session.user.tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "Conversa restaurada.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
}

// ── Participantes da conversa (array uuid[]) ────────────────

export async function addConversationParticipant(conversationId: string, userId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, participants")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const isAdmin    = ["owner", "admin"].includes(session.user.role)
  const isAssigned = conv.assigned_to === session.user.id
  if (!isAdmin && !isAssigned) throw new Error("Apenas o atendente atribuído ou administradores podem adicionar participantes.")

  // Valida que userId pertence ao tenant — bloqueia IDOR
  const { data: member } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle()
  if (!member) throw new Error("Usuário não pertence a este tenant")

  const current = (conv.participants ?? []) as string[]
  if (current.includes(userId)) return { ok: true }
  const next = [...current, userId]

  await supabaseAdmin
    .from("chat_conversations")
    .update({ participants: next, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single()

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         `${prof?.full_name ?? "Agente"} foi adicionado à conversa.`,
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  return { ok: true }
}

export async function removeConversationParticipant(conversationId: string, userId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, participants")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const isAdmin    = ["owner", "admin"].includes(session.user.role)
  const isAssigned = conv.assigned_to === session.user.id
  const isSelf     = userId === session.user.id
  if (!isAdmin && !isAssigned && !isSelf) {
    throw new Error("Sem permissão para remover participantes.")
  }

  const current = (conv.participants ?? []) as string[]
  const next    = current.filter((id) => id !== userId)

  await supabaseAdmin
    .from("chat_conversations")
    .update({ participants: next, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single()

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         `${prof?.full_name ?? "Agente"} saiu da conversa.`,
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  return { ok: true }
}

// ── Total de não-lidas (para badge no menu) ─────────────────

export async function getUnreadTotal() {
  const session = await auth()
  if (!session) return 0

  const tenantId = session.user.tenantId
  const userId   = session.user.id
  const isAdmin  = ["owner", "admin"].includes(session.user.role)

  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("unread_count, assigned_to, participants")
    .eq("tenant_id", tenantId)
    .gt("unread_count", 0)
    .in("status", ["open", "pending"])

  if (!data) return 0

  let visible = data
  if (!isAdmin) {
    const { data: tu } = await supabaseAdmin
      .from("tenant_users")
      .select("view_all")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle()

    if (!tu?.view_all) {
      visible = data.filter((c: { assigned_to: string | null; participants: string[] | null }) =>
        c.assigned_to === null ||                  // pool aberto
        c.assigned_to === userId ||
        (c.participants ?? []).includes(userId)
      )
    }
  }

  // Conta CONVERSAS com não-lidas (não a soma de mensagens) — `visible` já está
  // filtrado a unread_count > 0, então o tamanho = nº de conversas pendentes.
  return visible.length
}

// ── Configuração por tenant ─────────────────────────────────

export async function getTenantConfig() {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const { data } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id, auto_create_lead_from_whatsapp")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  return data ?? { default_pipeline_id: null, auto_create_lead_from_whatsapp: false }
}

// ── Lifecycle do contato ────────────────────────────────────

/**
 * Promove um contato de "contact" para "lead" e (opcionalmente) cria deal no funil.
 * O atendente clica "Qualificar" quando avalia que há FIT comercial.
 */
export async function qualifyLead(conversationId: string, pipelineId?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, pipeline_id, is_group")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")
  if (conv.is_group) throw new Error("Conversas de grupo não vão para o funil")
  if (!conv.contact_id) throw new Error("Conversa sem contato vinculado")

  await supabaseAdmin
    .from("chat_contacts")
    .update({
      lifecycle_stage:      "lead",
      lifecycle_changed_at: new Date().toISOString(),
      qualified_at:         new Date().toISOString(),
      qualified_by:         session.user.id,
      unfit_reason:         null,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conv.contact_id)
    .eq("tenant_id", tenantId)

  const targetPipelineId = pipelineId ?? conv.pipeline_id
  if (targetPipelineId) {
    const { data: firstStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("pipeline_id", targetPipelineId)
      .eq("is_triage", false)
      .eq("is_won", false)
      .eq("is_lost", false)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (firstStage) {
      await supabaseAdmin
        .from("chat_conversations")
        .update({
          pipeline_id:   targetPipelineId,
          stage_id:      firstStage.id,
          card_position: 0,
          updated_at:    new Date().toISOString(),
        })
        .eq("id", conversationId)
    }
  }

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "✅ Contato qualificado como Lead.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return { ok: true }
}

/**
 * Desqualifica um contato (não tem fit comercial). Mantém a conversa no Inbox
 * mas remove do funil ativo.
 */
export async function markUnfit(conversationId: string, reason?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("contact_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv?.contact_id) throw new Error("Conversa sem contato")

  await supabaseAdmin
    .from("chat_contacts")
    .update({
      lifecycle_stage:      "unfit",
      lifecycle_changed_at: new Date().toISOString(),
      unfit_reason:         reason ?? null,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conv.contact_id)

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      pipeline_id:   null,
      stage_id:      null,
      card_position: 0,
      updated_at:    new Date().toISOString(),
    })
    .eq("id", conversationId)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         reason
      ? `🚫 Contato marcado como Sem Fit. Motivo: ${reason}`
      : "🚫 Contato marcado como Sem Fit.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return { ok: true }
}

// ── Grupos WhatsApp (opt-in) ────────────────────────────────

export async function listPendingGroups() {
  const session = await auth()
  if (!session) return []

  const { data } = await supabaseAdmin
    .from("chat_groups_whitelist")
    .select("id, group_jid, group_name, member_count, detected_at")
    .eq("tenant_id", session.user.tenantId)
    .eq("status", "pending")
    .order("detected_at", { ascending: false })

  return data ?? []
}

export async function decideGroup(
  groupWhitelistId: string,
  decision:         "monitor" | "ignore",
) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: whitelist } = await supabaseAdmin
    .from("chat_groups_whitelist")
    .select("id, group_jid, instance_id")
    .eq("id", groupWhitelistId)
    .eq("tenant_id", tenantId)
    .single()

  await supabaseAdmin
    .from("chat_groups_whitelist")
    .update({
      status:     decision,
      decided_by: session.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", groupWhitelistId)
    .eq("tenant_id", tenantId)

  if (decision === "monitor" && whitelist) {
    await fetchAndSaveGroupMetadata(whitelist.instance_id, whitelist.group_jid, tenantId)
  }

  revalidatePath("/inbox")
  return { ok: true }
}

/**
 * Busca metadata do grupo via Evolution e atualiza whitelist + conversa.
 */
async function fetchAndSaveGroupMetadata(instanceId: string, groupJid: string, tenantId: string) {
  try {
    const { data: inst } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instanceId)
      .single()
    if (!inst) return

    const provider = getProvider(inst)
    const meta     = await provider.fetchGroupMetadata(groupJid)
    if (!meta) return

    const members = (meta.participants ?? []).map((p) => ({ jid: p.id }))
    const now     = new Date().toISOString()

    await supabaseAdmin
      .from("chat_groups_whitelist")
      .update({
        group_name:    meta.subject ?? null,
        group_picture: meta.pictureUrl ?? null,
        member_count:  meta.size ?? members.length,
      })
      .eq("tenant_id", tenantId)
      .eq("group_jid", groupJid)

    await supabaseAdmin
      .from("chat_conversations")
      .update({
        group_name:    meta.subject ?? null,
        group_picture: meta.pictureUrl ?? null,
        group_members: members,
        updated_at:    now,
      })
      .eq("tenant_id", tenantId)
      .eq("group_jid", groupJid)
      .eq("is_group", true)
  } catch {
    /* silencioso — metadata pode falhar se grupo é privado, etc */
  }
}

// ── Quick Replies ───────────────────────────────────────────

export async function createQuickReply(data: { shortcut: string; title: string; content: string }) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin.from("chat_quick_replies").insert({
    tenant_id:  session.user.tenantId,
    shortcut:   data.shortcut.startsWith("/") ? data.shortcut : `/${data.shortcut}`,
    title:      data.title,
    content:    data.content,
    created_by: session.user.id,
  })

  revalidatePath("/configuracoes/respostas")
}

export async function updateQuickReply(id: string, data: { shortcut: string; title: string; content: string }) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_quick_replies")
    .update({
      shortcut: data.shortcut.startsWith("/") ? data.shortcut : `/${data.shortcut}`,
      title:    data.title,
      content:  data.content,
    })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/configuracoes/respostas")
}

export async function deleteQuickReply(id: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_quick_replies")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/configuracoes/respostas")
}

// getMessages() removida — substituída por src/lib/actions/messages.ts
// que faz cursor pagination + getMessagesUpdates pra polling incremental.


// refreshInbox() removida — substituída por getConversationsUpdates({since}) em
// src/lib/actions/conversations.ts (polling incremental, baixa só o delta).
