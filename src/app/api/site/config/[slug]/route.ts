import { NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"
import { isOriginAllowed } from "@/lib/site/domain-guard"
import { tenantAiActive } from "@/lib/llm/active"
import { hasReceptiveFlowForChannel } from "@/lib/ai-v2/flow/triggers"

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
      privacy_policy_url, consent_text, dpo_email,
      allowed_domains
    `)
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  if (!cfg?.enabled) {
    return cors(NextResponse.json({ enabled: false }))
  }

  // Origin allowlist: domínio não autorizado → widget não embute (boot para aqui).
  if (!isOriginAllowed(req, cfg.allowed_domains as string[] | null)) {
    return cors(NextResponse.json({ enabled: false }))
  }

  // 🔴 SINAL DE VIDA — DEPOIS da allowlist, nunca antes. Esta rota é PÚBLICA e sem
  //    credencial: carimbar antes deixaria qualquer um que descobrisse o slug marcar o
  //    widget de um cliente como "conectado" e escolher o domínio exibido na tela dele.
  //    Aqui, só domínio autorizado carimba — o mesmo portão que já decide se o widget
  //    embute decide se ele conta como vivo.
  //    `after()` não atrasa a resposta; o corte de 15min evita uma escrita por pageview.
  after(async () => {
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString()
    // Origem só do header, limitada — é dado de terceiro entrando no nosso banco.
    const origin = (req.headers.get("origin") ?? "").slice(0, 255) || null
    const { error } = await supabaseAdmin.from("site_widget_config")
      .update({ last_seen_at: new Date().toISOString(), last_seen_origin: origin })
      .eq("tenant_id", tenant.id)
      .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff}`)
    // 42703 = migration do heartbeat ainda não aplicada; silencioso de propósito, senão
    // vira ruído a cada pageview de todo cliente.
    if (error && error.code !== "42703") console.error("[site-config] last_seen:", error.code, error.message)
  })

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

  // IA na linha de frente? O widget usa pra decidir o estado pós-envio: "digitando"
  // (bot responde já) vs "recebido" (humano responde pelo inbox). Desde "IA roda SÓ
  // via fluxo" (2026-07-21), quem responde no site é um FLUXO do Studio cobrindo o
  // canal `site` — é isso que se checa. (O check antigo lia ai_config/ai_atendente,
  // o motor v1 removido: prometia atendente com bot ativo, e vice-versa.)
  let aiActive = false
  if (cfg.mode === "chat" && (await tenantAiActive(tenant.id))) {
    aiActive = await hasReceptiveFlowForChannel(tenant.id, "site")
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
