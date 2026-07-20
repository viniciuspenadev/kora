"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { normalizeRichDoc, isEmptyRichDoc, type RichDoc } from "@/lib/commercial/richdoc"

// ═══════════════════════════════════════════════════════════════
// Modelos de Cotação e Contrato (F2b) — CRUD gated admin/owner + crm.
// Contextos: condicoes · observacoes · contrato. Governança do dono; o time
// só INSERE no compositor (leitura à parte, na integração). Doc: §5.
// ═══════════════════════════════════════════════════════════════

export type TemplateContext = "condicoes" | "observacoes" | "contrato"
const CONTEXTS: TemplateContext[] = ["condicoes", "observacoes", "contrato"]

export interface QuoteTemplate {
  id: string; context: TemplateContext; title: string; body: RichDoc
  active: boolean; always_include: boolean; position: number
}

async function requireAdmin(): Promise<{ tenantId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!scope.isAdmin) return { error: "Sem permissão" }
  if (!(await hasModule(scope.tenantId, "crm"))) return { error: "Módulo CRM não habilitado" }
  return { tenantId: scope.tenantId }
}

const ROUTE = "/configuracoes/cotacao"

/** Todos os modelos do tenant (gestão) — agrupáveis por contexto no client. */
export async function listQuoteTemplates(): Promise<QuoteTemplate[]> {
  const gate = await requireAdmin()
  if ("error" in gate) return []
  const { data } = await supabaseAdmin.from("tenant_quote_templates")
    .select("id, context, title, body, active, always_include, position")
    .eq("tenant_id", gate.tenantId)
    .order("context").order("position").order("created_at")
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, context: r.context as TemplateContext, title: r.title as string,
    body: normalizeRichDoc(r.body), active: !!r.active, always_include: !!r.always_include, position: Number(r.position ?? 0),
  }))
}

export async function createQuoteTemplate(context: TemplateContext, title: string): Promise<{ id?: string; error?: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  if (!CONTEXTS.includes(context)) return { error: "Contexto inválido" }
  const clean = title.trim()
  if (!clean) return { error: "Dê um nome ao modelo" }
  const { data, error } = await supabaseAdmin.from("tenant_quote_templates")
    .insert({ tenant_id: gate.tenantId, context, title: clean.slice(0, 120), body: { v: 1, blocks: [] } })
    .select("id").maybeSingle()
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return { id: data?.id as string | undefined }
}

export async function updateQuoteTemplate(id: string, patch: { title?: string; body?: RichDoc }): Promise<{ error?: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) {
    const t = patch.title.trim()
    if (!t) return { error: "Nome não pode ficar vazio" }
    fields.title = t.slice(0, 120)
  }
  if (patch.body !== undefined) fields.body = normalizeRichDoc(patch.body)
  const { error } = await supabaseAdmin.from("tenant_quote_templates")
    .update(fields).eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

export async function setTemplateActive(id: string, active: boolean): Promise<{ error?: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  // Desligar Ativo desliga o "sempre incluir" junto (fail-closed).
  const patch: Record<string, unknown> = { active, updated_at: new Date().toISOString() }
  if (!active) patch.always_include = false
  const { error } = await supabaseAdmin.from("tenant_quote_templates")
    .update(patch).eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

export async function setTemplateAlwaysInclude(id: string, always: boolean): Promise<{ error?: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  // "Sempre incluir" só vale com Ativo — ligar um garante o outro.
  const patch: Record<string, unknown> = { always_include: always, updated_at: new Date().toISOString() }
  if (always) patch.active = true
  const { error } = await supabaseAdmin.from("tenant_quote_templates")
    .update(patch).eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

export async function deleteQuoteTemplate(id: string): Promise<{ error?: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { error } = await supabaseAdmin.from("tenant_quote_templates")
    .delete().eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

// ── Pacote inicial (nasce cheia) — semeia um contexto se estiver VAZIO ──
const p = (text: string, marks?: Partial<{ b: true }>): { t: "p"; runs: { text: string; b?: true }[] } =>
  ({ t: "p", runs: [{ text, ...(marks?.b ? { b: true } : {}) }] })
const h = (text: string): { t: "h"; runs: { text: string }[] } => ({ t: "h", runs: [{ text }] })

const STARTER: Record<TemplateContext, { title: string; body: RichDoc; always_include?: boolean }[]> = {
  condicoes: [
    { title: "Entrada + parcelado", body: { v: 1, blocks: [
      { t: "ul", items: [[{ text: "30% na assinatura;" }], [{ text: "70% em 3× sem juros no cartão ou boleto." }]] },
    ] } },
    { title: "À vista (Pix)", body: { v: 1, blocks: [p("Pagamento à vista via Pix, com condição especial.")] } },
  ],
  observacoes: [
    { title: "Validade e reajuste", body: { v: 1, blocks: [p("Esta proposta tem validade — atente-se ao prazo; após ele os valores podem ser reajustados.")] } },
  ],
  contrato: [
    { title: "Garantia e suporte", body: { v: 1, blocks: [h("Garantia e suporte"), p("Correções de defeito sem custo durante toda a vigência do contrato, com suporte em horário comercial.")] } },
    { title: "LGPD", body: { v: 1, blocks: [h("Tratamento de dados (LGPD)"), p("Os dados são tratados conforme a Lei 13.709/2018. O contratante é o controlador dos dados dos seus contatos.")] }, always_include: true },
    { title: "Cancelamento", body: { v: 1, blocks: [h("Cancelamento"), p("O cancelamento pode ser solicitado a qualquer momento, respeitando o aviso prévio acordado.")] } },
    { title: "Foro", body: { v: 1, blocks: [h("Foro"), p("Fica eleito o foro da comarca do contratado para dirimir eventuais controvérsias.")] }, always_include: true },
  ],
}

export async function seedStarterTemplates(context: TemplateContext): Promise<{ added: number; error?: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return { added: 0, error: gate.error }
  if (!CONTEXTS.includes(context)) return { added: 0, error: "Contexto inválido" }
  const { count } = await supabaseAdmin.from("tenant_quote_templates")
    .select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("context", context)
  if ((count ?? 0) > 0) return { added: 0 }   // só semeia se vazio
  const rows = STARTER[context]
    .filter((t) => !isEmptyRichDoc(t.body))
    .map((t, i) => ({ tenant_id: gate.tenantId, context, title: t.title, body: t.body, always_include: !!t.always_include, position: i }))
  const { error } = await supabaseAdmin.from("tenant_quote_templates").insert(rows)
  if (error) return { added: 0, error: error.message }
  revalidatePath(ROUTE)
  return { added: rows.length }
}
