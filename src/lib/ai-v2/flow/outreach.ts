// ═══════════════════════════════════════════════════════════════
// Kora Studio — nó Disparar no WhatsApp (outreach cross-canal) §F2a
// ═══════════════════════════════════════════════════════════════
// O fluxo roda no fio de ORIGEM (ex: site). Este nó dispara pro número do
// CONTATO no WhatsApp: abre/acha o fio WhatsApp do MESMO contato, aplica o
// gate ESTRUTURAL (oficial fora da janela → só template; baileys → texto),
// envia, persiste no fio WhatsApp e linka a identidade. docs/studio-outreach-
// node-design.md. Reusa a máquina de campanha (createInboundConversation +
// provider.sendTemplate/sendText).
//
// ✅ F2b (bastão) FEITO em 2026-10-01: o resultado devolve o fio WhatsApp aberto e o
//    runtime passa o resto do fluxo para ele (`handOffToConversation`, runtime.ts).
// ✅ F2c (identidade) FEITO em 2026-08-03: o JID canônico vem do provedor, não da nossa
//    normalização. Falta a metade do pré-check `onWhatsApp` — hoje "não tem WhatsApp"
//    ainda é deduzido de sucesso/falha do envio, o que confunde número inexistente com
//    rede fora do ar.
// ✅ Trava anti-canhão (2026-10-01, docs/forms-design.md §6 S2): todo disparo pede a vaga
//    em `claimOutreach` ANTES de abrir conversa ou enviar. E conversa que já está com um
//    atendente não recebe mensagem automática por cima — o responsável é avisado.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { createInboundConversation } from "@/lib/channels/inbound-conversation"
import { normalizePhone, phoneToJid } from "@/lib/phone-utils"
import { adoptRecipientJid } from "@/lib/contacts/identity"
import { createNotification } from "@/lib/notifications"
import { claimOutreach, settleOutreach, warnOutreachCapHit, OUTREACH_PHONE_WINDOW_HOURS, type OutreachOrigin, type OutreachRefusal } from "@/lib/outreach/guard"
import { noteFlowSkip } from "../outbound"
import type { ExecCtx } from "../capabilities/types"

export type OutreachBranch = "sent" | "no_whatsapp" | "blocked"

/** Por que o disparo não saiu (ou `undefined` quando saiu). Vai para a variável do nó
 *  e para a nota interna — recusar é aceitável, recusar calado não. */
export type OutreachReason =
  | "invalid_phone" | "no_instance" | "content_blocked" | "no_marketing_opt_in"
  | "human_attendance" | "send_failed" | OutreachRefusal

export interface OutreachResult {
  branch:          OutreachBranch
  /** Fio WhatsApp onde a mensagem foi gravada (`sent`, fora do simulador) — ou, em
   *  `human_attendance`, a conversa que já está com o atendente (nada foi enviado nela). */
  conversationId?: string
  reason?:         OutreachReason
}

/** Entradas já RESOLVIDAS pelo runtime (telefone lido da var/contato; texto e
 *  params de template já interpolados) — este helper não interpola. */
export interface OutreachInput {
  channel:           "official" | "baileys" | "auto"
  instanceId?:       string
  phoneRaw:          string
  marketing?:        boolean
  templateName?:     string
  templateLanguage?: string
  templateParams?:   string[]
  text?:             string
  /** De onde veio o pedido (trava por origem no livro). */
  origin:            OutreachOrigin
  flowId?:           string | null
  /** Formulário que pediu (livro de disparos liga a linha ao comprovante). */
  formId?:           string | null
  submissionId?:     string | null
}

const ORIGIN_LABEL: Record<OutreachOrigin, string> = { site: "chat do site", form: "formulário", flow: "fluxo" }

/** Texto da nota interna no fio de ORIGEM quando a trava segura o disparo. */
function refusalNote(reason: OutreachRefusal): string {
  switch (reason) {
    case "phone_window":
      return `🛡️ O Kora não chamou no WhatsApp: este número já recebeu uma mensagem automática nas últimas ${OUTREACH_PHONE_WINDOW_HOURS} h. Se precisar falar com a pessoa, responda manualmente.`
    case "tenant_hourly_cap":
      return "🛡️ O Kora não chamou no WhatsApp: muitas mensagens automáticas na última hora. Os disparos ficam segurados por segurança do número da empresa."
    case "guard_unavailable":
      return "⚠️ O Kora não chamou no WhatsApp: não foi possível confirmar a trava de segurança agora. Nada foi enviado."
  }
}

