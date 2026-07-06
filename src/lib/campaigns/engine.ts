import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { parseVars } from "@/lib/whatsapp/template-vars"
import { resolveAudienceContacts, classifyRecipient } from "./audience"

// ─────────────────────────────────────────────────────────────────
// Motor de disparo (F2b — docs/campanhas-waba-design.md §F2b).
// Materializa destinatários (consent fail-closed) + cron tick que envia por
// LOTE (tamanho × intervalo × jitter), com TETO DE TIER da Meta fail-closed.
// NÃO é "use server" — helpers de servidor, chamados pelo cron + actions.
// ─────────────────────────────────────────────────────────────────

/** Teto padrão de conversas de marketing/24h por número (default seguro pré-verificação Meta). */
const DEFAULT_TIER_CAP = 1000
/** Teto rígido de mensagens por tick (proteção do runtime — nunca um lote gigante). */
const MAX_BATCH_HARD = 200
/** Jitter anti-spam entre mensagens do lote (ms). */
const JITTER_MIN = 120, JITTER_MAX = 520
/** Lease do lote: empurra `next_batch_at` no INÍCIO do tick pra um cron sobreposto
 *  não re-selecionar a MESMA campanha e reenviar (MAX_BATCH_HARD×JITTER_MAX ≈ 104s). */
const BATCH_LEASE_SECONDS = 180

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const jitter = () => JITTER_MIN + Math.floor(Math.random() * (JITTER_MAX - JITTER_MIN))

/**
 * Materializa os destinatários de uma campanha: resolve a audiência, aplica o
 * consent fail-closed e grava linhas `queued` (elegíveis) ou `skipped` (motivo).
 * Idempotente — se já materializou, devolve as contagens atuais.
 */
