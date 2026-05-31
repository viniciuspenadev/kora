/**
 * Avalia e dispara automações disponíveis após uma mensagem de contato chegar.
 *
 * Ordem: business_hours (alta prioridade — sempre que fora do horário) → welcome.
 * Só uma automação dispara por mensagem. Pausa se conversa tem agente atribuído,
 * é grupo, ou se cooldown ainda ativo.
 */

import { supabaseAdmin }    from "@/lib/supabase"
import { renderTemplate }   from "./variables"
import { isOutsideBusinessHours, type BusinessHoursSchedule } from "./business-hours"
import { getProvider }      from "@/lib/providers"
import type { WhatsAppProvider } from "@/lib/providers"

interface TenantAutomationConfig {
  welcome_enabled:         boolean
  welcome_message:         string | null
  welcome_trigger:         "first_ever" | "after_resolved" | "always"
  welcome_reopen_days:     number
  business_hours_enabled:  boolean
  business_hours_message:  string | null
  business_hours_schedule: BusinessHoursSchedule | Record<string, unknown>
  business_hours_timezone: string
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

interface DispatchInput {
  tenantId:       string
  conversationId: string
  instance:       InstanceForProvider
}

const BUSINESS_HOURS_COOLDOWN_MS  = 60 * 60 * 1000      // 1h
const WELCOME_COOLDOWN_DEFAULT_MS = 24 * 60 * 60 * 1000 // 24h

export async function dispatchAutomations(input: DispatchInput): Promise<void> {
  const { tenantId, conversationId, instance } = input

  // 1. Carrega conversa + contato + tenant em uma volta
  const { data: convRow } = await supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, metadata, assigned_to, is_group, contact_id,
      chat_contacts ( id, push_name, phone_number, created_at )
    `)
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!convRow) return
  if (convRow.is_group) return        // grupos não recebem auto-reply
  if (convRow.assigned_to) return     // agente já atendendo

  const contact = convRow.chat_contacts as unknown as {
    id:           string
    push_name:    string | null
    phone_number: string
    created_at:   string | null
  } | null
  if (!contact) return

  // 2. Config de automação + tenant
  const [{ data: configRow }, { data: tenantRow }] = await Promise.all([
    supabaseAdmin
      .from("tenant_config")
      .select(`
        welcome_enabled, welcome_message, welcome_trigger, welcome_reopen_days,
        business_hours_enabled, business_hours_message, business_hours_schedule, business_hours_timezone
      `)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .maybeSingle(),
  ])

  if (!configRow) return
  const cfg = configRow as TenantAutomationConfig

  if (!cfg.business_hours_enabled && !cfg.welcome_enabled) return

  const provider   = getProvider(instance)
  const convMeta   = (convRow.metadata ?? {}) as Record<string, unknown>
  const tenantName = tenantRow?.name ?? null

  // ── 1. Business hours (prioridade alta) ─────────────────────
  if (cfg.business_hours_enabled && cfg.business_hours_message) {
    const lastSent = convMeta.business_hours_replied_at as string | undefined
    const cooledOff =
      !lastSent || (Date.now() - new Date(lastSent).getTime()) > BUSINESS_HOURS_COOLDOWN_MS

    if (cooledOff && isOutsideBusinessHours(
      cfg.business_hours_schedule as BusinessHoursSchedule,
      cfg.business_hours_timezone,
    )) {
      const sent = await sendAutomationReply({
        tenantId,
        conversationId,
        contact,
        provider,
        template: cfg.business_hours_message,
        tenantName,
        kind: "business_hours",
      })
      if (sent) {
        await markConversationMeta(conversationId, convMeta, "business_hours_replied_at")
        return
      }
    }
  }

  // ── 2. Welcome ──────────────────────────────────────────────
  if (cfg.welcome_enabled && cfg.welcome_message) {
    const lastWelcome = convMeta.welcome_sent_at as string | undefined
    const cooledOff =
      !lastWelcome || (Date.now() - new Date(lastWelcome).getTime()) > WELCOME_COOLDOWN_DEFAULT_MS

    if (!cooledOff) return

    const shouldSend = await evaluateWelcomeTrigger(
      tenantId,
      contact,
      conversationId,
      cfg.welcome_trigger,
      cfg.welcome_reopen_days,
    )
    if (!shouldSend) return

    const sent = await sendAutomationReply({
      tenantId,
      conversationId,
      contact,
      provider,
      template: cfg.welcome_message,
      tenantName,
      kind: "welcome",
    })
    if (sent) {
      await markConversationMeta(conversationId, convMeta, "welcome_sent_at")
    }
  }
}

async function evaluateWelcomeTrigger(
  tenantId:         string,
  contact:          { id: string; created_at: string | null },
  currentConvId:    string,
  trigger:          TenantAutomationConfig["welcome_trigger"],
  reopenDays:       number,
): Promise<boolean> {
  if (trigger === "always") return true

  if (trigger === "first_ever") {
    // Contato é "primeira-vez" se criado nos últimos 60s
    if (!contact.created_at) return false
    return Date.now() - new Date(contact.created_at).getTime() < 60_000
  }

  if (trigger === "after_resolved") {
    const { data: prev } = await supabaseAdmin
      .from("chat_conversations")
      .select("status, updated_at")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contact.id)
      .neq("id", currentConvId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!prev || prev.status !== "resolved") return false
    const daysAgo = (Date.now() - new Date(prev.updated_at).getTime()) / (24 * 60 * 60 * 1000)
    return daysAgo >= reopenDays
  }

  return false
}

async function sendAutomationReply(args: {
  tenantId:       string
  conversationId: string
  contact:        { push_name: string | null; phone_number: string }
  provider:       WhatsAppProvider
  template:       string
  tenantName:     string | null
  kind:           "welcome" | "business_hours"
}): Promise<boolean> {
  const text = renderTemplate(args.template, {
    contact: { push_name: args.contact.push_name, phone_number: args.contact.phone_number },
    tenant:  { name: args.tenantName },
  })

  if (!text.trim()) return false

  try {
    const result = await args.provider.sendText(args.contact.phone_number, text)

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: args.conversationId,
      tenant_id:       args.tenantId,
      sender_type:     "agent",
      sender_id:       null,
      content_type:    "text",
      content:         text,
      whatsapp_msg_id: result.messageId || null,
      status:          "sent",
      is_private_note: false,
      metadata:        { automation: args.kind, automated: true },
    })

    await supabaseAdmin
      .from("chat_conversations")
      .update({
        last_message_at:      new Date().toISOString(),
        last_message_preview: text.slice(0, 100),
        last_message_dir:     "out",
        updated_at:           new Date().toISOString(),
      })
      .eq("id", args.conversationId)

    return true
  } catch (err) {
    console.error(`[automation:${args.kind}] failed:`, err)
    return false
  }
}

async function markConversationMeta(
  conversationId: string,
  currentMeta:    Record<string, unknown>,
  key:            string,
) {
  const merged = { ...currentMeta, [key]: new Date().toISOString() }
  await supabaseAdmin
    .from("chat_conversations")
    .update({ metadata: merged })
    .eq("id", conversationId)
}
