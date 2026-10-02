import { NextResponse, after, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp } from "@/lib/rate-limit"
import { verifyTurnstile } from "@/lib/turnstile"
import { hasModule } from "@/lib/modules"
import { checkTenantStatus } from "@/lib/auth/tenant-serviceable"
import { normalizeDefinition } from "@/lib/forms/definition"
import { parseSubmission, parseSource } from "@/lib/forms/submission"
import { SUBMIT_LIMITS } from "@/lib/forms/limits"
import { verifyRenderToken, hashIp } from "@/lib/forms/server"
import { linkSubmissionContact } from "@/lib/forms/contact-link"
import { outreachPhoneKey } from "@/lib/outreach/phone-key"

// ═══════════════════════════════════════════════════════════════
// POST /api/f/<public_id>/submit — a ÚNICA escrita pública dos formulários
// ═══════════════════════════════════════════════════════════════
// Porta aberta na internet, então nasce trancada (docs/forms-design.md §6):
//   S1 mesma origem (o formulário roda no domínio do Kora, no link e dentro do site) ·
//      limite por IP na memória · campo-isca · bilhete da página (tempo mínimo) · antirrobô
//      (Turnstile, conferido aqui) · tetos por formulário/número/aparelho no banco, no mesmo
//      passo da gravação (form_submit).
//   S3 aceite obrigatório, com o texto exato · S4 empresa SEMPRE pelo public_id, nunca pelo
//      navegador · S6 só as chaves e opções da versão publicada, tudo cortado · S9 empresa que
//      deixou de ser cliente não grava (mesma resposta de formulário fora do ar) · S10 não é
//      mensagem: não toca conversa nem janela de 24 h.
// Resposta de robô pego pela isca ou pelo relógio = "ok" sem gravar (não ensina o robô).

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE })
const okSilently = () => NextResponse.json({ ok: true }, { headers: NO_STORE })
const UNAVAILABLE = "Este formulário não está recebendo respostas agora."

