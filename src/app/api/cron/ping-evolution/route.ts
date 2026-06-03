import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronSecret } from "@/lib/cron-auth"

/**
 * GET /api/cron/ping-evolution
 *
 * Health check ativo a cada 5 min:
 *   1. Por servidor único: pinga /instance/fetchInstances → mede latência
 *   2. Por instância: GET /instance/connectionState/{name} → state real
 *   3. Por instância: GET /webhook/find/{name} → confirma URL coerente
 *
 * Salva tudo em colunas dedicadas (last_connection_state, webhook_url_matches,
 * last_connection_check_at). NÃO insere nada em chat_messages — silencioso.
 *
 * Autenticação: Bearer CRON_SECRET (Vercel envia automaticamente).
 */

const TIMEOUT_MS = 8_000

interface Instance {
  id:            string
  evolution_url: string
  evolution_key: string
  instance_name: string
  webhook_url:   string | null
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  // ── 1. Servidores únicos (ping leve) ────────────────────────
  const { data: servers } = await supabaseAdmin.from("evolution_servers").select("url")

  type ServerResult = { url: string; status: string; latencyMs: number | null }
  const serverResults: ServerResult[] = []

  for (const s of (servers ?? []) as { url: string }[]) {
    const { data: inst } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("evolution_key").eq("evolution_url", s.url).limit(1).maybeSingle()
    if (!inst?.evolution_key) {
      serverResults.push({ url: s.url, status: "skipped", latencyMs: null })
      continue
    }

    const start = Date.now()
    let pingStatus: "ok" | "error" | "timeout" = "error"
    let latencyMs: number | null = null
    let errMsg: string | null = null

    try {
      const resp = await fetchWithTimeout(`${s.url}/instance/fetchInstances`, {
        method: "GET", headers: { apikey: inst.evolution_key },
      })
      latencyMs = Date.now() - start
      pingStatus = resp.ok ? "ok" : "error"
      if (!resp.ok) errMsg = `HTTP ${resp.status}`
    } catch (e) {
      latencyMs = Date.now() - start
      const err = e as Error
      pingStatus = err.name === "AbortError" ? "timeout" : "error"
      errMsg = err.message
    }

    await supabaseAdmin.from("evolution_servers").update({
      last_ping_at:         new Date().toISOString(),
      last_ping_latency_ms: latencyMs,
      last_ping_status:     pingStatus,
      last_error:           errMsg,
      updated_at:           new Date().toISOString(),
    }).eq("url", s.url)

    serverResults.push({ url: s.url, status: pingStatus, latencyMs })
  }

  // ── 2. Por instância (state + webhook config) ───────────────
  const { data: instances } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, evolution_url, evolution_key, instance_name, webhook_url")
    .not("evolution_url", "is", null)
    .not("instance_name", "is", null)

  type InstanceResult = { id: string; state: string; urlMatches: boolean | null }
  const instResults: InstanceResult[] = []

  for (const i of (instances ?? []) as Instance[]) {
    // 2a. connectionState
    let connState: string = "error"
    try {
      const resp = await fetchWithTimeout(`${i.evolution_url}/instance/connectionState/${i.instance_name}`, {
        method: "GET", headers: { apikey: i.evolution_key },
      })
      if (resp.ok) {
        const data = await resp.json() as { instance?: { state?: string } }
        connState = data.instance?.state ?? "unknown"
      }
    } catch {
      connState = "error"
    }

    // 2b. webhook config (compara URL retornada com a que temos no DB)
    let urlMatches: boolean | null = null
    try {
      const resp = await fetchWithTimeout(`${i.evolution_url}/webhook/find/${i.instance_name}`, {
        method: "GET", headers: { apikey: i.evolution_key },
      })
      if (resp.ok) {
        const data = await resp.json() as { url?: string; enabled?: boolean }
        urlMatches = data.enabled === true && data.url === i.webhook_url
      } else if (resp.status === 404) {
        urlMatches = false  // webhook não configurado
      }
    } catch {
      urlMatches = null  // não conseguimos verificar
    }

    await supabaseAdmin.from("whatsapp_instances").update({
      last_connection_check_at: new Date().toISOString(),
      last_connection_state:    connState,
      webhook_url_matches:      urlMatches,
    }).eq("id", i.id)

    instResults.push({ id: i.id, state: connState, urlMatches })
  }

  return NextResponse.json({
    ok:        true,
    servers:   serverResults,
    instances: instResults,
  })
}