interface InstanceRow { id: string; provider: "meta_cloud" | "baileys" | null; [k: string]: unknown }

/** Resolve o número de saída: instanceId explícito → 1ª do provider desejado →
 *  (auto) prefere oficial (meta_cloud vem antes de baileys na ordem desc). */
async function pickInstance(tenantId: string, channel: string, instanceId?: string): Promise<InstanceRow | null> {
  if (instanceId) {
    const { data } = await supabaseAdmin.from("whatsapp_instances").select("*")
      .eq("tenant_id", tenantId).eq("id", instanceId).maybeSingle()
    return (data as InstanceRow | null) ?? null
  }
  let q = supabaseAdmin.from("whatsapp_instances").select("*").eq("tenant_id", tenantId)
  if (channel === "official") q = q.eq("provider", "meta_cloud")
  else if (channel === "baileys") q = q.eq("provider", "baileys")
  // auto: 'meta_cloud' > 'baileys' em ordem desc → oficial primeiro.
  const { data } = await q.order("provider", { ascending: false }).order("created_at", { ascending: true })
  return ((data as InstanceRow[] | null) ?? [])[0] ?? null
}

export async function runOutreach(ctx: ExecCtx, input: OutreachInput): Promise<OutreachResult> {
  const { tenantId, contact } = ctx
  if (ctx.dryRun) return { branch: "sent" }   // simulador não transmite

  // 1. Número destino (país-base do tenant). Implausível → sem WhatsApp.
  const { data: tc } = await supabaseAdmin.from("tenant_config")
    .select("default_country").eq("tenant_id", tenantId).maybeSingle()
  const phone = normalizePhone(input.phoneRaw, (tc?.default_country as string | null) ?? "BR")
  if (!phone) return { branch: "no_whatsapp", reason: "invalid_phone" }

  // 2. Número de saída.
  const inst = await pickInstance(tenantId, input.channel, input.instanceId)
  if (!inst) return { branch: "blocked", reason: "no_instance" }
  const isOfficial = inst.provider === "meta_cloud"
  const provider = getProvider(inst)

  // 3. Conteúdo por canal — fail-closed ESTRUTURAL. O contato veio de outro canal
  //    (ex: site) → fora da janela 24h do Oficial → só TEMPLATE; baileys = texto.
  if (isOfficial) {
    if (!input.templateName?.trim() || !provider.sendTemplate) return { branch: "blocked", reason: "content_blocked" }
    // Marketing exige opt-in (I5 omnichannel — endereçável ≠ abordável).
    if (input.marketing) {
      const { data: c } = await supabaseAdmin.from("chat_contacts")
        .select("marketing_opt_in").eq("id", contact.id).eq("tenant_id", tenantId).maybeSingle()
      if (!(c as { marketing_opt_in?: boolean } | null)?.marketing_opt_in) return { branch: "blocked", reason: "no_marketing_opt_in" }
    }
  } else {
    if (!input.text?.trim()) return { branch: "blocked", reason: "content_blocked" }
  }

  // 4. Conversa que JÁ está com um atendente não recebe mensagem automática por cima.
  //    Espiada só de leitura (mesmo escopo do dedup: contato + número + WhatsApp, fio
  //    ativo) ANTES de reservar vaga ou abrir conversa. Quem atende é avisado: o cliente
  //    pediu de novo, e quem decide o que dizer é a pessoa, não o robô.
  const { data: live } = await supabaseAdmin.from("chat_conversations")
    .select("id, assigned_to, ai_handling")
    .eq("tenant_id", tenantId).eq("contact_id", contact.id).eq("instance_id", inst.id).eq("channel", "whatsapp")
    .in("status", ["open", "pending", "snoozed"])
    .order("updated_at", { ascending: false }).limit(1).maybeSingle()
  const human = live as { id: string; assigned_to: string | null; ai_handling: boolean | null } | null
  if (human && human.id !== ctx.conversationId && human.assigned_to && !human.ai_handling) {
    await holdForHuman(ctx, human.id, human.assigned_to, input.origin)
    return { branch: "blocked", reason: "human_attendance", conversationId: human.id }
  }

  // 5. Trava anti-canhão: reserva a vaga ANTES de abrir conversa ou enviar.
  const claim = await claimOutreach({
    tenantId, phoneE164: phone, origin: input.origin,
    flowId: input.flowId ?? null, sourceConversationId: ctx.conversationId || null,
    formId: input.formId ?? null, submissionId: input.submissionId ?? null,
  })
  if (!claim.allowed) {
    const reason = claim.reason ?? "guard_unavailable"
    if (reason === "tenant_hourly_cap" && claim.firstCapHit) await warnOutreachCapHit(tenantId)
    if (ctx.conversationId) {
      await noteFlowSkip(ctx, refusalNote(reason), { node: "outreach", reason, origin: input.origin })
    }
    return { branch: "blocked", reason }
  }
  const logId = claim.logId!

  // 6. Abre/acha o fio WhatsApp do MESMO contato (dedup por contato+canal+instância).
  let conv: Awaited<ReturnType<typeof createInboundConversation>>
  try {
    conv = await createInboundConversation({ tenantId, contactId: contact.id, instanceId: inst.id, channel: "whatsapp" })
  } catch (e) {
    await settleOutreach(tenantId, logId, "failed", { reason: "conversation_failed" })
    throw e
  }

  // 5. Envia. Falha = número provavelmente não está no WhatsApp / não elegível.
  let messageId: string | null = null
  /** Quem a REDE disse que recebeu. `null` = o provedor não informou (ver passo 7). */
  let recipientJid: string | null = null
  let display = ""
  try {
    if (isOfficial) {
      const params = (input.templateParams ?? []).filter((p) => p.trim() !== "").map((p) => ({ text: p }))
      const res = await provider.sendTemplate!(phone, input.templateName!.trim(), input.templateLanguage?.trim() || "pt_BR", params.length ? params : undefined)
      messageId = res.messageId || null
      recipientJid = res.recipientJid ?? null
      display = `[template: ${input.templateName!.trim()}]`
    } else {
      const res = await provider.sendText(phone, input.text!.trim())
      messageId = res.messageId || null
      recipientJid = res.recipientJid ?? null
      display = input.text!.trim()
    }
  } catch (e) {
    console.error("[outreach send]", (e as Error)?.message ?? e)
    await settleOutreach(tenantId, logId, "failed", { conversationId: conv.id, reason: "send_failed" })
    return { branch: "no_whatsapp", reason: "send_failed" }
  }
  await settleOutreach(tenantId, logId, "sent", { conversationId: conv.id })

  // 6. Persiste a mensagem NO FIO WhatsApp (não no canal de origem).
  const now = new Date().toISOString()
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conv.id, tenant_id: tenantId,
    sender_type: "bot", content_type: "text", content: display,
    status: "sent", whatsapp_msg_id: messageId, is_private_note: false,
    metadata: { studio: true, studio_outreach: true, from_channel: ctx.channel ?? null },
  })
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: now, last_message_preview: display.slice(0, 100), last_message_dir: "out", updated_at: now,
  }).eq("id", conv.id).eq("tenant_id", tenantId)

  // 7. Identidade + carimbo de consentimento (base de SERVIÇO: o lead te procurou e deu
  //    o número — NÃO liga marketing_opt_in).
  //
  // 🔴 A IDENTIDADE VEM DA REDE, NUNCA DO NÚMERO DIGITADO. Era `phoneToJid(phone)`: a
  //    gente pegava o telefone que a pessoa escreveu, colava `@s.whatsapp.net` e guardava
  //    como se fosse quem ela é. Em 02/08 isso partiu um lead em dois contatos e duas
  //    conversas — digitou `5543984994692`, o WhatsApp entregou para `554384994692`, e a
  //    resposta dele não casou com o nosso palpite. Telefone é DESTINO; identidade é o
  //    que o provedor responde. Sem resposta da rede, **não gravamos identidade nenhuma**:
  //    o telefone fica como atributo e a identidade chega quando a pessoa responder.
  //
  // ⚠️ `phone_number` continua sendo o que a pessoa DIGITOU. É o número que ela reconhece
  //    e o envio funciona nas duas grafias (o WhatsApp resolve). Quem carrega identidade
  //    é o `whatsapp_id`.
  //
  // 🔴 SEM RESPOSTA DA REDE, O PALPITE CONTINUA VALENDO — e isso não é recaída. Ele acerta
  //    em todo DDD onde o 9 existe de verdade (11–30, a maioria do tráfego): ali a resposta
  //    do cliente casa e não duplica. Trocar o palpite por NADA consertaria o caso raro e
  //    quebraria o comum. O palpite é o piso; a resposta da rede, quando vem, o substitui.
  try {
    const { data: cur } = await supabaseAdmin.from("chat_contacts")
      .select("whatsapp_id, phone_number, consent_at").eq("id", contact.id).eq("tenant_id", tenantId).maybeSingle()
    const row = cur as { whatsapp_id: string | null; phone_number: string | null; consent_at: string | null } | null
    /**
     * 🔴 DOIS UPDATES SEPARADOS, e isto é correção de um bug MEDIDO em produção.
     *
     *    Era um patch só: telefone + consentimento + identidade juntos. Quando o JID
     *    palpitado já pertencia a outro contato (o cliente que já estava na base voltou
     *    pelo widget), a violação de chave única **revertia o UPDATE inteiro** e levava a
     *    prova de consentimento junto — e o `catch` lá embaixo só logava.
     *
     *    Medido em 30/07: o contato do Gabriel ficou com `whatsapp_id` NULO **e**
     *    `consent_at` NULO **e** `consent_source` NULO. O do Alan, cujo JID não colidiu,
     *    gravou os três. Ou seja: no caso exato em que o duplicado nasce, a base de
     *    consentimento LGPD some sem ninguém perceber.
     *
     *    Dado do lead e identidade têm riscos diferentes de falhar — não podem viajar
     *    no mesmo UPDATE.
     */
    const dados: Record<string, unknown> = { updated_at: now }
    if (!row?.phone_number?.trim()) dados.phone_number = phone
    if (!row?.consent_at)         { dados.consent_at = now; dados.consent_source = "site_flow" }
    if (Object.keys(dados).length > 1) {
      const { error } = await supabaseAdmin.from("chat_contacts").update(dados)
        .eq("id", contact.id).eq("tenant_id", tenantId)
      if (error) console.error("[outreach dados]", error.code, error.message)
    }

    // Piso de identidade, em UPDATE PRÓPRIO: se colidir (o duplicado já existe), morre
    // sozinho e não arrasta o consentimento.
    if (!row?.whatsapp_id) {
      const { error } = await supabaseAdmin.from("chat_contacts")
        .update({ whatsapp_id: phoneToJid(phone), updated_at: now })
        .eq("id", contact.id).eq("tenant_id", tenantId)
      if (error) console.error("[outreach piso de identidade] colidiu:", error.code, error.message)
    }
    // E a verdade da rede, quando existe, substitui o piso. Mesma porta de todo envio.
    await adoptRecipientJid(tenantId, contact.id, recipientJid)
  } catch (e) {
    console.error("[outreach identity]", (e as Error)?.message ?? e)
  }

  return { branch: "sent", conversationId: conv.id }
}

