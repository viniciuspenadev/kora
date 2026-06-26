import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"
import { hasModule } from "@/lib/modules"

/**
 * GET /api/site/config/[slug]
 *
 * Retorna a config pública do widget (cor, perguntas, copy).
 * Sem credenciais sensíveis — slug é público.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // Rate-limit: 30/min/IP — pegado pelo widget no boot, mas tem cache de 60s
  const ip = getClientIp(req)
  const rl = rateLimit(`site:config:${ip}`, 30, 60_000)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  const { slug } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, active")
    .eq("slug", slug)
    .maybeSingle()

  if (!tenant?.active) {
    return cors(NextResponse.json({ error: "tenant not found" }, { status: 404 }))
  }

  const { data: cfg } = await supabaseAdmin
    .from("site_widget_config")
    .select(`
      enabled, mode, chat_suggestions, button_color, button_position, button_label,
      greeting, questions, success_message,
      show_after_seconds, hide_url_patterns,
      off_hours_enabled, off_hours_message,
      logo_url, brand_name, subtitle,
      privacy_policy_url, consent_text, dpo_email
    `)
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  if (!cfg?.enabled) {
    return cors(NextResponse.json({ enabled: false }))
  }

  // Fallback do brand_name: nome do tenant
  let brandName = cfg.brand_name
  if (!brandName) {
    const { data: tenantInfo } = await supabaseAdmin
      .from("tenants")
      .select("name")
      .eq("id", tenant.id)
      .single()
    brandName = tenantInfo?.name ?? null
  }

  // IA na linha de frente? (módulo comprado + switch ligado). O widget usa pra
  // decidir o estado pós-envio: "digitando" (IA responde já) vs "recebido"
  // (atendimento manual — humano responde pelo inbox).
  let aiActive = false
  if (cfg.mode === "chat") {
    const { data: aiCfg } = await supabaseAdmin
      .from("ai_config").select("ai_enabled").eq("tenant_id", tenant.id).maybeSingle()
    if (aiCfg?.ai_enabled) aiActive = await hasModule(tenant.id, "ai_atendente")
  }

  return cors(NextResponse.json({
    enabled:            true,
    mode:               cfg.mode ?? "form",
    ai_active:          aiActive,
    chat_suggestions:   cfg.chat_suggestions ?? [],
    button_color:       cfg.button_color,
    button_position:    cfg.button_position,
    button_label:       cfg.button_label,
    greeting:           cfg.greeting,
    questions:          cfg.questions,
    success_message:    cfg.success_message,
    show_after_seconds: cfg.show_after_seconds,
    hide_url_patterns:  cfg.hide_url_patterns,
    off_hours_enabled:  cfg.off_hours_enabled,
    off_hours_message:  cfg.off_hours_message,
    logo_url:           cfg.logo_url,
    brand_name:         brandName,
    subtitle:           cfg.subtitle,
    // LGPD
    privacy_policy_url: cfg.privacy_policy_url,
    consent_text:       cfg.consent_text,
    dpo_email:          cfg.dpo_email,
  }))
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

function cors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*")
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300")  // 1 min — permite atualizações rápidas do painel
  return res
}
