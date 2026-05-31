import { NextRequest, NextResponse, after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { jidToPhone } from "@/lib/phone-utils"
import { getProvider } from "@/lib/providers"
import { dispatchAutomations } from "@/lib/automation/dispatch"
import { evaluateKeywordTriggers } from "@/lib/automation/keyword-engine"
import { runAITurn } from "@/lib/ai/run"
import { latestInboundAt } from "@/lib/ai/context"
import { assignNextAgent } from "@/lib/automation/auto-assign"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import type { EvolutionMessageData } from "@/types/chat"

// Janela de debounce do Atendente IA: agrupa rajada de mensagens do contato.
// Se chegar msg mais nova durante a janela, o turno atual aborta e o da
// mensagem nova assume (vendo o histórico completo).
const AI_DEBOUNCE_MS = 2500

const CHAT_BUCKET = "chat-attachments"

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg":  "jpg",
  "image/png":   "png",
  "image/webp":  "webp",
  "image/gif":   "gif",
  "audio/ogg":   "ogg",
  "audio/mpeg":  "mp3",
  "audio/mp4":   "m4a",
  "audio/webm":  "webm",
  "video/mp4":   "mp4",
  "video/webm":  "webm",
  "application/pdf": "pdf",
}

interface InstanceRow {
  id:                        string
  tenant_id:                 string
  provider?:                 string | null
  evolution_url?:            string | null
  evolution_key?:            string | null
  instance_name?:            string | null
  meta_phone_number_id?:     string | null
  meta_business_account_id?: string | null
  meta_access_token?:        string | null
  meta_app_secret?:          string | null
}

/**
 * Baixa mídia da Evolution (descriptografada do WhatsApp) e armazena no nosso bucket.
 */
async function downloadAndStoreMedia(
  instance: InstanceRow,
  conversationId: string,
  msg: EvolutionMessageData,
  contentType: "image" | "audio" | "video" | "document",
  knownFileName: string | null,
): Promise<{ storagePath: string; signedUrl: string; mimeType: string | null } | { error: string }> {
  try {
    const provider = getProvider(instance)

    let result: { base64?: string; mimetype?: string; fileName?: string }
    try {
      result = await provider.getMediaBase64(msg)
    } catch (evoErr) {
      return { error: `evolution_api_error: ${(evoErr as Error).message}` }
    }

    if (!result?.base64) {
      return { error: `no_base64_in_response: ${JSON.stringify(result).slice(0, 200)}` }
    }

    const rawMime  = result.mimetype ?? null
    const mimeType = rawMime ? rawMime.split(";")[0].trim() : null
    const ext      = (mimeType && MIME_EXTENSIONS[mimeType]) ?? "bin"
    const baseName = knownFileName ?? result.fileName ?? `${contentType}_${Date.now()}.${ext}`
    const safe     = baseName.replace(/[^a-zA-Z0-9.\-_]/g, "_")
    const storagePath = `${instance.tenant_id}/${conversationId}/${Date.now()}_${safe}`

    const buffer = Buffer.from(result.base64, "base64")

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(CHAT_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType ?? "application/octet-stream",
        upsert: false,
      })

    if (uploadErr) {
      return { error: `storage_upload_error: ${uploadErr.message}` }
    }

    const { data: signed } = await supabaseAdmin.storage
      .from(CHAT_BUCKET)
      .createSignedUrl(storagePath, 3600)

    if (!signed?.signedUrl) {
      return { error: "signed_url_failed" }
    }

    return { storagePath, signedUrl: signed.signedUrl, mimeType }
  } catch (err) {
    return { error: `unexpected: ${(err as Error).message}` }
  }
}

/**
 * Tipo do `instance` que o dispatch espera. Cada rota (legacy e nova com secret)
 * faz seu próprio lookup, mas usa o mesmo dispatcher abaixo.
 */
export type ResolvedInstance = {
  id:             string
  tenant_id:      string
  evolution_url:  string
  evolution_key:  string
  instance_name:  string
}

/**
 * Dispatcher central — chamado por AMBAS as rotas (legacy + nova com secret).
 * `instance` já vem pré-validada pela rota.
 */
export async function dispatchEvolutionEvent(
  instance: ResolvedInstance,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body:     { event?: string; data?: any },
): Promise<void> {
  const event = body.event
  if (!event) return

  switch (event) {
    case "messages.upsert":
    case "MESSAGES_UPSERT":
      await handleMessageUpsert(instance, body.data)
      break

    case "messages.update":
    case "MESSAGES_UPDATE":
      await handleMessageUpdate(instance, body.data)
      break

    case "connection.update":
    case "CONNECTION_UPDATE":
      await handleConnectionUpdate(instance.id, body.data)
      break

    case "qrcode.updated":
    case "QRCODE_UPDATED":
      break
  }

  // Sinal de "webhook pipe vivo" — bumpa em todo evento bem-sucedido.
  // É o sinal mais confiável de que Evolution → Kora está funcionando
  // (status/last_heartbeat só atualizam em CONNECTION_UPDATE).
  await supabaseAdmin
    .from("whatsapp_instances")
    .update({ last_webhook_at: new Date().toISOString() })
    .eq("id", instance.id)
}

/**
 * POST /api/webhooks/evolution   ⚠️ LEGACY — sem autenticação
 *
 * Mantida ativa pra zero downtime durante a migração das instâncias
 * pra `/api/webhooks/evolution/[secret]`. Cada chamada gera um warning
 * no log indicando qual instância ainda não foi migrada.
 *
 * Eventos suportados (também na rota nova):
 * - MESSAGES_UPSERT     → nova mensagem recebida
 * - MESSAGES_UPDATE     → atualização de status (delivered/read)
 * - CONNECTION_UPDATE   → mudança de conexão
 * - QRCODE_UPDATED      → novo QR code gerado
 */
