import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { isTenantServiceable } from "@/lib/auth/tenant-serviceable"
import { rateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit"

/**
 * POST /api/site/visit
 *
 * Endpoint público chamado pelo widget JS a cada pageview do visitante.
 * Sem auth — token = tenant slug (público) + valida que widget está enabled.
 *
 * Body: { slug, visitor_id, url, title?, referrer?, utm? }
 */
export async function POST(req: NextRequest) {
  // Rate-limit: 60 pageviews/min/IP (visit é frequente, ainda dá folga)
  const ip = getClientIp(req)
  const rl = rateLimit(`site:visit:${ip}`, 60, 60_000)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  // CORS preflight handled below
  try {
    const body = await req.json() as {
      slug?:        string
      visitor_id?:  string
      url?:         string
      title?:       string
      referrer?:    string
      utm_source?:  string
      utm_medium?:  string
      utm_campaign?: string
      utm_content?: string
      utm_term?:    string
    }

    if (!body.slug || !body.visitor_id || !body.url) {
      return cors(NextResponse.json({ error: "missing fields" }, { status: 400 }))
    }

    // Resolve tenant by slug
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id, active")
      .eq("slug", body.slug)
      .maybeSingle()

    if (!tenant || !tenant.active) {
      return cors(NextResponse.json({ error: "tenant not found" }, { status: 404 }))
    }

    // 🔒 STATUS DO CLIENTE (docs/entitlements-design.md §3 · security.md §0.1).
    // ⚠️ Este é o mais fraco dos três de propósito: /visit não gasta nada (uma linha de
    //    analytics). Está aqui por COERÊNCIA — conta suspensa não coleta — e devolve o
    //    mesmo formato gracioso do widget desligado, não erro: o JS do cliente já sabe
    //    lidar com `ok: false` e a página dele não pode quebrar por causa da fatura dele.
    // 🔴 `reason` IDÊNTICO ao do widget desligado: um valor distinto ("inactive") tornava
    //    esta rota pública um oráculo de quais clientes estão suspensos/inadimplentes —
    //    os slugs são públicos (estão no `<script src>` de cada site cliente).
    if (!(await isTenantServiceable(tenant.id))) {
      return cors(NextResponse.json({ ok: false, reason: "disabled" }))
    }

    // Widget está ligado?
    const { data: cfg } = await supabaseAdmin
      .from("site_widget_config")
      .select("enabled")
      .eq("tenant_id", tenant.id)
      .maybeSingle()

    if (!cfg?.enabled) {
      return cors(NextResponse.json({ ok: false, reason: "disabled" }))
    }

    // NÃO gateamos /visit por origem de propósito: é analytics inofensivo
    // (rate-limited) e alimenta a descoberta de domínios pro fail-closed —
    // um tenant sem domínio ainda registra tráfego pra gente sugerir o host.

    await supabaseAdmin.from("site_visits").insert({
      tenant_id:    tenant.id,
      visitor_id:   body.visitor_id.slice(0, 64),
      page_url:     body.url.slice(0, 2000),
      page_title:   body.title?.slice(0, 200) ?? null,
      referrer:     body.referrer?.slice(0, 2000) ?? null,
      utm_source:   body.utm_source?.slice(0, 100) ?? null,
      utm_medium:   body.utm_medium?.slice(0, 100) ?? null,
      utm_campaign: body.utm_campaign?.slice(0, 100) ?? null,
      utm_content:  body.utm_content?.slice(0, 100) ?? null,
      utm_term:     body.utm_term?.slice(0, 100) ?? null,
      user_agent:   req.headers.get("user-agent")?.slice(0, 500) ?? null,
    })

    return cors(NextResponse.json({ ok: true }))
  } catch (err) {
    console.error("[/api/site/visit]", err)
    return cors(NextResponse.json({ error: "internal" }, { status: 500 }))
  }
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }))
}

function cors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*")
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.headers.set("Access-Control-Allow-Headers", "Content-Type")
  res.headers.set("Access-Control-Max-Age", "86400")
  return res
}
