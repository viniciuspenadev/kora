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
// Deferido: F2b = bastão de continuação (o fluxo segue no fio WhatsApp no reply,
// espelhando `campaign_engage`).
// ✅ F2c (identidade) FEITO em 2026-08-03: o JID canônico vem do provedor, não da nossa
//    normalização. Falta a metade do pré-check `onWhatsApp` — hoje "não tem WhatsApp"
//    ainda é deduzido de sucesso/falha do envio, o que confunde número inexistente com
//    rede fora do ar.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { createInboundConversation } from "@/lib/channels/inbound-conversation"
import { normalizePhone, phoneToJid } from "@/lib/phone-utils"
import { adoptRecipientJid } from "@/lib/contacts/identity"
import type { ExecCtx } from "../capabilities/types"

export type OutreachBranch = "sent" | "no_whatsapp" | "blocked"

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

export async function runOutreach(ctx: ExecCtx, input: OutreachInput): Promise<{ branch: OutreachBranch }> {
  const { tenantId, contact } = ctx
  if (ctx.dryRun) return { branch: "sent" }   // simulador não transmite

  // 1. Número destino (país-base do tenant). Implausível → sem WhatsApp.
  const { data: tc } = await supabaseAdmin.from("tenant_config")
    .select("default_country").eq("tenant_id", tenantId).maybeSingle()
  const phone = normalizePhone(input.phoneRaw, (tc?.default_country as string | null) ?? "BR")
  if (!phone) return { branch: "no_whatsapp" }

  // 2. Número de saída.
  const inst = await pickInstance(tenantId, input.channel, input.instanceId)
  if (!inst) return { branch: "blocked" }
  const isOfficial = inst.provider === "meta_cloud"
  const provider = getProvider(inst)

  // 3. Conteúdo por canal — fail-closed ESTRUTURAL. O contato veio de outro canal
  //    (ex: site) → fora da janela 24h do Oficial → só TEMPLATE; baileys = texto.
  if (isOfficial) {
    if (!input.templateName?.trim() || !provider.sendTemplate) return { branch: "blocked" }
    // Marketing exige opt-in (I5 omnichannel — endereçável ≠ abordável).
    if (input.marketing) {
      const { data: c } = await supabaseAdmin.from("chat_contacts")
        .select("marketing_opt_in").eq("id", contact.id).eq("tenant_id", tenantId).maybeSingle()
      if (!(c as { marketing_opt_in?: boolean } | null)?.marketing_opt_in) return { branch: "blocked" }
    }
  } else {
    if (!input.text?.trim()) return { branch: "blocked" }
  }

  // 4. Abre/acha o fio WhatsApp do MESMO contato (dedup por contato+canal+instância).
  const conv = await createInboundConversation({ tenantId, contactId: contact.id, instanceId: inst.id, channel: "whatsapp" })

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
    return { branch: "no_whatsapp" }
  }

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

  return { branch: "sent" }
}