export async function POST(req: NextRequest) {
  try {
    const body         = await req.json()
    const event        = body.event as string
    const instanceName = body.instance as string

    if (!event || !instanceName) {
      return NextResponse.json({ error: "Missing event or instance" }, { status: 400 })
    }

    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id, tenant_id, evolution_url, evolution_key, instance_name, webhook_secret")
      .eq("instance_name", instanceName)
      .single()

    if (!instance) {
      // Resposta genérica — não confirma existência de instance_name
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 🔒 SECURITY: se a instância JÁ tem secret, ela DEVE usar a URL nova.
    // Bloquear aqui impede atacante de spoofar via URL antiga (mesmo conhecendo o instance_name).
    if (instance.webhook_secret) {
      console.warn(
        `[Webhook Evolution] BLOCKED legacy call for migrated instance=${instance.instance_name} (tenant=${instance.tenant_id}). ` +
        `Caller must use /api/webhooks/evolution/[secret]. Possible spoof attempt.`
      )
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Apenas instâncias ainda NÃO migradas chegam aqui (futuro provisionamento que ainda não rodou).
    // Aviso pro admin migrar.
    console.warn(
      `[Webhook Evolution] LEGACY route used by un-migrated instance=${instance.instance_name} (tenant=${instance.tenant_id}). ` +
      `Migrate via admin action or wait for next provisioning.`
    )

    // ACK 200 imediato + dispatch em background (evita timeout/retry).
    after(async () => {
      try {
        await dispatchEvolutionEvent(instance, body)
      } catch (err) {
        console.error("[Webhook Evolution] LEGACY dispatch failed in after():", err)
      }
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[Webhook Evolution] LEGACY", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}

// ── Handlers ────────────────────────────────────────────────

async function handleMessageUpsert(
  instance: InstanceRow,
  data:     EvolutionMessageData | EvolutionMessageData[],
) {
  const instanceId = instance.id
  const tenantId   = instance.tenant_id
  const messages   = Array.isArray(data) ? data : [data]

  for (const msg of messages) {
    if (!msg.key?.remoteJid) continue

    const jid = msg.key.remoteJid

    if (jid === "status@broadcast") continue

    const isGroup = jid.includes("@g.us")
    if (isGroup) {
      const decision = await resolveGroupOptIn(instance, jid, msg)
      if (decision === "ignore" || decision === "pending") continue
    }

    // ── Protocol message: delete/edit ───────────────────────────
    // Tipo 0 = REVOKE (apagar), 14 = MESSAGE_EDIT (editar).
    // Atualiza mensagem existente em vez de criar nova — sai cedo do loop.
    const protocol = msg.message?.protocolMessage
    if (protocol?.key?.id) {
      const targetId = protocol.key.id
      if (protocol.type === 0) {
        // Cliente apagou no WhatsApp
        await supabaseAdmin
          .from("chat_messages")
          .update({
            content_type: "deleted",
            content:      null,
            deleted_at:   new Date().toISOString(),
          })
          .eq("tenant_id", tenantId)
          .eq("whatsapp_msg_id", targetId)
        continue
      }
      if (protocol.type === 14 && protocol.editedMessage) {
        // Cliente editou — extrai o novo conteúdo
        const editedExtract = extractMessageContent({
          ...msg,
          message: protocol.editedMessage,
        } as EvolutionMessageData)
        await supabaseAdmin
          .from("chat_messages")
          .update({
            content:      editedExtract.content,
            content_type: editedExtract.contentType,
            edited_at:    new Date().toISOString(),
          })
          .eq("tenant_id", tenantId)
          .eq("whatsapp_msg_id", targetId)
        continue
      }
      // Outros tipos de protocolo (read receipts em grupo, etc.) — ignora
      continue
    }

    const pushName = msg.pushName ?? null
    const extracted = extractMessageContent(msg)
    const { contentType, content, mediaMimeType, mediaFileName, extraMetadata } = extracted
    const externalAdReply = extractExternalAdReply(msg)
    const quoted          = extractQuoted(msg)

    // ═══════════════════════════════════════════════════════════
    // fromMe: mensagem enviada pelo número conectado (agente)
    //   A) Nasceu no app  → linha "órfã" recente sem whatsapp_msg_id, fechamos com UPDATE
    //   B) Nasceu no celular → criamos linha nova marcada via_celular: true
    // ═══════════════════════════════════════════════════════════
    if (msg.key.fromMe) {
      try {
        if (msg.key.id) {
          const { data: existing } = await supabaseAdmin
            .from("chat_messages")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("whatsapp_msg_id", msg.key.id)
            .maybeSingle()
          if (existing) continue
        }

        let linkedExisting = false
        if (msg.key.id && !isGroup) {
          const { data: ct } = await supabaseAdmin
            .from("chat_contacts")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("whatsapp_id", jid)
            .maybeSingle()

          if (ct) {
            const { data: cv } = await supabaseAdmin
              .from("chat_conversations")
              .select("id")
              .eq("tenant_id", tenantId)
              .eq("contact_id", ct.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()

            if (cv) {
              const sixtySecAgo = new Date(Date.now() - 60_000).toISOString()
              const { data: matched } = await supabaseAdmin
                .from("chat_messages")
                .update({ whatsapp_msg_id: msg.key.id, status: "sent" })
                .eq("tenant_id", tenantId)
                .eq("conversation_id", cv.id)
                .eq("sender_type", "agent")
                .is("whatsapp_msg_id", null)
                .gte("created_at", sixtySecAgo)
                .order("created_at", { ascending: false })
                .limit(1)
                .select("id")

              if (matched && matched.length > 0) linkedExisting = true
            }
          }
        }
        if (linkedExisting) continue

        let participantJidFromMe: string | null = null
        let contactFromMe: { id: string } | null = null
        let convFromMe:   { id: string }

        if (isGroup) {
          participantJidFromMe = (msg.key as { participant?: string }).participant ?? null
          const memberPhone = participantJidFromMe ? jidToPhone(participantJidFromMe) : ""
          if (participantJidFromMe && memberPhone) {
            contactFromMe = await findOrCreateContact(tenantId, participantJidFromMe, memberPhone, null, instance)
          }
          convFromMe = await findOrCreateGroupConversation(tenantId, instanceId, jid, null)
        } else {
          const phone = jidToPhone(jid)
          contactFromMe = await findOrCreateContact(tenantId, jid, phone, null, instance)
          convFromMe    = await findOrCreateConversation(tenantId, contactFromMe.id, instanceId)
        }

        let finalMediaUrlFromMe: string | null = null
        let finalMimeFromMe:     string | null = mediaMimeType
        const metaFromMe: Record<string, unknown> = { ...(extraMetadata ?? {}), via_celular: true }
        if (externalAdReply) metaFromMe.external_ad_reply = externalAdReply
        if (quoted)          metaFromMe.quoted            = quoted

        const isMediaFromMe = contentType === "image" || contentType === "audio" || contentType === "video" || contentType === "document"
        if (isMediaFromMe) {
          const stored = await downloadAndStoreMedia(instance, convFromMe.id, msg, contentType, mediaFileName)
          if ("error" in stored) {
            metaFromMe.media_error    = stored.error
            metaFromMe.media_error_at = new Date().toISOString()
          } else {
            finalMediaUrlFromMe     = stored.signedUrl
            finalMimeFromMe         = stored.mimeType ?? mediaMimeType
            metaFromMe.storage_path = stored.storagePath
          }
        }

        const { error: fromMeInsertErr } = await supabaseAdmin.from("chat_messages").insert({
          conversation_id:       convFromMe.id,
          tenant_id:             tenantId,
          sender_type:           "agent",
          sender_id:             null,
          content_type:          contentType,
          content,
          media_url:             finalMediaUrlFromMe,
          media_mime_type:       finalMimeFromMe,
          media_file_name:       mediaFileName,
          whatsapp_msg_id:       msg.key.id ?? null,
          status:                "sent",
          is_private_note:       false,
          metadata:              metaFromMe,
          group_participant_jid: isGroup ? participantJidFromMe : null,
        })

        // 23505 = duplicata. Já foi salva por outro evento — não atualiza preview.
        if (fromMeInsertErr?.code === "23505") continue
        if (fromMeInsertErr) {
          console.error("[evolution-webhook] fromMe insert failed:", fromMeInsertErr)
          continue
        }

        const previewFromMe = content ? content.substring(0, 100) : `📎 ${contentType}`
        await supabaseAdmin
          .from("chat_conversations")
          .update({
            last_message_at:      new Date().toISOString(),
            last_message_preview: previewFromMe,
            last_message_dir:     "out_phone",
            updated_at:           new Date().toISOString(),
          })
          .eq("id", convFromMe.id)
      } catch (err) {
        console.error("[evolution-webhook] fromMe handler failed:", err)
      }
      continue
    }

    let contact:      { id: string } | null = null
    let conversation: { id: string; status: string; unread_count: number; _isNew: boolean }
    let participantJid: string | null = null

    if (isGroup) {
      participantJid = (msg.key as { participant?: string }).participant ?? null
      const memberPhone = participantJid ? jidToPhone(participantJid) : ""
      if (participantJid && memberPhone) {
        contact = await findOrCreateContact(tenantId, participantJid, memberPhone, pushName, instance)
      }
      conversation = await findOrCreateGroupConversation(tenantId, instanceId, jid, pushName)
    } else {
      const phone = jidToPhone(jid)
      contact = await findOrCreateContact(tenantId, jid, phone, pushName, instance)
      conversation = await findOrCreateConversation(tenantId, contact.id, instanceId)

      // Sprint 2.4 — Auto-assign apenas quando a conversa é nova.
      // O helper checa: módulo habilitado, config, horário, canal, agentes elegíveis.
      // Fire-and-forget: não bloqueia o webhook se assignment falhar.
      if (conversation._isNew) {
        after(async () => {
          try {
            await assignNextAgent(tenantId, conversation.id)
          } catch (err) {
            console.error("[auto-assign] failed:", err)
          }
        })
      }
    }

    let finalMediaUrl: string | null = null
    let finalMimeType: string | null = mediaMimeType
    const metadata: Record<string, unknown> = { ...(extraMetadata ?? {}) }

    if (externalAdReply) metadata.external_ad_reply = externalAdReply
    if (quoted)          metadata.quoted            = quoted

    const isMedia = contentType === "image" || contentType === "audio" || contentType === "video" || contentType === "document"
    if (isMedia) {
      const stored = await downloadAndStoreMedia(instance, conversation.id, msg, contentType, mediaFileName)
      if ("error" in stored) {
        metadata.media_error           = stored.error
        metadata.media_error_at        = new Date().toISOString()
        metadata.original_whatsapp_url = (msg.message as Record<string, { url?: string } | undefined>)?.imageMessage?.url
                                       ?? (msg.message as Record<string, { url?: string } | undefined>)?.audioMessage?.url
                                       ?? (msg.message as Record<string, { url?: string } | undefined>)?.videoMessage?.url
                                       ?? (msg.message as Record<string, { url?: string } | undefined>)?.documentMessage?.url
                                       ?? null
      } else {
        finalMediaUrl         = stored.signedUrl
        finalMimeType         = stored.mimeType ?? mediaMimeType
        metadata.storage_path = stored.storagePath
      }
    }

    // sender_id é FK pra profiles(id) (usuários do sistema). Pra mensagens
    // de contato, fica null — a identidade do contato vem via conversation.contact_id.
    const { error: insertErr } = await supabaseAdmin.from("chat_messages").insert({
      conversation_id:       conversation.id,
      tenant_id:             tenantId,
      sender_type:           "contact",
      sender_id:             null,
      content_type:          contentType,
      content,
      media_url:             finalMediaUrl,
      media_mime_type:       finalMimeType,
      media_file_name:       mediaFileName,
      whatsapp_msg_id:       msg.key.id ?? null,
      status:                "delivered",
      is_private_note:       false,
      metadata:              Object.keys(metadata).length > 0 ? metadata : {},
      group_participant_jid: isGroup ? participantJid : null,
    })

    // 23505 = unique violation no índice (tenant_id, whatsapp_msg_id).
    // Evolution re-tentou o mesmo POST: ignora sem incrementar unread/preview.
    if (insertErr?.code === "23505") {
      continue
    }
    if (insertErr) {
      console.error("[evolution-webhook] failed inserting contact message:", insertErr, {
        conversationId: conversation.id,
        whatsapp_msg_id: msg.key.id,
      })
      continue
    }

    // Sinal de "recebimento ativo" — bumpa só pra msgs reais de contato (não fromMe)
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ last_inbound_message_at: new Date().toISOString() })
      .eq("id", instanceId)

    const preview = content ? content.substring(0, 100) : `📎 ${contentType}`

    const wasResolved = conversation.status === "resolved"
    await supabaseAdmin
      .from("chat_conversations")
      .update({
        last_message_at:      new Date().toISOString(),
        last_message_preview: preview,
        last_message_dir:     "in",
        unread_count:         (conversation.unread_count ?? 0) + 1,
        status:               wasResolved ? "open" : conversation.status,
        updated_at:           new Date().toISOString(),
        // Reopen automático limpa resolved_at pra reports não contarem como "ainda resolvida"
        ...(wasResolved ? { resolved_at: null } : {}),
      })
      .eq("id", conversation.id)

    // CTWA — registra atribuição no contato pra relatórios/segmentação futura.
    // Só guarda na 1ª vez (first-touch attribution). Se já existir, mantém.
    if (externalAdReply && contact) {
      // Log estruturado pra diagnóstico (Vercel/EasyPanel logs)
      const adInfo = externalAdReply as Record<string, unknown>
      console.log(JSON.stringify({
        event:       "ctwa_captured",
        tenant_id:   tenantId,
        contact_id:  contact.id,
        conv_id:     conversation.id,
        source_app:  adInfo.sourceApp ?? null,
        source_id:   adInfo.sourceId ?? null,
        ctwa_clid:   adInfo.ctwaClid ?? null,
        wtwa_format: adInfo.wtwaAdFormat ?? null,
      }))
      try {
        const { data: contactRow } = await supabaseAdmin
          .from("chat_contacts")
          .select("metadata")
          .eq("id", contact.id)
          .single()

        const existingMeta = (contactRow?.metadata ?? {}) as Record<string, unknown>
        if (!existingMeta.first_ad_reply) {
          await supabaseAdmin
            .from("chat_contacts")
            .update({
              metadata: {
                ...existingMeta,
                first_ad_reply: externalAdReply,
                first_ad_at:    new Date().toISOString(),
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", contact.id)
        }
      } catch (err) {
        // Atribuição é nice-to-have. Não falha o webhook se quebrar.
        console.error("[webhook] failed saving first_ad_reply on contact:", err)
      }

      // CTWA — denormaliza na CONVERSA pra filtro/listagem rápida sem JOIN.
      // Só atualiza se from_ad_meta ainda for NULL (first-touch wins).
      try {
        await supabaseAdmin
          .from("chat_conversations")
          .update({ from_ad_meta: externalAdReply })
          .eq("id", conversation.id)
          .is("from_ad_meta", null)
      } catch (err) {
        console.error("[webhook] failed saving from_ad_meta on conversation:", err)
      }
    }

    // Camada 1 — keyword triggers (sempre avaliados, independente de AI estar ligada).
    // Determinísticos e baratos. Se um trigger casar e responder, evita custo de AI.
    let kwMatched = false
    if (content) {
      try {
        kwMatched = await evaluateKeywordTriggers({
          tenantId,
          conversationId: conversation.id,
          text:           content,
          instance,
        })
      } catch (err) {
        console.error("[keyword-engine] failed:", err)
      }
    }

    // Cadeia de atendimento automático (fire-and-forget via after()):
    //   1. Keyword triggers — já rodou acima (sync). Se matchou, bypass do resto.
    //   2. Atendente IA — se habilitada e algum trigger casar (com debounce de rajada).
    //   3. Automações fixas (welcome / horário comercial) — fallback se a IA não atuou.
    // Guardas de takeover/grupo/disabled ficam dentro de runAITurn.
    if (!kwMatched) {
      const convId = conversation.id
      after(async () => {
        try {
          // IA só processa texto. Mídia pura → pula direto pras automações fixas.
          if (content) {
            // Debounce: aguarda janela curta; se chegou msg mais nova do contato,
            // aborta — o turno disparado por ela verá o histórico completo.
            const baseline = await latestInboundAt(convId)
            await new Promise((r) => setTimeout(r, AI_DEBOUNCE_MS))
            if ((await latestInboundAt(convId)) !== baseline) return

            const ai = await runAITurn({
              tenantId,
              conversationId: convId,
              incomingText:   content,
              instance,
            })
            // IA atuou (respondeu/roteou) OU a conversa já foi encaminhada pro
            // time humano → não dispara automações fixas por cima do handoff.
            if (ai.status === "responded" || ai.status === "routed") return
            if (ai.status === "skipped" && ai.reason === "already_routed") return
          }

          await dispatchAutomations({ tenantId, conversationId: convId, instance })
        } catch (err) {
          console.error("[ai+automation chain] failed:", err)
        }
      })
    }
  }
}

async function handleMessageUpdate(instance: { tenant_id: string }, data: unknown) {
  const updates = Array.isArray(data) ? data : [data]

  for (const update of updates) {
    const u = update as { key?: { id?: string }; status?: string }
    if (!u.key?.id || !u.status) continue

    const statusMap: Record<string, string> = {
      DELIVERY_ACK: "delivered",
      READ:         "read",
      PLAYED:       "read",
    }

    const newStatus = statusMap[u.status]
    if (newStatus) {
      await supabaseAdmin
        .from("chat_messages")
        .update({ status: newStatus })
        .eq("whatsapp_msg_id", u.key.id)
        .eq("tenant_id", instance.tenant_id)
    }
  }
}

async function handleConnectionUpdate(instanceId: string, data: unknown) {
  const d = data as { state?: string }
  if (!d.state) return

  const statusMap: Record<string, string> = {
    open:       "connected",
    close:      "disconnected",
    connecting: "connecting",
  }

  const newStatus = statusMap[d.state] ?? "disconnected"
  const now       = new Date().toISOString()

  const update: Record<string, unknown> = {
    status:            newStatus,
    last_heartbeat_at: now,
    updated_at:        now,
  }
  if (newStatus === "connected") {
    update.reconnect_attempts = 0
    update.last_error         = null
  }

  await supabaseAdmin
    .from("whatsapp_instances")
    .update(update)
    .eq("id", instanceId)
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Extrai contextInfo de QUALQUER tipo de message, desempacotando wrappers.
 *
 * Crítico pra Click-to-WhatsApp Ads — TRÊS lugares possíveis:
 *
 *  1. `msg.contextInfo` (RAIZ) — quando message é tipo `conversation` simples
 *      (texto puro). É aqui que CTWAs do Instagram/Facebook colocam o
 *      externalAdReply quando cliente manda texto direto pelo ad.
 *
 *  2. `m.<tipo>.contextInfo` (aninhado) — quando message é tipo rich
 *      (extendedText, image, video, etc).
 *
 *  3. Dentro de wrappers (ephemeralMessage, viewOnce...) — clientes com
 *      "mensagens efêmeras" ativas. Desempacotamos com unwrapMessage().
 *
 * Cobertura defensiva: todos os 18 tipos de message conhecidos que podem
 * carregar contextInfo no payload Baileys.
 */
function extractContextInfo(msg: EvolutionMessageData) {
  // 1. contextInfo na raiz tem PRIORIDADE — é onde Evolution coloca pra
  //    msgs de tipo `conversation` (texto simples), o caso CTWA mais comum.
  if (msg.contextInfo) return msg.contextInfo

  // 2. Aninhado em algum tipo de message (com unwrap pra mensagens efêmeras)
  const { inner: m } = unwrapMessage(msg.message)
  if (!m) return null
  return (
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.audioMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    m.stickerMessage?.contextInfo ??
    m.locationMessage?.contextInfo ??
    m.liveLocationMessage?.contextInfo ??
    m.contactMessage?.contextInfo ??
    m.contactsArrayMessage?.contextInfo ??
    m.pollCreationMessage?.contextInfo ??
    m.pollCreationMessageV3?.contextInfo ??
    m.pollUpdateMessage?.contextInfo ??
    m.buttonsResponseMessage?.contextInfo ??
    m.listResponseMessage?.contextInfo ??
    m.templateButtonReplyMessage?.contextInfo ??
    m.templateMessage?.contextInfo ??
    m.interactiveResponseMessage?.contextInfo ??
    null
  )
}

function extractExternalAdReply(msg: EvolutionMessageData) {
  return extractContextInfo(msg)?.externalAdReply ?? null
}

function extractQuoted(msg: EvolutionMessageData) {
  const ctx = extractContextInfo(msg)
  if (!ctx?.stanzaId && !ctx?.quotedMessage) return null

  const q = ctx.quotedMessage ?? {}
  let preview: string | null = null
  let kind:    string | null = null
  if (q.conversation)                            { preview = q.conversation; kind = "text" }
  else if (q.extendedTextMessage?.text)          { preview = q.extendedTextMessage.text; kind = "text" }
  else if (q.imageMessage)                       { preview = q.imageMessage.caption || "📷 Imagem"; kind = "image" }
  else if (q.videoMessage)                       { preview = q.videoMessage.caption || "🎥 Vídeo"; kind = "video" }
  else if (q.audioMessage)                       { preview = "🎧 Áudio"; kind = "audio" }
  else if (q.documentMessage)                    { preview = q.documentMessage.fileName || "📎 Documento"; kind = "document" }
  else if (q.stickerMessage)                     { preview = "Sticker"; kind = "sticker" }
  else if (q.locationMessage)                    { preview = "📍 Localização"; kind = "location" }

  return {
    msg_id:      ctx.stanzaId ?? null,
    participant: ctx.participant ?? null,
    kind,
    preview:     preview?.slice(0, 200) ?? null,
  }
}

/**
 * Desembrulha mensagens que vêm dentro de wrappers (efêmeras / view-once / edited).
 * Retorna o `message` interno + flags pra metadata.
 */
function unwrapMessage(m: EvolutionMessageData["message"]) {
  if (!m) return { inner: m, isViewOnce: false, isEphemeral: false, isEdited: false }

  let inner = m
  let isViewOnce = false
  let isEphemeral = false
  let isEdited = false

  // Vários níveis de unwrap podem coexistir (raro mas possível)
  for (let i = 0; i < 3; i++) {
    if (inner.ephemeralMessage?.message) {
      inner = inner.ephemeralMessage.message
      isEphemeral = true
      continue
    }
    if (inner.viewOnceMessage?.message) {
      inner = inner.viewOnceMessage.message
      isViewOnce = true
      continue
    }
    if (inner.viewOnceMessageV2?.message) {
      inner = inner.viewOnceMessageV2.message
      isViewOnce = true
      continue
    }
    if (inner.documentWithCaptionMessage?.message) {
      inner = inner.documentWithCaptionMessage.message
      continue
    }
    if (inner.editedMessage?.message) {
      inner = inner.editedMessage.message
      isEdited = true
      continue
    }
    break
  }

  return { inner, isViewOnce, isEphemeral, isEdited }
}

export interface ExtractResult {
  contentType:     "text" | "image" | "audio" | "video" | "document" | "location"
                 | "sticker" | "reaction" | "album" | "contact" | "poll"
                 | "interactive" | "unsupported"
  content:         string | null
  mediaUrl:        string | null
  mediaMimeType:   string | null
  mediaFileName:   string | null
  extraMetadata?:  Record<string, unknown>
}

function extractMessageContent(msg: EvolutionMessageData): ExtractResult {
  const { inner: m, isViewOnce, isEphemeral, isEdited } = unwrapMessage(msg.message)
  if (!m) {
    return { contentType: "text", content: null, mediaUrl: null, mediaMimeType: null, mediaFileName: null }
  }

  const baseMeta: Record<string, unknown> = {}
  if (isViewOnce)  baseMeta.view_once  = true
  if (isEphemeral) baseMeta.ephemeral  = true
  if (isEdited)    baseMeta.edited     = true

  // ── Texto ───────────────────────────────────────────────────
  if (m.conversation) {
    return { contentType: "text", content: m.conversation, mediaUrl: null, mediaMimeType: null, mediaFileName: null, extraMetadata: baseMeta }
  }
  if (m.extendedTextMessage?.text) {
    return { contentType: "text", content: m.extendedTextMessage.text, mediaUrl: null, mediaMimeType: null, mediaFileName: null, extraMetadata: baseMeta }
  }

  // ── Mídia ───────────────────────────────────────────────────
  if (m.imageMessage) {
    return { contentType: "image", content: m.imageMessage.caption ?? null, mediaUrl: m.imageMessage.url ?? null, mediaMimeType: m.imageMessage.mimetype ?? null, mediaFileName: null, extraMetadata: baseMeta }
  }
  if (m.audioMessage) {
    return { contentType: "audio", content: null, mediaUrl: m.audioMessage.url ?? null, mediaMimeType: m.audioMessage.mimetype ?? null, mediaFileName: null, extraMetadata: baseMeta }
  }
  if (m.videoMessage) {
    return { contentType: "video", content: m.videoMessage.caption ?? null, mediaUrl: m.videoMessage.url ?? null, mediaMimeType: m.videoMessage.mimetype ?? null, mediaFileName: null, extraMetadata: baseMeta }
  }
  if (m.documentMessage) {
    return { contentType: "document", content: m.documentMessage.caption ?? null, mediaUrl: m.documentMessage.url ?? null, mediaMimeType: m.documentMessage.mimetype ?? null, mediaFileName: m.documentMessage.fileName ?? null, extraMetadata: baseMeta }
  }
  if (m.stickerMessage) {
    return { contentType: "sticker", content: null, mediaUrl: null, mediaMimeType: m.stickerMessage.mimetype ?? null, mediaFileName: null, extraMetadata: baseMeta }
  }

  // ── Localização ────────────────────────────────────────────
  if (m.locationMessage) {
    return {
      contentType: "location",
      content: `${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: baseMeta,
    }
  }
  if (m.liveLocationMessage) {
    return {
      contentType: "location",
      content: `${m.liveLocationMessage.degreesLatitude ?? 0},${m.liveLocationMessage.degreesLongitude ?? 0}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, live_location: true, caption: m.liveLocationMessage.caption ?? null },
    }
  }

  // ── Reação ─────────────────────────────────────────────────
  if (m.reactionMessage) {
    return {
      contentType: "reaction",
      content: m.reactionMessage.text,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, reacted_to_id: m.reactionMessage.key.id },
    }
  }

  // ── Álbum (wrapper de "vou mandar N mídias") ───────────────
  // As mídias individuais chegam em eventos separados. O wrapper em si só
  // anuncia. Salvamos como um marcador "album" com a contagem prevista.
  if (m.albumMessage) {
    const imgs = m.albumMessage.expectedImageCount ?? 0
    const vids = m.albumMessage.expectedVideoCount ?? 0
    const total = imgs + vids
    return {
      contentType: "album",
      content: total > 0 ? `📷 Álbum com ${total} ${total === 1 ? "mídia" : "mídias"}` : "📷 Álbum",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, album_images: imgs, album_videos: vids },
    }
  }

  // ── Contato compartilhado ──────────────────────────────────
  if (m.contactMessage) {
    return {
      contentType: "contact",
      content: m.contactMessage.displayName ?? "Contato",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, contacts: [{ name: m.contactMessage.displayName, vcard: m.contactMessage.vcard }] },
    }
  }
  if (m.contactsArrayMessage) {
    const contacts = m.contactsArrayMessage.contacts ?? []
    return {
      contentType: "contact",
      content: `${contacts.length} contatos`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, contacts: contacts.map((c) => ({ name: c.displayName, vcard: c.vcard })) },
    }
  }

  // ── Enquete ────────────────────────────────────────────────
  const poll = m.pollCreationMessageV3 ?? m.pollCreationMessage
  if (poll) {
    return {
      contentType: "poll",
      content: poll.name ?? "Enquete",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: {
        ...baseMeta,
        poll_name:    poll.name ?? null,
        poll_options: poll.options ?? [],
        poll_max:     poll.selectableOptionsCount ?? 1,
      },
    }
  }
  if (m.pollUpdateMessage) {
    return {
      contentType: "poll",
      content: "🗳️ Voto na enquete",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, poll_vote: true },
    }
  }

  // ── Respostas interativas (buttons, list, template) ────────
  if (m.buttonsResponseMessage) {
    return {
      contentType: "interactive",
      content: m.buttonsResponseMessage.selectedDisplayText ?? "Resposta de botão",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, interactive_kind: "button", interactive_id: m.buttonsResponseMessage.selectedId ?? null },
    }
  }
  if (m.listResponseMessage) {
    return {
      contentType: "interactive",
      content: m.listResponseMessage.title ?? "Item selecionado",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, interactive_kind: "list", interactive_id: m.listResponseMessage.singleSelectReply?.selectedRowId ?? null },
    }
  }
  if (m.templateButtonReplyMessage) {
    return {
      contentType: "interactive",
      content: m.templateButtonReplyMessage.selectedDisplayText ?? "Resposta de template",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, interactive_kind: "template_button", interactive_id: m.templateButtonReplyMessage.selectedId ?? null },
    }
  }
  if (m.interactiveResponseMessage) {
    return {
      contentType: "interactive",
      content: m.interactiveResponseMessage.selectedDisplayText ?? "Resposta interativa",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, interactive_kind: "interactive", interactive_id: m.interactiveResponseMessage.selectedId ?? null },
    }
  }
  if (m.templateMessage) {
    return {
      contentType: "interactive",
      content: m.templateMessage.hydratedTemplate?.hydratedContentText ?? "Template",
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, interactive_kind: "template" },
    }
  }

  // ── Catálogo / Pagamento / Outros ──────────────────────────
  if (m.orderMessage) {
    return {
      contentType: "unsupported",
      content: `🛒 Pedido: ${m.orderMessage.orderTitle ?? m.orderMessage.orderId ?? "—"}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, unsupported_type: "orderMessage", order: m.orderMessage },
    }
  }
  if (m.productMessage) {
    return {
      contentType: "unsupported",
      content: `📦 Produto: ${m.productMessage.product?.title ?? "—"}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, unsupported_type: "productMessage", product: m.productMessage.product },
    }
  }
  if (m.paymentMessage) {
    const amount = m.paymentMessage.amount?.value ?? 0
    const offset = m.paymentMessage.amount?.offset ?? 1000
    const currency = m.paymentMessage.amount?.currency ?? "BRL"
    return {
      contentType: "unsupported",
      content: `💰 Pagamento: ${(amount / offset).toFixed(2)} ${currency}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, unsupported_type: "paymentMessage" },
    }
  }
  if (m.eventMessage) {
    return {
      contentType: "unsupported",
      content: `📅 ${m.eventMessage.name ?? "Evento"}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, unsupported_type: "eventMessage" },
    }
  }
  if (m.groupInviteMessage) {
    return {
      contentType: "unsupported",
      content: `👥 Convite pro grupo: ${m.groupInviteMessage.groupName ?? "—"}`,
      mediaUrl: null, mediaMimeType: null, mediaFileName: null,
      extraMetadata: { ...baseMeta, unsupported_type: "groupInviteMessage" },
    }
  }

  // ── Fallback robusto ────────────────────────────────────────
  // Tipo desconhecido — vira "unsupported" pro UI mostrar bubble cinza
  // explicativo, em vez de string esquisita.
  return {
    contentType: "unsupported",
    content: null,
    mediaUrl: null, mediaMimeType: null, mediaFileName: null,
    extraMetadata: { ...baseMeta, unsupported_type: msg.messageType ?? "unknown" },
  }
}

