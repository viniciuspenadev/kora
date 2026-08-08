import { supabaseAdmin } from "@/lib/supabase"

/**
 * Cache + histórico de message templates (tabelas `wa_templates` /
 * `wa_template_events`, migration 20260604). Escrita SEMPRE via service-role:
 *   • `syncTemplatesCache` (action) — espelha o que a Graph lista, e
 *   • o webhook Meta (`message_template_*`) — mantém status/qualidade em tempo real.
 *
 * Leitura é pelo tenant via RLS. Tudo aqui é best-effort/fire-and-forget: uma
 * falha de cache NUNCA pode derrubar o webhook nem a UI (a verdade segue na Graph).
 */

export interface TemplateCacheInput {
  templateId?:     string | null
  name:            string
  language:        string
  category?:       string | null
  status?:         string | null
  qualityScore?:   string | null   // GREEN/YELLOW/RED/UNKNOWN
  rejectedReason?: string | null
  correctCategory?: string | null
  components?:     unknown          // snapshot jsonb
}

/** Upsert do estado atual de um template (chave: tenant_id + name + language). */
export async function upsertTemplateCache(
  tenantId:   string,
  instanceId: string | null,
  wabaId:     string | null,
  t:          TemplateCacheInput,
): Promise<void> {
  try {
    const row: Record<string, unknown> = {
      tenant_id:   tenantId,
      instance_id: instanceId,
      waba_id:     wabaId,
      name:        t.name,
      language:    t.language,
      updated_at:  new Date().toISOString(),
    }
    // Só sobrescreve colunas que vieram (webhook parcial não apaga o que já tem).
    if (t.templateId      != null) row.template_id      = t.templateId
    if (t.category        != null) row.category         = t.category
    if (t.status          != null) row.status           = t.status
    if (t.qualityScore    != null) row.quality_score    = t.qualityScore
    if (t.rejectedReason  != null) row.rejected_reason  = t.rejectedReason
    if (t.correctCategory != null) row.correct_category = t.correctCategory
    if (t.components       !== undefined) row.components = t.components

    const { error } = await supabaseAdmin
      .from("wa_templates")
      .upsert(row, { onConflict: "tenant_id,name,language" })
    if (error) console.error("[template-cache] upsert", error.message)
  } catch (e) {
    console.error("[template-cache] upsert threw", (e as Error).message)
  }
}

export interface TemplateEventInput {
  templateId?: string | null
  name?:       string | null
  language?:   string | null
  event:       "status_update" | "quality_update" | "category_update"
  oldValue?:   string | null
  newValue?:   string | null
  reason?:     string | null
}

/** Log append-only de uma mudança de template (histórico/alertas). */
export async function logTemplateEvent(tenantId: string, e: TemplateEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("wa_template_events").insert({
      tenant_id:   tenantId,
      template_id: e.templateId ?? null,
      name:        e.name ?? null,
      language:    e.language ?? null,
      event:       e.event,
      old_value:   e.oldValue ?? null,
      new_value:   e.newValue ?? null,
      reason:      e.reason ?? null,
    })
    if (error) console.error("[template-cache] event", error.message)
  } catch (e2) {
    console.error("[template-cache] event threw", (e2 as Error).message)
  }
}

/** Lê o histórico de um template (mais recente primeiro) — usado na página dedicada. */
export async function getTemplateEvents(
  tenantId: string, name: string, language: string, limit = 20,
): Promise<Array<{ event: string; old_value: string | null; new_value: string | null; reason: string | null; created_at: string }>> {
  const { data, error } = await supabaseAdmin
    .from("wa_template_events")
    .select("event, old_value, new_value, reason, created_at")
    .eq("tenant_id", tenantId).eq("name", name).eq("language", language)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) { console.error("[template-cache] history", error.message); return [] }
  return data ?? []
}
