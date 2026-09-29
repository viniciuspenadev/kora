/**
 * Relatório diário — compute de KPIs + envio orquestrado.
 *
 * Disparado pelo cron /api/cron/daily-reports. Pra cada tenant ativo com
 * daily_report_enabled=true, computa as métricas do "dia anterior" no
 * timezone Brasil e manda email pros destinatários configurados.
 *
 * Idempotência: tenant_config.daily_report_last_sent_at é checado pra não
 * mandar duas vezes no mesmo dia (caso o cron seja retentado).
 */

import { supabaseAdmin } from "@/lib/supabase"
import { sendEmail, buildDailyReportEmail } from "@/lib/email/send"

const BR_TZ_OFFSET_HOURS = -3  // BRT (sem horário de verão atualmente)

interface DailyKpis {
  newConversations: number
  messagesIn:       number
  messagesOut:      number
  newContacts:      number
  fromAdLeads:      number
}

/**
 * Retorna ISO date (YYYY-MM-DD) do "ontem" no timezone Brasil. Quando o cron
 * roda às 18h BRT, o "dia coberto" é HOJE (00h até agora) — ou seja, fechamento
 * do dia em curso. Mas como expediente comercial vai além das 18h, ajuste se
 * for esse o caso: aqui tratamos o report como "fim do dia útil de HOJE",
 * cobrindo 00h00 até a hora do envio.
 */
export function getReportDateBR(now = new Date()): string {
  // Converte pra BRT subtraindo UTC offset
  const brTime = new Date(now.getTime() + BR_TZ_OFFSET_HOURS * 60 * 60 * 1000)
  return brTime.toISOString().slice(0, 10)
}

/** Retorna ISO date do dia anterior (ex: "2026-05-26" → "2026-05-25"). */
export function previousBrDate(brDate: string): string {
  const [y, m, d] = brDate.split("-").map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  return prev.toISOString().slice(0, 10)
}

/**
 * Computa janela UTC pra um dia BRT (00:00 → 23:59:59).
 * Ex: dia BRT "2026-05-26" → UTC "2026-05-26T03:00" → "2026-05-27T02:59:59"
 */
function brDayToUtcRange(brDate: string): { startUtc: string; endUtc: string } {
  const [y, m, d] = brDate.split("-").map(Number)
  // BRT 00:00 = UTC 03:00 (BRT é UTC-3)
  const startUtc = new Date(Date.UTC(y, m - 1, d, -BR_TZ_OFFSET_HOURS, 0, 0))
  const endUtc   = new Date(Date.UTC(y, m - 1, d + 1, -BR_TZ_OFFSET_HOURS, 0, 0) - 1)
  return { startUtc: startUtc.toISOString(), endUtc: endUtc.toISOString() }
}