async function findOrCreateContact(
  tenantId:  string,
  jid:       string,
  phone:     string,
  pushName:  string | null,
  instance?: InstanceRow,
): Promise<{ id: string }> {
  // Upsert atômico via UNIQUE(tenant_id, whatsapp_id). Resolve race quando
  // dois webhooks paralelos do mesmo JID chegam ao mesmo tempo.
  const { data: upserted, error: upErr } = await supabaseAdmin
    .from("chat_contacts")
    .upsert(
      {
        tenant_id:           tenantId,
        whatsapp_id:         jid,
        phone_number:        phone,
        push_name:           pushName,
        primary_channel:     "whatsapp",   // identidade multicanal (Fase 1)
        primary_external_id: jid,
        updated_at:          new Date().toISOString(),
      },
      { onConflict: "tenant_id,whatsapp_id", ignoreDuplicates: false },
    )
    .select("id, profile_pic_url")
    .single()

  if (upErr || !upserted) throw new Error(`Failed to upsert contact: ${upErr?.message}`)

  if (!upserted.profile_pic_url && instance) {
    fetchAndSaveProfilePicture(instance, jid, upserted.id).catch(() => {})
  }

  return { id: upserted.id }
}

/**
 * Fire-and-forget: busca foto de perfil do WhatsApp e grava em chat_contacts.profile_pic_url.
 */