export async function materializeRecipients(
  t: string, campaignId: string, kind: "list" | "tag", audienceId: string, category: "MARKETING" | "UTILITY",
): Promise<{ queued: number; skipped: number } | { error: string }> {
  const { count: existing } = await supabaseAdmin.from("campaign_recipients")
    .select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("campaign_id", campaignId)
  if ((existing ?? 0) > 0) {
    const { count: queued } = await supabaseAdmin.from("campaign_recipients")
      .select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("campaign_id", campaignId).eq("status", "queued")
    return { queued: queued ?? 0, skipped: (existing ?? 0) - (queued ?? 0) }
  }

  const contacts = await resolveAudienceContacts(t, kind, audienceId)
  let queued = 0, skipped = 0
  const rows = contacts.map((c) => {
    const r = classifyRecipient(c, category)
    if ("ok" in r) { queued++; return { tenant_id: t, campaign_id: campaignId, contact_id: c.id, phone: c.phone, status: "queued" } }
    skipped++
    return { tenant_id: t, campaign_id: campaignId, contact_id: c.id, phone: c.phone, status: "skipped", skip_reason: r.skip }
  })
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("campaign_recipients")
      .upsert(rows.slice(i, i + 500), { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
    if (error) return { error: error.message }
  }
  return { queued, skipped }
}

interface CampaignTickRow {
  id: string; tenant_id: string; instance_id: string
  template_name: string; template_language: string
  batch_size: number; batch_interval_seconds: number; tier_limit: number | null
}

/** Corpo do template (var keys) do cache `wa_templates` + status. `transient` distingue
 *  ERRO de query (blip de DB) de template AUSENTE — pra o tick não pausar por engano. */
async function loadTemplateBody(t: string, name: string, language: string): Promise<{ varKeys: string[]; approved: boolean } | { transient: true } | null> {
  const { data, error } = await supabaseAdmin.from("wa_templates")
    .select("components, status").eq("tenant_id", t).eq("name", name).eq("language", language).maybeSingle()
  if (error) return { transient: true }
  if (!data) return null
  const d = data as { components: Array<{ type?: string; text?: string }> | null; status: string | null }
  const body = d.components?.find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text ?? ""
  return { varKeys: parseVars(body).map((v) => v.key), approved: (d.status ?? "").toUpperCase() === "APPROVED" }
}

/** Quantas mensagens de campanha o NÚMERO já enviou nas últimas 24h (teto de tier).
 *  Fail-CLOSED: erro de DB devolve Infinity → o tick trata como "sem espaço" e retenta,
 *  nunca destrava o teto por um blip transitório. */
async function sentLast24h(t: string, instanceId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  // recipients enviados nas últimas 24h cujas campanhas usam este número.
  const { data: camps, error: campErr } = await supabaseAdmin.from("campaigns").select("id").eq("tenant_id", t).eq("instance_id", instanceId)
  if (campErr) return Number.POSITIVE_INFINITY
  const ids = ((camps ?? []) as { id: string }[]).map((c) => c.id)
  if (!ids.length) return 0
  const { count, error: countErr } = await supabaseAdmin.from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", t).in("campaign_id", ids).not("sent_at", "is", null).gte("sent_at", since)
  if (countErr) return Number.POSITIVE_INFINITY
  return count ?? 0
}

/**
 * Envia o PRÓXIMO LOTE de uma campanha running. Respeita tamanho do lote, teto de
 * tier (fail-closed) e jitter. Agenda o próximo lote; finaliza quando a fila zera.
 * Retorna quantas mensagens saíram neste tick.
 */
async function tickCampaign(c: CampaignTickRow): Promise<number> {
  const t = c.tenant_id
  const nowIso = () => new Date().toISOString()
  const armNext = (secs: number) => supabaseAdmin.from("campaigns")
    .update({ next_batch_at: new Date(Date.now() + secs * 1000).toISOString(), updated_at: nowIso() })
    .eq("id", c.id).eq("tenant_id", t)

  // Template ainda aprovado? (fail-closed: rejeitado/pausado pela Meta → pausa a campanha.)
  const tpl = await loadTemplateBody(t, c.template_name, c.template_language)
  if (tpl && "transient" in tpl) { await armNext(300); return 0 }   // blip de DB → retenta em 5min, NÃO pausa
  if (!tpl || !tpl.approved) {
    await supabaseAdmin.from("campaigns").update({ status: "paused", updated_at: nowIso() }).eq("id", c.id).eq("tenant_id", t)
    console.error("[campaign] template não aprovado — campanha pausada:", c.id, c.template_name)
    return 0
  }

  // Teto de tier do número (fail-closed).
  const cap = c.tier_limit ?? DEFAULT_TIER_CAP
  const already = await sentLast24h(t, c.instance_id)
  const room = Math.max(0, cap - already)
  if (room === 0) { await armNext(3600); return 0 }   // estourou o dia → tenta em 1h

  const limit = Math.min(c.batch_size, room, MAX_BATCH_HARD)
  const { data: batch } = await supabaseAdmin.from("campaign_recipients")
    .select("id, phone, chat_contacts(custom_name, push_name)")
    .eq("tenant_id", t).eq("campaign_id", c.id).eq("status", "queued")
    .order("created_at", { ascending: true }).limit(limit)
  const recips = (batch ?? []) as unknown as { id: string; phone: string | null; chat_contacts: { custom_name: string | null; push_name: string | null } | null }[]

  if (recips.length === 0) {
    // Fila vazia → concluída.
    await supabaseAdmin.from("campaigns").update({ status: "done", finished_at: nowIso(), next_batch_at: null, updated_at: nowIso() }).eq("id", c.id).eq("tenant_id", t)
    return 0
  }

  // Provider do número.
  const { data: instRow } = await supabaseAdmin.from("whatsapp_instances").select("*").eq("id", c.instance_id).eq("tenant_id", t).maybeSingle()
  if (!instRow) { await armNext(c.batch_interval_seconds); return 0 }
  const provider = getProvider(instRow)
  if (!provider.sendTemplate) { await armNext(3600); return 0 }

  // Lease: empurra o próximo lote pra frente ANTES de enviar. Um cron sobreposto
  // (lote > maxDuration) não re-seleciona esta campanha e não reenvia o mesmo lote.
  // O fim do tick reescreve next_batch_at com o intervalo real (ou finaliza).
  await armNext(BATCH_LEASE_SECONDS)

  let sent = 0
  for (const r of recips) {
    if (!r.phone) { await supabaseAdmin.from("campaign_recipients").update({ status: "skipped", skip_reason: "no_phone" }).eq("id", r.id).eq("tenant_id", t); continue }
    // Nome do contato preenche as variáveis (v1: name-fill; mapeamento por campo = F3).
    const name = (r.chat_contacts?.custom_name?.trim() || r.chat_contacts?.push_name?.trim() || "").trim()
    const bodyParams = tpl.varKeys.map((k) => ({ paramName: /^\d+$/.test(k) ? undefined : k, text: name }))
    try {
      const res = await provider.sendTemplate(r.phone, c.template_name, c.template_language, bodyParams.length ? bodyParams : undefined)
      await supabaseAdmin.from("campaign_recipients")
        .update({ status: "sent", wamid: res.messageId || null, sent_at: nowIso() })
        .eq("id", r.id).eq("tenant_id", t)
      sent++
    } catch (e) {
      await supabaseAdmin.from("campaign_recipients")
        .update({ status: "failed", error: (e as Error).message?.slice(0, 300) ?? "falha" })
        .eq("id", r.id).eq("tenant_id", t)
    }
    await sleep(jitter())
  }

  // Ainda tem fila? agenda o próximo lote; senão finaliza.
  const { count: left } = await supabaseAdmin.from("campaign_recipients")
    .select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("campaign_id", c.id).eq("status", "queued")
  if ((left ?? 0) > 0) await armNext(c.batch_interval_seconds)
  else await supabaseAdmin.from("campaigns").update({ status: "done", finished_at: nowIso(), next_batch_at: null, updated_at: nowIso() }).eq("id", c.id).eq("tenant_id", t)

  await supabaseAdmin.from("whatsapp_instances").update({ last_outbound_message_at: nowIso() }).eq("id", c.instance_id)
  return sent
}

/** Palavras de descadastro (opt-out global). 1ª palavra da resposta OU a msg inteira. */
const OPT_OUT_WORDS = new Set(["sair", "parar", "pare", "cancelar", "descadastrar", "remover", "stop", "unsubscribe", "sai"])

/** Este inbound é um pedido de descadastro? (1ª palavra OU a msg inteira = keyword de opt-out.) */
export function isOptOut(text: string): boolean {
  const norm = text.trim().toLowerCase()
  const first = norm.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}]+/u).filter(Boolean)[0] ?? ""
  return OPT_OUT_WORDS.has(first) || OPT_OUT_WORDS.has(norm)
}

