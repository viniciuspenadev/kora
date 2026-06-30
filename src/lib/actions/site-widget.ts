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
  allowed_domains:     string[]        // origin allowlist do embed; vazio = libera todos
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
      show_after_seconds, hide_url_patterns, allowed_domains,
      off_hours_enabled, off_hours_message,
      logo_url, brand_name, subtitle,
      privacy_policy_url, consent_text, dpo_email
    `)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  return data as WidgetConfig | null
}

/**
 * Domínios REAIS observados no tráfego do widget (site_visits) — pra UI sugerir
 * "Autorizar X" no fail-closed. Exclui localhost/127.0.0.1 e hosts sem TLD válido.
 */
export async function getDetectedSiteDomains(): Promise<string[]> {
  const session = await requireAdmin()
  const { data } = await supabaseAdmin
    .from("site_visits")
    .select("page_url")
    .eq("tenant_id", session.user.tenantId)
    .not("page_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000)

  const counts = new Map<string, number>()
  for (const r of (data ?? []) as { page_url: string }[]) {
    let host: string | null = null
    try { host = new URL(r.page_url).hostname.toLowerCase().replace(/^www\./, "") } catch { /* ignora */ }
    if (!host || host === "localhost" || host === "127.0.0.1") continue
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 6)
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

// ─── Upload da logo (bucket público widget-assets) ──────────────
const LOGO_BUCKET    = "widget-assets"
const MAX_LOGO_BYTES = 512 * 1024

/**
 * Detecta o tipo REAL pelos magic bytes — não confia na extensão nem no
 * Content-Type que o cliente manda (ambos forjáveis). SVG fora de propósito.
 */
function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" }   // PNG
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)                   return { mime: "image/jpeg", ext: "jpg" }  // JPEG
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46  // RIFF
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)             return { mime: "image/webp", ext: "webp" } // WEBP
  return null
}

export async function uploadWidgetLogo(formData: FormData): Promise<{ url?: string; error?: string }> {
  const session  = await requireAdmin()
  const tenantId = session.user.tenantId

  const file = formData.get("file")
  if (!(file instanceof File))    return { error: "Arquivo ausente." }
  if (file.size === 0)            return { error: "Arquivo vazio." }
  if (file.size > MAX_LOGO_BYTES) return { error: "Imagem muito grande (máx 512 KB)." }

  const buf   = new Uint8Array(await file.arrayBuffer())
  const sniff = sniffImage(buf)
  if (!sniff) return { error: "Formato inválido. Use PNG, JPG ou WebP." }

  const path = `${tenantId}/logo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${sniff.ext}`
  const { error: upErr } = await supabaseAdmin.storage
    .from(LOGO_BUCKET)
    .upload(path, buf, { contentType: sniff.mime, upsert: false })
  if (upErr) return { error: "Falha no upload. Tente novamente." }

  const { data } = supabaseAdmin.storage.from(LOGO_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl }
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

  // 6a2. allowed_domains: normaliza pra host puro (sem protocolo/porta/path),
  //      valida formato de domínio, max 20 entradas. Vazio = libera todos.
  if (Array.isArray(input.allowed_domains)) {
    input.allowed_domains = input.allowed_domains
      .map((d) =>
        typeof d === "string"
          ? d.trim().toLowerCase()
              .replace(/^https?:\/\//, "")  // tira protocolo
              .replace(/\/.*$/, "")          // tira path
              .replace(/:\d+$/, "")          // tira porta
              .replace(/^\*\./, "")          // wildcard vira domínio base
          : ""
      )
      .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
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
