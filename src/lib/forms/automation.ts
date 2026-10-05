import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { isTenantServiceable } from "@/lib/auth/tenant-serviceable"
import { loadStudioConfig } from "@/lib/ai-v2/studio-config"
import { runFormEntry } from "@/lib/ai-v2/flow/runtime"
import { createNotification } from "@/lib/notifications"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import type { Answers } from "./definition"
import { buildFormFlowVariables } from "./flow-variables"
import { outcomeFromEntry, NEEDS_CONTACT, NEEDS_CONTACT_REASON, type FormOutcome } from "./outcomes"
import type { FlowRow } from "@/lib/ai-v2/flow/types"
import type { ExecCtx } from "@/lib/ai-v2/capabilities"
import type { ContactRow } from "@/lib/llm/context"
import type { InstanceForProvider } from "@/types/automation"

// ═══════════════════════════════════════════════════════════════
// Formulário enviado → o Kora chama no WhatsApp (docs/forms-design.md §4.3, Fase 3)
// ═══════════════════════════════════════════════════════════════
// Roda DEPOIS de a resposta estar gravada e ligada à ficha (o envio público não espera).
//   1. Acha o fluxo do Studio ligado a ESTE formulário (publicado e ativo; um por formulário).
//   2. Portões de gasto: módulo Kora Studio + empresa em dia (`isTenantServiceable`) —
//      quem GASTA fora de sessão pergunta sempre (memória tenant-status-gate).
//   3. Um disparo por resposta: `received → flow_started` num UPDATE condicional.
//   4. `runFormEntry`: o trecho antes do Disparar roda sem conversa; o Disparar passa a
//      conversa para o WhatsApp.
//   5. Grava a situação no comprovante. Se o Kora NÃO chamou, avisa donos e admins
//      (sininho + celular) — o pedido nunca fica parado calado.

const CONTACT_COLS = "id, custom_name, push_name, phone_number, email, company, doc_id, birth_date, lifecycle_stage, notes, source, primary_channel, bsuid, primary_external_id, created_at"

type SubmissionRow = {
  id: string; form_id: string; version_id: string; contact_id: string | null; contact_name: string
  phone_e164: string; answers: Answers; source: { kind?: string; utm?: Record<string, string> } | null
  outcome: string; created_at: string
}

/** O fluxo que começa por este formulário (publicado + ativo). O mais antigo vence, sempre o mesmo. */
export async function findFormFlow(tenantId: string, formId: string): Promise<FlowRow | null> {
  const { data, error } = await supabaseAdmin.from("studio_flows")
    .select("id, tenant_id, name, version, trigger, graph")
    .eq("tenant_id", tenantId).eq("status", "published").eq("active", true)
    .eq("trigger->>type", "form_submitted").eq("trigger->>formId", formId)
    .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(1)
  if (error) throw new Error(`fluxo do formulário: ${error.message}`)
  return ((data ?? []) as FlowRow[])[0] ?? null
}

async function settle(tenantId: string, id: string, outcome: FormOutcome, conversationId?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { outcome }
  if (conversationId) patch.conversation_id = conversationId
  const { error } = await supabaseAdmin.from("form_submissions").update(patch).eq("tenant_id", tenantId).eq("id", id)
  if (error) console.error(JSON.stringify({ src: "forms-automation", kind: "settle-failed", code: error.code }))
}

