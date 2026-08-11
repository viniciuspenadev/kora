import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"
import { decryptSecret } from "@/lib/crypto/secrets"

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

/** `5511999998888@s.whatsapp.net` → `+55 11 99999-8888`. Devolve null se não parecer BR. */
function jidToPhone(jid: string | null | undefined): string | null {
  const d = (jid ?? "").split("@")[0].replace(/\D/g, "")
  if (d.length < 12 || d.length > 13) return null          // 55 + DDD + 8/9 dígitos
  const rest = d.slice(4)
  if (rest.length < 8) return null
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
}

/**
 * Lê o número CONECTADO de cada instância na resposta de `/instance/fetchInstances` e
 * grava em `whatsapp_instances.phone_number` quando ainda está vazio.
 *
 * ⚠️ Só preenche o que está NULO — nunca sobrescreve. Número gravado no provisionamento
 *    (canal oficial) é fonte mais confiável que o JID reportado pelo servidor.
 *
 * A Evolution mudou o formato entre versões (v1 aninhava tudo em `instance`, v2 é plano),
 * então os dois são aceitos: quebrar a captura num upgrade do servidor deixaria a tela
 * mostrando apelido de novo, e ninguém ligaria uma coisa à outra.
 */
async function captureOwnerNumbers(resp: Response, serverUrl: string): Promise<void> {
  try {
    const raw = await resp.clone().json() as unknown
    const arr = Array.isArray(raw) ? raw : []
    for (const it of arr) {
      const o     = (it ?? {}) as Record<string, unknown>
      const nest  = (o.instance ?? {}) as Record<string, unknown>
      const name  = (nest.instanceName ?? o.name ?? nest.name ?? o.instanceName) as string | undefined
      const jid   = (nest.owner ?? o.ownerJid ?? nest.ownerJid ?? o.owner) as string | undefined
      const phone = jidToPhone(jid)
      if (!name || !phone) continue
      // 🔴 Amarrado ao SERVIDOR que respondeu (`evolution_url`), não só ao nome. Nome de
      //    instância é único DENTRO de um servidor Evolution — com dois servidores, um
      //    nome repetido gravaria o número de um tenant na linha de outro. Escopo
      //    estreito é barato aqui e fecha um caminho cross-tenant por acidente.
      const { error } = await supabaseAdmin.from("whatsapp_instances")
        .update({ phone_number: phone, updated_at: new Date().toISOString() })
        .eq("instance_name", name).eq("evolution_url", serverUrl).is("phone_number", null)
      if (error) console.error("[ping-evolution] phone:", error.code, error.message)
    }
  } catch (e) {
    // Best-effort: o ping NÃO pode falhar porque o formato da resposta mudou.
    console.error("[ping-evolution] captura de número:", (e as Error).message)
  }
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

// ⚠️ Esta rota era a única das seis sem `dynamic`/`maxDuration`. `dynamic` entra;
//    `maxDuration` NÃO — é diretiva da Vercel e inerte no runtime standalone.
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const saida = await executarJob({ job: "ping-evolution" }, varrerEvolution)
  if (saida.pulado) return NextResponse.json({ ok: true, pulado: "já em execução" })
  return NextResponse.json({ ok: true, ...(saida.resultado?.meta ?? {}) })
}

/**
 * 🔑 O CORPO SAIU DO HANDLER pra caber no invólucro sem reindentar 80 linhas — e de quebra
 *    a rota virou o que ela deveria ser: portaria (autentica, registra, responde). Quem
 *    faz o trabalho é uma função com nome.
 */
async function varrerEvolution() {
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
        method: "GET", headers: { apikey: decryptSecret(inst.evolution_key) },
      })
      latencyMs = Date.now() - start
      pingStatus = resp.ok ? "ok" : "error"
      if (!resp.ok) errMsg = `HTTP ${resp.status}`
      // 🔴 Aproveita a resposta pra CAPTURAR O NÚMERO conectado. Instância pareada por QR
      //    nasce sem `phone_number` (quem sabe o número é o WhatsApp, no momento do
      //    pareamento) — então a tela mostrava o APELIDO da instância no lugar do número,
      //    que é o que o dono usa pra reconhecer a linha.
      //    Aqui e não na página: chamar a Evolution no render deixaria Integrações lenta e
      //    quebraria a tela quando o servidor dela oscilasse. O cron já faz esta chamada;
      //    o número vem de carona e se auto-corrige a cada ciclo.
      if (resp.ok) await captureOwnerNumbers(resp, s.url)
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
        method: "GET", headers: { apikey: decryptSecret(i.evolution_key) },
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
        method: "GET", headers: { apikey: decryptSecret(i.evolution_key) },
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

  return {
    // "Processado" aqui é telemetria de saúde colhida, não dinheiro movido.
    processed: serverResults.length + instResults.length,
    failed:    serverResults.filter((s) => s.status !== "ok").length,
    meta:      { servers: serverResults, instances: instResults },
  }
}
