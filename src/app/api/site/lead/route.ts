import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { assignNextAgent } from "@/lib/automation/auto-assign"

/**
 * POST /api/site/lead
 *
 * Visitante completou o form do widget. Cria contato + conversa
 * com channel='site', sem mensagem WhatsApp ainda. Atendente vai
 * iniciar a conversa do inbox quando for atender.
 *
 * Body: { slug, visitor_id, answers, url?, referrer?, utm? }
 *
 * answers: { name, phone, email?, intent?, ... resto custom }
 */
export async function POST(req: NextRequest) {
  // Rate-limit: 10 leads/min/IP — agressivo porque cada lead vira contato + conversa
  const ip = getClientIp(req)
  const rl = rateLimit(`site:lead:${ip}`, 10, 60_000)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  try {
    const body = await req.json() as {
      slug?:        string
      visitor_id?:  string
      answers?:     Record<string, string>
      url?:         string
      referrer?:    string
      utm_source?:  string
      utm_medium?:  string
      utm_campaign?: string
      utm_content?: string
      utm_term?:    string
      consent?:     {
        given?:      boolean
        at?:         string
        policy_url?: string
        text?:       string | null
      } | null
    }

    if (!body.slug || !body.answers) {
      return cors(NextResponse.json({ error: "missing fields" }, { status: 400 }))
    }

    const answers = body.answers
    const rawPhone = answers.phone ?? ""
    const phoneDigits = rawPhone.replace(/\D/g, "")

    if (!phoneDigits || phoneDigits.length < 10) {
      return cors(NextResponse.json({ error: "telefone inválido" }, { status: 400 }))
    }

    // Normaliza pra formato BR (assume 55 se omitido)
    const phone = phoneDigits.length < 12 ? `55${phoneDigits}` : phoneDigits
    const jid   = `${phone}@s.whatsapp.net`

    // Resolve tenant
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, active")
      .eq("slug", body.slug)
      .maybeSingle()

    if (!tenant?.active) {
      return cors(NextResponse.json({ error: "tenant not found" }, { status: 404 }))
    }

    // Config
    const { data: cfg } = await supabaseAdmin
      .from("site_widget_config")
      .select("enabled, default_department_id, default_tag_id, questions")
      .eq("tenant_id", tenant.id)
      .maybeSingle()

    if (!cfg?.enabled) {
      return cors(NextResponse.json({ error: "widget desabilitado" }, { status: 403 }))
    }

    // Instância WhatsApp do tenant (pra associar a conversa)
    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("tenant_id", tenant.id)
      .maybeSingle()

    if (!instance) {
      return cors(NextResponse.json({ error: "WhatsApp não configurado" }, { status: 503 }))
    }

    // Jornada: últimas 10 visitas desse visitor
    let journey: Array<Record<string, unknown>> = []
    if (body.visitor_id) {
      const { data: visits } = await supabaseAdmin
        .from("site_visits")
        .select("page_url, page_title, created_at")
        .eq("tenant_id", tenant.id)
        .eq("visitor_id", body.visitor_id)
        .order("created_at", { ascending: false })
        .limit(10)
      journey = visits ?? []
    }

    // ── Encontra ou cria contato ──────────────────────────────
    const { data: existingContact } = await supabaseAdmin
      .from("chat_contacts")
      .select("id, custom_name, email, metadata")
      .eq("tenant_id", tenant.id)
      .eq("whatsapp_id", jid)
      .maybeSingle()

    let contactId: string
    if (existingContact) {
      contactId = existingContact.id

      // Atualiza só campos que ainda estão vazios (não sobrescreve dados do atendente)
      const updates: Record<string, unknown> = {}
      if (!existingContact.custom_name && answers.name) {
        updates.custom_name = answers.name.trim()
      }
      if (!existingContact.email && answers.email) {
        updates.email = answers.email.trim().toLowerCase()
      }
      // Sempre acumula no metadata sem perder o que já existe
      const existingMeta = (existingContact.metadata ?? {}) as Record<string, unknown>
      // LGPD: histórico de consentimentos (cada submit do form é um novo registro)
      const consentHistory = (existingMeta.lgpd_consent_history as Array<unknown> | undefined) ?? []
      if (body.consent?.given) {
        consentHistory.push({
          at:         body.consent.at ?? new Date().toISOString(),
          policy_url: body.consent.policy_url ?? null,
          text:       body.consent.text ?? null,
          ip:         ip,
          user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
        })
      }
      updates.metadata = {
        ...existingMeta,
        lgpd_consent_history: consentHistory.slice(-10),  // mantém últimos 10
        last_site_visit: {
          page_url:    body.url ?? null,
          referrer:    body.referrer ?? null,
          utm:         pickUtm(body),
          journey,
          answers,
          at:          new Date().toISOString(),
        },
      }
      updates.updated_at = new Date().toISOString()

      if (Object.keys(updates).length > 0) {
        await supabaseAdmin
          .from("chat_contacts")
          .update(updates)
          .eq("id", contactId)
      }
    } else {
      const { data: newContact, error: cErr } = await supabaseAdmin
        .from("chat_contacts")
        .insert({
          tenant_id:           tenant.id,
          whatsapp_id:         jid,
          phone_number:        phone,
          push_name:           answers.name?.trim() ?? null,
          custom_name:         answers.name?.trim() ?? null,
          email:               answers.email?.trim().toLowerCase() ?? null,
          source:              "webform",        // aquisição (de onde veio)
          primary_channel:     "whatsapp",       // identidade (deu o número → phone)
          primary_external_id: jid,
          metadata: {
            first_site_lead: {
              page_url:  body.url ?? null,
              referrer:  body.referrer ?? null,
              utm:       pickUtm(body),
              journey,
              answers,
              at:        new Date().toISOString(),
            },
            // LGPD: prova de consentimento (Art. 8 §1º — ônus da prova do controlador)
            lgpd_consent: body.consent?.given ? {
              at:         body.consent.at ?? new Date().toISOString(),
              policy_url: body.consent.policy_url ?? null,
              text:       body.consent.text ?? null,
              ip:         ip,
              user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
            } : null,
          },
        })
        .select("id")
        .single()
      if (cErr || !newContact) {
        console.error("[/api/site/lead] create contact failed:", cErr)
        return cors(NextResponse.json({ error: "erro criando contato" }, { status: 500 }))
      }
      contactId = newContact.id
    }

    // ── Conversation Dedup: reusa ativa ou reabre fechada recente ──
    // Lead novo de contato existente NÃO cria nova conversa — append na existente.
    const dedup = await findOrReopenConversation({ tenantId: tenant.id, contactId })

    let conv: { id: string }
    if (dedup.found !== "none") {
      // Conversa existente (ativa ou reaberta) — atualiza preview + metadata; não muda stage/lifecycle
      const newPreview = answers.intent
        ? `Voltou pelo site: ${answers.intent.slice(0, 80)}`
        : "Voltou pelo site"
      const oldMeta = (dedup.conversation.metadata ?? {}) as Record<string, unknown>
      const history = (oldMeta.site_leads_history as Array<unknown> | undefined) ?? []
      await supabaseAdmin
        .from("chat_conversations")
        .update({
          last_message_preview: newPreview,
          last_message_at:      new Date().toISOString(),
          last_message_dir:     "in",
          unread_count:         ((dedup.conversation as { unread_count?: number }).unread_count ?? 0) + 1,
          updated_at:           new Date().toISOString(),
          metadata: {
            ...oldMeta,
            site_lead: {
              page_url:  body.url ?? null,
              referrer:  body.referrer ?? null,
              utm:       pickUtm(body),
              journey,
              answers,
            },
            site_leads_history: [...history.slice(-9), {
              at:       new Date().toISOString(),
              page_url: body.url ?? null,
              answers,
            }],
          },
        })
        .eq("id", dedup.conversation.id)
        .eq("tenant_id", tenant.id)
      conv = { id: dedup.conversation.id }
    } else {
      // Sem conversa reaproveitável — cria nova (channel='site', pool aberto)
      const { data: tc } = await supabaseAdmin
        .from("tenant_config")
        .select("default_pipeline_id")
        .eq("tenant_id", tenant.id)
        .maybeSingle()

      let pipelineId: string | null = tc?.default_pipeline_id ?? null
      let stageId:    string | null = null
      if (pipelineId) {
        const { data: firstStage } = await supabaseAdmin
          .from("pipeline_stages")
          .select("id")
          .eq("pipeline_id", pipelineId)
          .eq("tenant_id", tenant.id)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle()
        stageId = firstStage?.id ?? null
      }

      const { data: created, error: convErr } = await supabaseAdmin
        .from("chat_conversations")
        .insert({
          tenant_id:     tenant.id,
          contact_id:    contactId,
          instance_id:   instance.id,
          channel:       "site",
          status:        "open",
          unread_count:  1,
          pipeline_id:   pipelineId,
          stage_id:      stageId,
          card_position: 0,
          assigned_to:   null,  // pool
          last_message_preview: answers.intent
            ? `Lead via site: ${answers.intent.slice(0, 80)}`
            : "Novo lead via site",
          last_message_at: new Date().toISOString(),
          metadata: {
            site_lead: {
              page_url:  body.url ?? null,
              referrer:  body.referrer ?? null,
              utm:       pickUtm(body),
              journey,
              answers,
            },
          },
        })
        .select("id")
        .single()

      if (convErr || !created) {
        console.error("[/api/site/lead] create conversation failed:", convErr)
        return cors(NextResponse.json({ error: "erro criando conversa" }, { status: 500 }))
      }
      conv = created

      // Sprint 2.4 — Auto-assign apenas em conversa nova (NÃO em reusada/reaberta).
      // Fire-and-forget: não bloqueia a resposta do lead.
      assignNextAgent(tenant.id, conv.id)
        .catch((err) => console.error("[/api/site/lead] auto-assign failed:", err))
    }

    // ── Insere mensagens do lead no chat ──────────────────────
    // 1. System message slim: só metadata (origem/UTM) — nota no centro
    // 2. Contact bubble: respostas formatadas como se o visitante tivesse digitado
    const isReturning = dedup.found !== "none"
    const widgetQuestions = (cfg.questions as Array<{ id: string; label: string }> | null) ?? []

    await supabaseAdmin.from("chat_messages").insert([
      {
        conversation_id: conv.id,
        tenant_id:       tenant.id,
        sender_type:     "system",
        content_type:    "text",
        content:         buildLeadMetaMessage(body, isReturning),
        status:          "delivered",
        is_private_note: false,
        metadata:        { kind: "site_lead_meta" },
      },
      {
        conversation_id: conv.id,
        tenant_id:       tenant.id,
        sender_type:     "contact",
        content_type:    "text",
        content:         buildLeadContactMessage(answers, widgetQuestions, isReturning),
        status:          "delivered",
        is_private_note: false,
        metadata:        {
          kind:        "site_lead_answers",
          source:      "site_widget",
          page_url:    body.url ?? null,
          consent:     body.consent?.given ?? false,
        },
      },
    ])

    // ── Aplica tag/departamento default se configurados ───────
    if (cfg.default_tag_id) {
      await supabaseAdmin.from("taggings").insert({
        tag_id:        cfg.default_tag_id,
        tenant_id:     tenant.id,
        taggable_type: "contact",
        taggable_id:   contactId,
        tagged_by:     null,
      }).then((r) => {
        // Ignora duplicate key se tag já aplicada antes
        if (r.error && !r.error.message.includes("duplicate")) {
          console.error("[/api/site/lead] tag apply failed:", r.error)
        }
      })
    }

    if (cfg.default_department_id) {
      // Departamento é por usuário, não por conversa — então não muda aqui.
      // (Routing de conversa por depto seria Camada 2 do plano de visibilidade.)
    }

    return cors(NextResponse.json({
      ok:               true,
      conversation_id:  conv.id,
      contact_id:       contactId,
    }))
  } catch (err) {
    console.error("[/api/site/lead]", err)
    return cors(NextResponse.json({ error: "internal" }, { status: 500 }))
  }
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

// ── Helpers ──────────────────────────────────────────────────

function pickUtm(b: Record<string, unknown>): Record<string, string | null> {
  return {
    source:   (b.utm_source as string | undefined) ?? null,
    medium:   (b.utm_medium as string | undefined) ?? null,
    campaign: (b.utm_campaign as string | undefined) ?? null,
    content:  (b.utm_content as string | undefined) ?? null,
    term:     (b.utm_term as string | undefined) ?? null,
  }
}

/**
 * System message slim: só metadata técnica (URL de origem, UTM).
 * Renderizada como nota no centro do chat.
 */
function buildLeadMetaMessage(body: Record<string, unknown>, isReturning: boolean): string {
  const lines: string[] = [isReturning ? "Voltou pelo site" : "Novo lead pelo site"]
  if (body.url)        lines.push(`Página: ${body.url}`)
  if (body.referrer)   lines.push(`De: ${body.referrer}`)
  if (body.utm_source) lines.push(`UTM: ${body.utm_source}${body.utm_campaign ? ` · ${body.utm_campaign}` : ""}`)
  return lines.join("\n")
}

/**
 * Contact-style message: natural, como se o visitante tivesse digitado no WhatsApp.
 * Usa os labels das perguntas pra dar contexto. Cai no chat como bubble do contato.
 */
function buildLeadContactMessage(
  answers:   Record<string, string>,
  questions: Array<{ id: string; label: string }>,
  isReturning: boolean,
): string {
  const labelMap: Record<string, string> = {}
  for (const q of questions) labelMap[q.id] = q.label

  const intro = isReturning
    ? "Oi! Voltei pelo formulário do site."
    : "Oi! Vim pelo formulário do site."

  const lines: string[] = [intro, ""]
  for (const [key, value] of Object.entries(answers)) {
    if (!value?.trim()) continue
    const label = labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1)
    lines.push(`*${label}*`)
    lines.push(value)
    lines.push("")
  }
  // Remove trailing empty line
  while (lines[lines.length - 1] === "") lines.pop()
  return lines.join("\n")
}

function cors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*")
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.headers.set("Access-Control-Allow-Headers", "Content-Type")
  res.headers.set("Access-Control-Max-Age", "86400")
  return res
}