/** Donos e admins ativos recebem: "o Kora não chamou — ligue para a pessoa". Best-effort. */
async function notifyNeedsContact(tenantId: string, sub: SubmissionRow, formName: string, outcome: FormOutcome): Promise<void> {
  try {
    const { data } = await supabaseAdmin.from("tenant_users").select("user_id")
      .eq("tenant_id", tenantId).eq("active", true).in("role", ["owner", "admin"])
    const ids = [...new Set(((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((v): v is string => !!v))]
    const reason = NEEDS_CONTACT_REASON[outcome] ?? "o Kora não conseguiu chamar no WhatsApp"
    await Promise.all(ids.map((recipientId) => createNotification({
      tenantId, recipientId, type: "form_needs_contact",
      title: `Pedido pelo formulário: fale com ${sub.contact_name.split(" ")[0]}`,
      body: `${sub.contact_name} enviou “${formName}”, mas ${reason}. WhatsApp: ${formatPhoneDisplay(sub.phone_e164)}.`,
      payload: { url: `/formularios/${sub.form_id}?aba=respostas`, form_id: sub.form_id, submission_id: sub.id },
    })))
  } catch (e) {
    console.error(JSON.stringify({ src: "forms-automation", kind: "notify-failed", message: (e as Error)?.message ?? "erro" }))
  }
}

/** Variáveis que o fluxo recebe (catálogo e valores em flow-variables.ts) + estado interno. */
export function formFlowVariables(sub: SubmissionRow, formName: string, definition: unknown): Record<string, unknown> {
  return {
    ...buildFormFlowVariables({
      contactName: sub.contact_name, phoneE164: sub.phone_e164, formName, definition,
      answers: sub.answers, source: sub.source,
    }),
    // Régua do "É novo × É da casa" (Condição): o pedido é o começo deste fluxo.
    __run_started_at: sub.created_at,
    __form: { form_id: sub.form_id, submission_id: sub.id },
  }
}

export async function startFormAutomation(tenantId: string, submissionId: string): Promise<FormOutcome | null> {
  const { data: subRow } = await supabaseAdmin.from("form_submissions")
    .select("id, form_id, version_id, contact_id, contact_name, phone_e164, answers, source, outcome, created_at")
    .eq("tenant_id", tenantId).eq("id", submissionId).maybeSingle()
  const sub = subRow as SubmissionRow | null
  if (!sub || sub.outcome !== "received") return null
  const { data: formRow } = await supabaseAdmin.from("forms").select("id, name").eq("tenant_id", tenantId).eq("id", sub.form_id).maybeSingle()
  const formName = (formRow as { name?: string } | null)?.name ?? "formulário"

  let flow: FlowRow | null = null
  try { flow = await findFormFlow(tenantId, sub.form_id) } catch (e) { console.error(JSON.stringify({ src: "forms-automation", kind: "find-flow-failed", message: (e as Error).message })) }
  const canRun = !!flow && (await hasModule(tenantId, "ai_studio")) && (await isTenantServiceable(tenantId))
  if (!flow || !canRun) {
    await settle(tenantId, sub.id, "no_flow")
    await notifyNeedsContact(tenantId, sub, formName, "no_flow")
    return "no_flow"
  }

  // Um disparo por resposta, mesmo que esta função rode duas vezes para o mesmo envio.
  const { data: claimed } = await supabaseAdmin.from("form_submissions").update({ outcome: "flow_started" })
    .eq("tenant_id", tenantId).eq("id", sub.id).eq("outcome", "received").select("id")
  if (!claimed?.length) return null

  let outcome: FormOutcome = "flow_error"
  let conversationId: string | null = null
  try {
    const [{ data: contactRow }, { data: ver }, config, { data: deptData }, { data: tagData }, { data: stageData }, { data: svcData }, { data: resData }] = await Promise.all([
      sub.contact_id
        ? supabaseAdmin.from("chat_contacts").select(CONTACT_COLS).eq("tenant_id", tenantId).eq("id", sub.contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("form_versions").select("definition").eq("tenant_id", tenantId).eq("id", sub.version_id).maybeSingle(),
      loadStudioConfig(tenantId),
      supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
      supabaseAdmin.from("tags").select("id, name").eq("tenant_id", tenantId).order("name"),
      supabaseAdmin.from("pipeline_stages").select("id, name, position").eq("tenant_id", tenantId).order("position"),
      supabaseAdmin.from("tenant_services").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
      supabaseAdmin.from("tenant_resources").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    ])
    const contact = contactRow as ContactRow | null
    if (!contact) throw new Error("resposta sem ficha de contato")
    const ctx: ExecCtx = {
      tenantId,
      conversationId: "",                                  // ainda não existe conversa
      // O Disparar manda para o número DIGITADO no formulário (a ficha pode ter outro).
      contact: { ...contact, phone_number: sub.phone_e164 },
      // Sem conversa não há número de atendimento: o Disparar escolhe o dele. Qualquer leitura
      // aqui antes do bastão é defeito — falha alto em vez de agir no número errado.
      instance: null as unknown as InstanceForProvider,
      channel: "form",
      departments: (deptData ?? []) as { id: string; name: string }[],
      tags: (tagData ?? []) as { id: string; name: string }[],
      stages: (stageData ?? []) as { id: string; name: string }[],
      services: (svcData ?? []) as { id: string; name: string }[],
      resources: (resData ?? []) as { id: string; name: string }[],
      conversationMetadata: {},
      history: [],
      model: config.ai_model,
      pace: { usedMs: 0 },
    }
    const persona = {
      name: config.ai_name, tone: config.ai_tone, language: config.ai_language, identityText: config.identity_text,
      communicationStyle: config.communication_style_text, antiPatterns: config.anti_patterns_text,
    }
    const result = await runFormEntry(
      { ctx, model: config.ai_model, persona, history: [], incomingText: "" },
      flow,
      { variables: formFlowVariables(sub, formName, (ver as { definition?: unknown } | null)?.definition), formId: sub.form_id, submissionId: sub.id },
    )
    outcome = outcomeFromEntry(result)
    conversationId = result.conversationId ?? null
  } catch (e) {
    console.error(JSON.stringify({ src: "forms-automation", kind: "run-failed", message: (e as Error)?.message ?? "erro" }))
    outcome = "flow_error"
  }
  await settle(tenantId, sub.id, outcome, conversationId)
  if (NEEDS_CONTACT.has(outcome)) await notifyNeedsContact(tenantId, sub, formName, outcome)
  return outcome
}
