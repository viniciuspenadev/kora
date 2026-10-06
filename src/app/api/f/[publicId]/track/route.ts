import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit, getClientIp } from "@/lib/rate-limit"
import { TRACK_LIMITS } from "@/lib/forms/limits"
import { verifyRenderToken } from "@/lib/forms/server"
import { isPublicId } from "@/lib/forms/identity"
import { isTrackStep } from "@/lib/forms/results"

/**
 * POST /api/f/<public_id>/track — contadores dos Resultados (docs/forms-design.md §13).
 *
 * A página do formulário marca: viu · começou · chegou a cada passo · saiu sem enviar. Nada
 * aqui identifica a pessoa: o corpo é só { passo, tipo, bilhete da página }, e a soma é por dia.
 * Sempre responde 204 (até o que não conta): não ensina a ninguém o que passa ou não.
 * A barreira de verdade é do banco (`form_track`): só formulário publicado, só passo da versão
 * publicada, com teto por passo e dia.
 */
export const dynamic = "force-dynamic"

const done = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })

/** Só a página do próprio Kora marca (link próprio ou a moldura dentro do site). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin")
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  if (!isPublicId(publicId) || !sameOrigin(req)) return done()
  if (!rateLimit(`forms:track:${getClientIp(req)}`, TRACK_LIMITS.ipBurst, TRACK_LIMITS.ipBurstWindowMs).ok) return done()
  const text = await req.text()
  if (text.length > TRACK_LIMITS.maxBodyBytes) return done()
  let body: { step?: unknown; kind?: unknown; t?: unknown }
  try { body = JSON.parse(text) } catch { return done() }
  if (!body || typeof body !== "object") return done()
  const { step, kind } = body
  if (!isTrackStep(step) || (kind !== "reached" && kind !== "exit")) return done()
  // Bilhete da página: prova que a marca veio de uma página que o Kora entregou. "Rápido demais"
  // vale aqui (ver o formulário acontece no primeiro segundo); só o inválido/vencido é recusado.
  const ticket = verifyRenderToken(body.t, publicId)
  if (!ticket.ok && ticket.reason !== "too_fast") return done()

  const { error } = await supabaseAdmin.rpc("form_track", {
    p_public_id: publicId, p_step: step, p_kind: kind, p_daily_cap: TRACK_LIMITS.dailyPerStep,
  })
  if (error) console.error(JSON.stringify({ src: "forms-track", code: error.code }))
  return done()
}