/** O pedido saiu de uma página do próprio Kora (link próprio ou moldura dentro do site). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin")
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  if (!/^[a-z0-9]{20}$/.test(publicId)) return fail(404, "Formulário não encontrado.")
  if (!sameOrigin(req)) return fail(403, "Envio não autorizado.")

  const ip = getClientIp(req)
  if (!rateLimit(`forms:submit:${ip}`, SUBMIT_LIMITS.ipBurst, SUBMIT_LIMITS.ipBurstWindowMs).ok) {
    return fail(429, "Muitos envios em pouco tempo. Tente de novo em alguns minutos.")
  }
  if (Number(req.headers.get("content-length") ?? 0) > SUBMIT_LIMITS.maxBodyBytes) return fail(413, "Envio grande demais.")
  const text = await req.text()
  if (text.length > SUBMIT_LIMITS.maxBodyBytes) return fail(413, "Envio grande demais.")
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "Envio inválido.")
    body = parsed as Record<string, unknown>
  } catch { return fail(400, "Envio inválido.") }

  // Campo-isca (escondido de gente; robô preenche) e relógio da página.
  if (typeof body.website === "string" && body.website.trim()) return okSilently()
  const ticket = verifyRenderToken(body.renderToken, publicId)
  if (!ticket.ok) {
    if (ticket.reason === "too_fast") return okSilently()
    return fail(400, "Esta página ficou aberta por muito tempo. Recarregue e envie de novo.")
  }

  // Formulário e empresa: tudo pelo public_id.
  const { data: formRow } = await supabaseAdmin.from("forms")
    .select("id, tenant_id, status, archived_at, published_version_id")
    .eq("public_id", publicId).maybeSingle()
  const form = formRow as { id: string; tenant_id: string; status: string; archived_at: string | null; published_version_id: string | null } | null
  if (!form || form.archived_at || form.status !== "published" || !form.published_version_id) return fail(410, UNAVAILABLE)
  const status = await checkTenantStatus(form.tenant_id)
  if (!status.degraded && !status.canAccess) return fail(410, UNAVAILABLE)
  if (!(await hasModule(form.tenant_id, "forms"))) return fail(410, UNAVAILABLE)

  const [{ data: ver }, { data: tenant }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from("form_versions").select("id, definition")
      .eq("tenant_id", form.tenant_id).eq("form_id", form.id).eq("id", form.published_version_id).maybeSingle(),
    supabaseAdmin.from("tenants").select("name").eq("id", form.tenant_id).maybeSingle(),
    supabaseAdmin.from("tenant_config").select("default_country").eq("tenant_id", form.tenant_id).maybeSingle(),
  ])
  if (!ver) return fail(410, UNAVAILABLE)
  const version = ver as { id: string; definition: unknown }
  const def = normalizeDefinition(version.definition)
  const businessName = ((tenant as { name?: string } | null)?.name ?? "").trim()

  const parsed = parseSubmission(def, body, { businessName, defaultCountry: (cfg as { default_country?: string } | null)?.default_country ?? "BR" })
  if (!parsed.ok) return fail(422, parsed.error)
  // Antirrobô DEPOIS da conferência das respostas: o bilhete do Cloudflare vale uma vez só, e
  // um erro de digitação não pode queimá-lo.
  if (!(await verifyTurnstile(typeof body.turnstileToken === "string" ? body.turnstileToken : null, ip !== "unknown" ? ip : undefined))) {
    return fail(400, "Não conseguimos confirmar que você não é um robô. Recarregue a página e tente de novo.")
  }
  const s = parsed.value
  const at = new Date().toISOString()
  const ipHash = hashIp(ip)

  const { data, error } = await supabaseAdmin.rpc("form_submit", {
    p_tenant_id:       form.tenant_id,
    p_form_id:         form.id,
    p_version_id:      version.id,
    p_phone_e164:      s.phoneE164,
    p_phone_key:       outreachPhoneKey(s.phoneE164),
    p_contact_name:    s.name,
    p_answers:         s.answers,
    p_consent:         {
      accepted: true, text: s.consentText, at, version_id: version.id, ip_hash: ipHash,
      marketing: s.marketing.shown ? { checked: s.marketing.checked, text: s.marketing.text } : null,
    },
    p_source:          parseSource(body.source, req.headers.get("user-agent")),
    p_ip_hash:         ipHash,
    p_form_daily_cap:  SUBMIT_LIMITS.formDaily,
    p_phone_daily_cap: SUBMIT_LIMITS.phoneDaily,
    p_ip_hourly_cap:   SUBMIT_LIMITS.ipHourly,
  })
  if (error) {
    console.error("[forms submit] gravação falhou:", error.code, error.message)
    return fail(500, "Não foi possível enviar agora. Tente de novo em instantes.")
  }
  const r = data as { ok: boolean; id?: string; reason?: string }
  if (!r.ok) {
    switch (r.reason) {
      case "version_changed": return fail(409, "Este formulário acabou de ser atualizado. Recarregue a página e envie de novo.")
      case "phone_repeat":    return fail(429, "Já recebemos seus pedidos de hoje com este número. Em breve entramos em contato.")
      case "form_daily_cap":  return fail(429, "Este formulário recebeu muitos pedidos hoje. Tente de novo mais tarde.")
      case "ip_cap":          return fail(429, "Muitos envios deste aparelho. Tente de novo mais tarde.")
      default:                return fail(410, UNAVAILABLE)
    }
  }

  // A pessoa não espera a ficha: a resposta já está gravada. Ligar à ficha depois da resposta.
  const submissionId = r.id!
  after(async () => {
    try {
      await linkSubmissionContact({
        tenantId: form.tenant_id, submissionId, def, answers: s.answers,
        name: s.name, phoneE164: s.phoneE164, marketingChecked: s.marketing.checked, at,
      })
    } catch (e) {
      console.error("[forms submit] resposta gravada sem ficha:", submissionId, (e as Error).message)
    }
  })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