/**
 * Inbound de um contato numa conversa: (1) OPT-OUT global — respondeu "SAIR" →
 * `marketing_opt_in=false` + sai das campanhas em andamento (queued→skipped); (2)
 * REPLIED — marca o destinatário mais recente como respondido (funil). Best-effort.
 * ⚠️ A marcação "replied" NÃO se aplica a campanhas COM fluxo: nessas o sinal
 * "sent/delivered/read → replied" é consumido pelo tier de engajamento no run.ts
 * (campaignFlowToTrigger + markRecipientReplied). Se este handler marcasse replied
 * aqui (sem debounce), roubaria o gatilho antes do fluxo ler → o fluxo nunca retoma.
 */
export async function handleCampaignInbound(t: string, contactId: string, text: string): Promise<void> {
  try {
    const now = new Date().toISOString()

    if (isOptOut(text)) {
      await supabaseAdmin.from("chat_contacts")
        .update({ marketing_opt_in: false, consent_source: "opt-out (respondeu descadastro)", updated_at: now })
        .eq("id", contactId).eq("tenant_id", t)
      await supabaseAdmin.from("campaign_recipients")
        .update({ status: "skipped", skip_reason: "opted_out" })
        .eq("tenant_id", t).eq("contact_id", contactId).eq("status", "queued")
    }

    // Respondeu → marca o recipient mais recente (forward-only: sent/delivered/read),
    // MAS só se a campanha dele NÃO for por-fluxo (senão o tier do run.ts perde o gatilho).
    const { data: recent } = await supabaseAdmin.from("campaign_recipients")
      .select("id, campaign_id").eq("tenant_id", t).eq("contact_id", contactId)
      .in("status", ["sent", "delivered", "read"]).order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    const r = recent as { id: string; campaign_id: string } | null
    if (r) {
      const { data: camp } = await supabaseAdmin.from("campaigns")
        .select("flow_id").eq("id", r.campaign_id).eq("tenant_id", t).maybeSingle()
      const isFlowCampaign = !!(camp as { flow_id: string | null } | null)?.flow_id
      if (!isFlowCampaign) {
        await supabaseAdmin.from("campaign_recipients")
          .update({ status: "replied", replied_at: now }).eq("id", r.id).eq("tenant_id", t)
      }
    }
  } catch (e) {
    console.error("[campaign inbound]", (e as Error).message)
  }
}

