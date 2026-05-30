import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"

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
      enabled, mode, button_color, button_position, button_label,
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

  return cors(NextResponse.json({
    enabled:            true,
    mode:               cfg.mode ?? "form",
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
  res.headers.set("Cache-Control", "public, max-age=300")  // 5 min — config muda raramente
  return res
}