export async function computeDailyKpis(tenantId: string, brDate: string): Promise<DailyKpis> {
  const { startUtc, endUtc } = brDayToUtcRange(brDate)

  const [
    convsRes,
    msgsInRes,
    msgsOutRes,
    contactsRes,
    adsRes,
  ] = await Promise.all([
    // Conversas ATIVAS no dia (última msg no dia). Conta o cliente que voltou — a
    // conversa reabre, não é "nova". Alinhado ao card "Conversas" do dashboard.
    supabaseAdmin
      .from("chat_conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("last_message_at", startUtc)
      .lte("last_message_at", endUtc),

    // Mensagens recebidas (contact)
    supabaseAdmin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("sender_type", "contact")
      .gte("created_at", startUtc)
      .lte("created_at", endUtc),

    // Mensagens enviadas (agent — exclui system e notas privadas)
    supabaseAdmin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("sender_type", "agent")
      .eq("is_private_note", false)
      .gte("created_at", startUtc)
      .lte("created_at", endUtc),

    // Novos contatos
    supabaseAdmin
      .from("chat_contacts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", startUtc)
      .lte("created_at", endUtc),

    // Conversas vindas de anúncio (first-touch no dia)
    supabaseAdmin
      .from("chat_conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .not("from_ad_meta", "is", null)
      .gte("created_at", startUtc)
      .lte("created_at", endUtc),
  ])

  return {
    newConversations: convsRes.count    ?? 0,
    messagesIn:       msgsInRes.count   ?? 0,
    messagesOut:      msgsOutRes.count  ?? 0,
    newContacts:      contactsRes.count ?? 0,
    fromAdLeads:      adsRes.count      ?? 0,
  }
}

/**
 * Pega lista de destinatários do tenant. Se daily_report_emails está vazio,
 * faz fallback pros owners + admins ativos do tenant.
 */
async function resolveRecipients(tenantId: string, customEmails: string[]): Promise<string[]> {
  if (customEmails.length > 0) return customEmails

  const { data } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id, role, profiles!tenant_users_user_id_fkey ( email )")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", ["owner", "admin"])

  const emails: string[] = []
  for (const tu of (data ?? [])) {
    const p = (tu as { profiles: unknown }).profiles
    const email = Array.isArray(p) ? (p[0] as { email?: string } | undefined)?.email : (p as { email?: string } | null)?.email
    if (email) emails.push(email)
  }
  return emails
}

export interface DailyReportRunResult {
  tenantId:    string
  tenantName:  string
  status:      "sent" | "skipped" | "failed"
  reason?:     string
  recipients?: number
  kpis?:       DailyKpis
}

export interface RunReportOptions {
  /** Ignora a verificação de idempotência (last_sent_at). Útil pra "enviar teste agora" do god mode. */
  forceSend?: boolean
  /** Sobrescreve a lista de destinatários (ignora config do tenant e fallback). Útil pra admin testar enviando pro próprio email. */
  recipientsOverride?: string[]
  /** Ignora o toggle daily_report_enabled. Pra god mode forçar teste mesmo se tenant desativou. */
  ignoreDisabled?: boolean
  /** Quando true, NÃO atualiza last_sent_at (mantém o ciclo normal). Default true em testes do god mode. */
  skipUpdateLastSent?: boolean
}

/**
 * Roda 1 vez pra um tenant. Skip se já mandou hoje, se desabilitado, ou se
 * não houve atividade nenhuma (zerados = não vale spammar inbox).
 *
 * Aceita opts pra testes administrativos (god mode):
 *   - forceSend: ignora idempotência
 *   - recipientsOverride: envia pra lista custom em vez dos configurados
 *   - ignoreDisabled: envia mesmo se tenant desativou
 */
async function sendForTenant(tenant: { id: string; name: string }, brDate: string, appUrl: string, opts: RunReportOptions = {}): Promise<DailyReportRunResult> {
  const { data: config } = await supabaseAdmin
    .from("tenant_config")
    .select("daily_report_enabled, daily_report_emails, daily_report_last_sent_at")
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  if (!config) {
    return { tenantId: tenant.id, tenantName: tenant.name, status: "skipped", reason: "sem tenant_config" }
  }
  if (!config.daily_report_enabled && !opts.ignoreDisabled) {
    return { tenantId: tenant.id, tenantName: tenant.name, status: "skipped", reason: "desabilitado" }
  }

  // Idempotência: já mandou hoje? (skipável em testes administrativos)
  if (!opts.forceSend && config.daily_report_last_sent_at) {
    const lastSentDay = getReportDateBR(new Date(config.daily_report_last_sent_at))
    if (lastSentDay === brDate) {
      return { tenantId: tenant.id, tenantName: tenant.name, status: "skipped", reason: "já enviado hoje" }
    }
  }

  const [kpis, prevKpis] = await Promise.all([
    computeDailyKpis(tenant.id, brDate),
    computeDailyKpis(tenant.id, previousBrDate(brDate)),
  ])
  const totalActivity = kpis.newConversations + kpis.messagesIn + kpis.messagesOut + kpis.newContacts
  if (totalActivity === 0 && !opts.forceSend) {
    // Sem atividade no dia — não polui inbox dos clientes (testes admin podem forçar)
    if (!opts.skipUpdateLastSent) {
      await supabaseAdmin
        .from("tenant_config")
        .update({ daily_report_last_sent_at: new Date().toISOString() })
        .eq("tenant_id", tenant.id)
    }
    return { tenantId: tenant.id, tenantName: tenant.name, status: "skipped", reason: "sem atividade no dia", kpis }
  }

  const recipients = opts.recipientsOverride && opts.recipientsOverride.length > 0
    ? opts.recipientsOverride
    : await resolveRecipients(tenant.id, config.daily_report_emails ?? [])
  if (recipients.length === 0) {
    return { tenantId: tenant.id, tenantName: tenant.name, status: "skipped", reason: "sem destinatários" }
  }

  const email = buildDailyReportEmail({
    tenantName:       tenant.name,
    reportDate:       brDate,
    newConversations: kpis.newConversations,
    messagesIn:       kpis.messagesIn,
    messagesOut:      kpis.messagesOut,
    newContacts:      kpis.newContacts,
    fromAdLeads:      kpis.fromAdLeads,
    previous: {
      newConversations: prevKpis.newConversations,
      messagesIn:       prevKpis.messagesIn,
      messagesOut:      prevKpis.messagesOut,
      newContacts:      prevKpis.newContacts,
      fromAdLeads:      prevKpis.fromAdLeads,
    },
    appUrl,
  })

  // Manda 1 email por destinatário (Resend cobra por destinatário mesmo se BCC,
  // e individuais dão tracking limpo por linha no outbox).
  let sentCount = 0
  let lastError: string | undefined
  for (const to of recipients) {
    const result = await sendEmail({
      to,
      subject:      email.subject,
      html:         email.html,
      text:         email.text,
      templateSlug: "daily_report",
      tenantId:     tenant.id,
      metadata:     { report_date: brDate, kpis },
    })
    if (result.ok) sentCount++
    else lastError = result.ok === false && "error" in result ? result.error : "configured: false"
  }

  if (sentCount > 0) {
    if (!opts.skipUpdateLastSent) {
      await supabaseAdmin
        .from("tenant_config")
        .update({ daily_report_last_sent_at: new Date().toISOString() })
        .eq("tenant_id", tenant.id)
    }
    return { tenantId: tenant.id, tenantName: tenant.name, status: "sent", recipients: sentCount, kpis }
  }

  return { tenantId: tenant.id, tenantName: tenant.name, status: "failed", reason: lastError ?? "sem motivo", kpis }
}

/**
 * Roda o relatório pra UM tenant específico. Usado pelo god mode pra testar
 * o disparo manualmente, com opções de override.
 */
export async function runDailyReportForTenant(
  tenantId: string,
  opts: RunReportOptions = {},
  now = new Date(),
): Promise<DailyReportRunResult> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle()

  if (!tenant) {
    return { tenantId, tenantName: "(desconhecido)", status: "failed", reason: "tenant não encontrado" }
  }

  const brDate = getReportDateBR(now)
  const appUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000"

  try {
    return await sendForTenant(tenant, brDate, appUrl, opts)
  } catch (err) {
    return { tenantId: tenant.id, tenantName: tenant.name, status: "failed", reason: (err as Error).message }
  }
}

/**
 * Orquestrador chamado pelo cron. Pega todos os tenants ativos e envia
 * em série (poucos tenants ainda; quando crescer, paraleliza com batch).
 */
export async function sendDailyReports(now = new Date()): Promise<DailyReportRunResult[]> {
  const brDate = getReportDateBR(now)
  const appUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000"

  const { data: tenants } = await supabaseAdmin
    .from("tenants")
    .select("id, name")
    .eq("active", true)

  const results: DailyReportRunResult[] = []
  for (const t of tenants ?? []) {
    try {
      const r = await sendForTenant(t, brDate, appUrl)
      results.push(r)
    } catch (err) {
      results.push({
        tenantId:   t.id,
        tenantName: t.name,
        status:     "failed",
        reason:     (err as Error).message,
      })
    }
  }
  return results
}