async function fetchAndSaveProfilePicture(
  instance:  InstanceRow,
  jid:       string,
  contactId: string,
) {
  const provider = getProvider(instance)
  const url      = await provider.fetchProfilePictureUrl(jid)
  if (!url) return
  await supabaseAdmin
    .from("chat_contacts")
    .update({ profile_pic_url: url, updated_at: new Date().toISOString() })
    .eq("id", contactId)
}

/**
 * Resolve conversa do contato no webhook. Garantia: 1 conv por contato — usa
 * `findOrReopenConversation` (regra única do Kora — reabre/desarquiva tudo).
 *
 * Apenas cria nova se NUNCA houve conv com esse contato (`found: "none"`).
 *
 * `_isNew`:
 *   - true → conversa nasceu agora (auto-assign dispara, system msgs, etc)
 *   - false → conv pré-existia (apenas updates incrementais, sem auto-assign)
 *     (Reopen NÃO conta como new — auto-assign não dispara em retorno de
 *      cliente, mantém atendente original.)
 */
async function findOrCreateConversation(
  tenantId:   string,
  contactId:  string,
  instanceId: string,
) {
  // Usa dedup library: encontra ativa OR reabre fechada (qualquer idade) +
  // auto-unarchive. Skip ownership check porque contact já foi validado em
  // findOrCreateContact upstream.
  const dedup = await findOrReopenConversation({
    tenantId,
    contactId,
    skipOwnershipCheck: true,
  })

  if (dedup.found !== "none") {
    const c = dedup.conversation as unknown as { id: string; status: string; unread_count: number }
    return { id: c.id, status: c.status, unread_count: c.unread_count, _isNew: false }
  }

  // ── Nunca teve conversa com esse contato → cria nova ──
  let pipelineId: string | null = null
  let stageId:    string | null = null

  const { data: tenantConfig } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (tenantConfig?.default_pipeline_id) {
    pipelineId = tenantConfig.default_pipeline_id

    const { data: triageStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("tenant_id", tenantId)
      .eq("is_triage", true)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (triageStage) {
      stageId = triageStage.id
    } else {
      const { data: newTriage } = await supabaseAdmin
        .from("pipeline_stages")
        .insert({
          tenant_id:      tenantId,
          pipeline_id:    pipelineId,
          name:           "Triagem",
          color:          "#94a3b8",
          position:       -1,
          is_triage:      true,
          is_won:         false,
          is_lost:        false,
          show_in_kanban: false,
        })
        .select("id")
        .single()
      stageId = newTriage?.id ?? null
    }
  }

  const { data: newConv, error } = await supabaseAdmin
    .from("chat_conversations")
    .insert({
      tenant_id:     tenantId,
      contact_id:    contactId,
      instance_id:   instanceId,
      status:        "open",
      unread_count:  0,
      pipeline_id:   pipelineId,
      stage_id:      stageId,
      card_position: 0,
    })
    .select("id, status, unread_count")
    .single()

  // Race: outro webhook paralelo já criou a conversa ativa.
  // Tenta de novo via dedup que pega ativa OR reaberta.
  if (error?.code === "23505") {
    const retry = await findOrReopenConversation({
      tenantId,
      contactId,
      skipOwnershipCheck: true,
    })
    if (retry.found !== "none") {
      const c = retry.conversation as unknown as { id: string; status: string; unread_count: number }
      return { id: c.id, status: c.status, unread_count: c.unread_count, _isNew: false }
    }
  }

  if (error || !newConv) throw new Error(`Failed to create conversation: ${error?.message}`)
  return { ...newConv, _isNew: true }
}

// ── Grupos: opt-in ─────────────────────────────────────────

async function resolveGroupOptIn(
  instance: { id: string; tenant_id: string },
  groupJid: string,
  msg:      EvolutionMessageData,
): Promise<"monitor" | "ignore" | "pending"> {
  const { data: existing } = await supabaseAdmin
    .from("chat_groups_whitelist")
    .select("status")
    .eq("tenant_id", instance.tenant_id)
    .eq("group_jid", groupJid)
    .maybeSingle()

  if (existing) return existing.status as "monitor" | "ignore" | "pending"

  const subject = (msg as { message?: { groupSubject?: string }; subject?: string })?.message?.groupSubject
              ?? (msg as { subject?: string })?.subject
              ?? null

  await supabaseAdmin
    .from("chat_groups_whitelist")
    .insert({
      tenant_id:   instance.tenant_id,
      instance_id: instance.id,
      group_jid:   groupJid,
      group_name:  subject,
      status:      "pending",
    })
    .select("id")
    .maybeSingle()

  return "pending"
}

async function findOrCreateGroupConversation(
  tenantId:   string,
  instanceId: string,
  groupJid:   string,
  groupName:  string | null,
) {
  const { data: existing } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, status, unread_count")
    .eq("tenant_id", tenantId)
    .eq("group_jid", groupJid)
    .eq("is_group", true)
    .in("status", ["open", "pending", "snoozed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return { ...existing, _isNew: false }

  let pipelineId: string | null = null
  let stageId:    string | null = null

  const { data: tc } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (tc?.default_pipeline_id) {
    pipelineId = tc.default_pipeline_id
    const { data: triageStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("tenant_id", tenantId)
      .eq("is_triage", true)
      .limit(1)
      .maybeSingle()
    stageId = triageStage?.id ?? null
  }

  const { data: newConv, error } = await supabaseAdmin
    .from("chat_conversations")
    .insert({
      tenant_id:     tenantId,
      contact_id:    null,
      instance_id:   instanceId,
      status:        "open",
      unread_count:  0,
      pipeline_id:   pipelineId,
      stage_id:      stageId,
      card_position: 0,
      is_group:      true,
      group_jid:     groupJid,
      group_name:    groupName,
    })
    .select("id, status, unread_count")
    .single()

  // Race: outro webhook paralelo já criou a conversa de grupo ativa.
  if (error?.code === "23505") {
    const { data: raceWinner } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, status, unread_count")
      .eq("tenant_id", tenantId)
      .eq("group_jid", groupJid)
      .eq("is_group", true)
      .in("status", ["open", "pending", "snoozed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
    if (raceWinner) return { ...raceWinner, _isNew: false }
  }

  if (error || !newConv) throw new Error(`Failed to create group conversation: ${error?.message}`)
  return { ...newConv, _isNew: true }
}
