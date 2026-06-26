"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { generatePolicyMarkdown } from "@/lib/privacy-policy-template"

export interface WidgetQuestion {
  id:          string
  label:       string
  type:        "text" | "phone" | "email" | "longtext" | "select"
  required:    boolean
  placeholder?: string
  options?:    string[]
}

export interface WidgetConfig {
  enabled:             boolean
  mode:                "form" | "chat"   // form = captura (atual) · chat = conversa ao vivo com a IA
  chat_suggestions:    string[]          // chips de início do chat (modo chat)
  button_color:        string
  button_position:     "bottom-right" | "bottom-left"
  button_label:        string
  greeting:            string
  questions:           WidgetQuestion[]
  success_message:     string
  default_department_id: string | null
  default_tag_id:        string | null
  show_after_seconds:  number
  hide_url_patterns:   string[]
  off_hours_enabled:   boolean
  off_hours_message:   string | null
  // Branding
  logo_url:            string | null
  brand_name:          string | null
  subtitle:            string | null
  // LGPD
  privacy_policy_url:  string | null  // URL pública da política (Art. 9)
  consent_text:        string | null  // texto do checkbox; suporta {politica_privacidade}
  dpo_email:           string | null  // contato do encarregado (Art. 41)
}

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) {
    throw new Error("Apenas owner/admin")
  }
  return session
}

export async function getWidgetConfig(): Promise<WidgetConfig | null> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  const { data } = await supabaseAdmin
    .from("site_widget_config")
    .select(`
      enabled, mode, chat_suggestions, button_color, button_position, button_label,
      greeting, questions, success_message,
      default_department_id, default_tag_id,
      show_after_seconds, hide_url_patterns,
      off_hours_enabled, off_hours_message,
      logo_url, brand_name, subtitle,
      privacy_policy_url, consent_text, dpo_email
    `)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  return data as WidgetConfig | null
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const URL_HTTPS_RE = /^https?:\/\/[^\s<>"']{1,2000}$/i

/**
 * Gera template de política de privacidade em markdown, pronto pra tenant
 * copiar, editar nos pontos [EDITAR] e publicar no próprio site.
 *
 * Inclui dados do tenant (nome, DPO) e lista de dados coletados deriva
 * automaticamente das perguntas configuradas no widget.
 */
export async function generatePrivacyPolicy(): Promise<{ markdown: string }> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  const [{ data: tenant }, { data: cfg }] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single(),
    supabaseAdmin
      .from("site_widget_config")
      .select("questions, dpo_email")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ])

  // Deriva lista de dados coletados a partir das perguntas do widget
  type Q = { label: string }
  const collected = ((cfg?.questions as Q[] | undefined) ?? [])
    .map((q) => q.label)
    .filter(Boolean)

  // Adiciona dados padrão sempre coletados
  const allCollected = [
    ...collected,
    "Mensagens trocadas pelo WhatsApp",
    "Páginas do site visitadas (anonimizado)",
    "UTMs de origem (quando aplicável)",
  ]

  const markdown = generatePolicyMarkdown({
    tenantName:    tenant?.name ?? "Sua Empresa",
    dpoEmail:      cfg?.dpo_email ?? null,
    collectedData: allCollected,
  })

  return { markdown }
}