/**
 * O cliente pediu contato de novo, mas a conversa dele no WhatsApp já está com um
 * atendente. Nada vai para o cliente; vão uma nota interna na conversa dele e um aviso
 * (sininho + push) para quem atende. Best-effort: nunca derruba o fluxo.
 */
async function holdForHuman(ctx: ExecCtx, conversationId: string, assignedTo: string, origin: OutreachOrigin): Promise<void> {
  const nome = ctx.contact.custom_name?.trim() || ctx.contact.push_name?.trim() || "O cliente"
  const via = ORIGIN_LABEL[origin]
  try {
    await noteFlowSkip({ ...ctx, conversationId },
      `🔔 ${nome} pediu contato de novo pelo ${via}. O Kora não mandou mensagem automática porque esta conversa está em atendimento.`,
      { node: "outreach", reason: "human_attendance", origin })
    if (ctx.conversationId) {
      await noteFlowSkip(ctx,
        "🔔 O Kora não chamou no WhatsApp: a conversa desta pessoa lá já está em atendimento. Quem atende foi avisado.",
        { node: "outreach", reason: "human_attendance", origin })
    }
    await createNotification({
      tenantId: ctx.tenantId, recipientId: assignedTo, type: "outreach_held",
      title: `${nome} pediu contato de novo`,
      body: `Veio pelo ${via}. A conversa já está com você, então o Kora não mandou mensagem automática.`,
      payload: { conversation_id: conversationId },
    })
  } catch (e) {
    console.error(JSON.stringify({ src: "outreach", kind: "hold-notice-failed", message: (e as Error)?.message ?? "erro" }))
  }
}
