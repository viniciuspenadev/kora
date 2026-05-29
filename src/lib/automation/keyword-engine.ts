/**
 * Engine de keyword triggers.
 *
 * Recebe a mensagem de entrada do contato, avalia os triggers ativos do
 * tenant em ordem de `position`, e dispara o primeiro match — respeitando
 * cooldown por (trigger, contato) e a regra de pausar quando há agente
 * atribuído.
 *
 * Retorna `true` se algum trigger disparou (pra o webhook decidir se ainda
 * roda AI/automações fixas em cima).
 */

import { supabaseAdmin } from "@/lib/supabase"
import { renderTemplate } from "./variables"
import { getProvider } from "@/lib/providers"

export interface KeywordTrigger {
  id:                  string
  tenant_id:           string
  name:                string
  patterns:            string[]
  match_type:          "exact" | "contains" | "starts_with"
  case_sensitive:      boolean
  response_text:       string | null
  apply_tag_id:        string | null
  cooldown_min:        number
  enabled:             boolean
  position:            number
  pause_when_assigned: boolean
}

interface InstanceForProvider {
  provider?:                 string | null
  evolution_url?:            string | null
  evolution_key?:            string | null
  instance_name?:            string | null
  meta_phone_number_id?:     string | null
  meta_business_account_id?: string | null
  meta_access_token?:        string | null
  meta_app_secret?:          string | null
}

interface EvaluateInput {
  tenantId:       string
  conversationId: string
  text:           string
  instance:       InstanceForProvider
}

/**
 * Testa se `text` bate com um trigger. Cada trigger pode ter múltiplos
 * patterns — basta um bater pra match.
 */
export function matchTrigger(text: string, trigger: KeywordTrigger): boolean {
  if (!text || !trigger.patterns?.length) return false

  const haystack = trigger.case_sensitive ? text : text.toLowerCase()

  for (const raw of trigger.patterns) {
    if (!raw) continue
    const needle = trigger.case_sensitive ? raw : raw.toLowerCase()

    switch (trigger.match_type) {
      case "exact":
        if (haystack.trim() === needle.trim()) return true
        break
      case "starts_with":
        if (haystack.trimStart().startsWith(needle.trim())) return true
        break
      case "contains":
      default:
        if (haystack.includes(needle.trim())) return true
        break
    }
  }
  return false
}

/**
 * Avalia triggers ativos pra essa conversa. Retorna `true` se um trigger
 * foi disparado (resposta enviada e/ou tag aplicada).
 */
export async function evaluateKeywordTriggers(input: EvaluateInput): Promise<boolean> {
  const { tenantId, conversationId, text, instance } = input
  if (!text?.trim()) return false

  // 1. Carrega conversa + contato + agente atribuído
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, contact_id, assigned_to, is_group,
      chat_contacts ( id, push_name, phone_number )
    `)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv || conv.is_group || !conv.contact_id) return false

  const contact = conv.chat_contacts as unknown as {
    id:           string
    push_name:    string | null
    phone_number: string
  } | null
  if (!contact) return false

  // 2. Carrega triggers ativos em ordem de prioridade
  const { data: triggers } = await supabaseAdmin
    .from("keyword_triggers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .order("position", { ascending: true })

  const list = (triggers ?? []) as KeywordTrigger[]
  if (list.length === 0) return false

  // 3. Avalia em ordem — primeiro match vence
  for (const t of list) {
    if (!matchTrigger(text, t)) continue

    // Skip se há agente atribuído e o trigger respeita
    if (t.pause_when_assigned && conv.assigned_to) continue

    // Skip se cooldown ainda ativo pra (trigger, contato)
    const cooldownMs = (t.cooldown_min ?? 0) * 60_000
    if (cooldownMs > 0) {
      const cutoff = new Date(Date.now() - cooldownMs).toISOString()
      const { data: lastRun } = await supabaseAdmin
        .from("keyword_trigger_runs")
        .select("id")
        .eq("trigger_id", t.id)
        .eq("contact_id", contact.id)
        .gte("fired_at", cutoff)
        .limit(1)
        .maybeSingle()
      if (lastRun) continue
    }

    // 4. Dispara: envia resposta + aplica tag (se configurados)
    let sent = false

    if (t.response_text?.trim()) {
      // Carrega contexto do tenant pra renderizar variáveis
      const { data: tenantRow } = await supabaseAdmin
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .single()

      const rendered = renderTemplate(t.response_text, {
        contact: {
          push_name:    contact.push_name,
          phone_number: contact.phone_number,
        },
        tenant: { name: tenantRow?.name ?? null },
      })

      try {
        const provider = getProvider(instance)
        const result   = await provider.sendText(contact.phone_number, rendered)

        await supabaseAdmin.from("chat_messages").insert({
          conversation_id: conversationId,
          tenant_id:       tenantId,
          sender_type:     "bot",
          content_type:    "text",
          content:         rendered,
          status:          "sent",
          whatsapp_msg_id: result.messageId || null,
          is_private_note: false,
          metadata:        { trigger_id: t.id, trigger_name: t.name },
        })

        await supabaseAdmin
          .from("chat_conversations")
          .update({
            last_message_at:      new Date().toISOString(),
            last_message_preview: rendered.substring(0, 100),
            updated_at:           new Date().toISOString(),
          })
          .eq("id", conversationId)

        sent = true
      } catch (err) {
        console.error(`[keyword-engine] failed sending trigger ${t.id}:`, err)
        // Continua pra registrar a fired_at — evita loop infinito se o
        // provider tá fora, ainda respeita cooldown.
      }
    }

    if (t.apply_tag_id) {
      const { error: tagErr } = await supabaseAdmin
        .from("taggings")
        .insert({
          tag_id:        t.apply_tag_id,
          tenant_id:     tenantId,
          taggable_type: "contact",
          taggable_id:   contact.id,
          tagged_by:     null,
        })
      // Ignora duplicate key (tag já aplicada)
      if (tagErr && !tagErr.message.includes("duplicate")) {
        console.error(`[keyword-engine] failed applying tag ${t.apply_tag_id}:`, tagErr)
      }
    }

    // 5. Registra a corrida pra cooldown
    await supabaseAdmin.from("keyword_trigger_runs").insert({
      trigger_id: t.id,
      tenant_id:  tenantId,
      contact_id: contact.id,
    })

    // Considera "disparado" se ao menos tag foi aplicada OU mensagem foi enviada
    return sent || !!t.apply_tag_id
  }

  return false
}