/**
 * Campanha-por-fluxo: este contato tem um opener de campanha ENVIADO (sent/
 * delivered/read, ainda não respondeu) cuja campanha tem `flow_id`? Se sim, o
 * próximo inbound dele É o engajamento → o caller roda esse fluxo com precedência
 * (per-conversa, sem conflito com atendimento). Devolve o flow_id + campaign + recipient.
 */
export async function campaignFlowToTrigger(
  t: string, contactId: string,
): Promise<{ flowId: string; campaignId: string; recipientId: string; templateName: string; templateLanguage: string } | null> {
  const { data: rec } = await supabaseAdmin.from("campaign_recipients")
    .select("id, campaign_id").eq("tenant_id", t).eq("contact_id", contactId)
    .in("status", ["sent", "delivered", "read"]).order("sent_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const r = rec as { id: string; campaign_id: string } | null
  if (!r) return null
  const { data: camp } = await supabaseAdmin.from("campaigns")
    .select("flow_id, status, template_name, template_language").eq("id", r.campaign_id).eq("tenant_id", t).maybeSingle()
  const c = camp as { flow_id: string | null; status: string; template_name: string; template_language: string } | null
  if (!c?.flow_id) return null
  // Cancelada não engaja (o disparo foi abortado); running/done/paused honram o
  // engajamento — o opener já saiu e o cliente está respondendo.
  if (c.status === "canceled") return null
  return { flowId: c.flow_id, campaignId: r.campaign_id, recipientId: r.id, templateName: c.template_name, templateLanguage: c.template_language }
}

/** Marca um recipient como respondido (o caller chama ao acionar a campanha-por-fluxo). */
export async function markRecipientReplied(t: string, recipientId: string): Promise<void> {
  await supabaseAdmin.from("campaign_recipients")
    .update({ status: "replied", replied_at: new Date().toISOString() })
    .eq("tenant_id", t).eq("id", recipientId).in("status", ["sent", "delivered", "read"])
}

/** Entrada do cron: processa as campanhas running cujo próximo lote venceu. */
export async function runCampaignTick(): Promise<{ processed: number; sent: number }> {
  const now = new Date().toISOString()
  const { data: due } = await supabaseAdmin.from("campaigns")
    .select("id, tenant_id, instance_id, template_name, template_language, batch_size, batch_interval_seconds, tier_limit")
    .eq("status", "running").not("next_batch_at", "is", null).lte("next_batch_at", now)
    .order("next_batch_at", { ascending: true }).limit(20)
  const camps = (due ?? []) as CampaignTickRow[]
  let sent = 0
  for (const c of camps) {
    try { sent += await tickCampaign(c) }
    catch (e) { console.error("[campaign tick]", c.id, (e as Error).message) }
  }
  return { processed: camps.length, sent }
}