export async function updateWidgetConfig(input: Partial<WidgetConfig>): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  // ─── Hard input validation ──────────────────────────────────
  // 1. Hex color (impede CSS injection — CWE-79 via style attr)
  if (input.button_color !== undefined && !HEX_COLOR_RE.test(input.button_color)) {
    return { error: "Cor inválida. Use formato hexadecimal (#004add ou #04d)." }
  }

  // 2. logo_url só http(s), sem javascript:/data:/file: schemes
  if (input.logo_url !== undefined && input.logo_url !== null && input.logo_url !== "") {
    if (!URL_HTTPS_RE.test(input.logo_url)) {
      return { error: "URL do logo inválida. Use http:// ou https://." }
    }
  }

  // 2b. privacy_policy_url só http(s) (LGPD — link pra política do tenant)
  if (input.privacy_policy_url !== undefined && input.privacy_policy_url !== null && input.privacy_policy_url !== "") {
    if (!URL_HTTPS_RE.test(input.privacy_policy_url)) {
      return { error: "URL da política de privacidade inválida. Use http:// ou https://." }
    }
  }

  // 2c. dpo_email formato simples
  if (input.dpo_email !== undefined && input.dpo_email !== null && input.dpo_email !== "") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.dpo_email) || input.dpo_email.length > 254) {
      return { error: "Email do DPO inválido." }
    }
  }

  // 3. Position enum
  if (input.button_position !== undefined && !["bottom-right", "bottom-left"].includes(input.button_position)) {
    return { error: "Posição inválida." }
  }

  // 3b. Mode enum (form | chat)
  if (input.mode !== undefined && !["form", "chat"].includes(input.mode)) {
    return { error: "Modo inválido." }
  }

  // 4. Text length caps (impede storage abuse)
  const textCaps: Record<string, number> = {
    button_label: 60, greeting: 240, success_message: 400,
    brand_name: 80, subtitle: 120, off_hours_message: 400,
    consent_text: 400, privacy_policy_url: 500,
  }
  for (const [k, max] of Object.entries(textCaps)) {
    const v = (input as Record<string, unknown>)[k]
    if (typeof v === "string" && v.length > max) {
      return { error: `Campo ${k} excede ${max} caracteres.` }
    }
  }

  // 5. show_after_seconds bounded
  if (typeof input.show_after_seconds === "number") {
    if (input.show_after_seconds < 0 || input.show_after_seconds > 120) {
      return { error: "Delay deve estar entre 0 e 120 segundos." }
    }
  }

  // 6. hide_url_patterns: max 20 entries, max 200 chars each
  if (Array.isArray(input.hide_url_patterns)) {
    input.hide_url_patterns = input.hide_url_patterns
      .filter((p) => typeof p === "string" && p.trim() && p.length <= 200)
      .slice(0, 20)
  }

  // 6b. chat_suggestions: max 5 chips, até 48 chars cada
  if (Array.isArray(input.chat_suggestions)) {
    input.chat_suggestions = input.chat_suggestions
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => s.trim().slice(0, 48))
      .slice(0, 5)
  }

  // 7. Tenant ownership de default_department_id
  if (input.default_department_id) {
    const { data: dept } = await supabaseAdmin
      .from("tenant_departments")
      .select("id")
      .eq("id", input.default_department_id)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (!dept) return { error: "Departamento inválido." }
  }

  // 8. Tenant ownership de default_tag_id
  if (input.default_tag_id) {
    const { data: tag } = await supabaseAdmin
      .from("tags")
      .select("id")
      .eq("id", input.default_tag_id)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (!tag) return { error: "Tag inválida." }
  }

  // 9. Sanitize questions (max 5, valid types, length caps, max 8 options)
  if (input.questions) {
    const validTypes: WidgetQuestion["type"][] = ["text", "phone", "email", "longtext", "select"]
    input.questions = input.questions
      .slice(0, 5)
      .filter((q) => q.label?.trim() && q.id?.trim() && validTypes.includes(q.type))
      .map((q) => ({
        id:          q.id.trim().slice(0, 32),
        label:       q.label.trim().slice(0, 120),
        type:        q.type,
        required:    !!q.required,
        placeholder: q.placeholder?.trim().slice(0, 80) || undefined,
        options:     q.options?.filter((o) => o?.trim() && o.length <= 40).slice(0, 8) || undefined,
      }))
  }

  // ─── Upsert ─────────────────────────────────────────────────
  const { error } = await supabaseAdmin
    .from("site_widget_config")
    .upsert({
      tenant_id: tenantId,
      ...input,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" })

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/site")
  return {}
}
