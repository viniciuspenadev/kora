// ═══════════════════════════════════════════════════════════════
// Capacidade: requisição HTTP (integração com sistema externo)
// ═══════════════════════════════════════════════════════════════
// O destravador de versatilidade: o tenant pluga a API dele (status de
// pedido, estoque, CRM…) sem a gente codar nada. A resposta vira uma
// VARIÁVEL do fluxo (saveAs), que um nó Mensagem ({{var}}) ou Agente IA
// usa em seguida. Guardas anti-SSRF em http-guard.ts. minPlanLevel 4.
import { defineCapability } from "./registry"
import { safeFetch } from "../http-guard"

export const HTTP_REQUEST = "http_request"

interface HttpArgs {
  url:     string
  method:  string
  headers: Record<string, string>
  body:    string | null
  saveAs:  string
}

export const httpRequestCapability = defineCapability<HttpArgs>({
  id:           HTTP_REQUEST,
  name:         "Requisição HTTP",
  category:     "external",
  minPlanLevel: 4,
  isNode:       true,
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    let headers: Record<string, string> = {}
    if (p.headers && typeof p.headers === "object") headers = p.headers as Record<string, string>
    else if (typeof p.headers === "string") { try { headers = JSON.parse(p.headers) } catch { headers = {} } }
    return {
      url:     typeof p.url === "string" ? p.url : "",
      method:  typeof p.method === "string" ? p.method.toUpperCase() : "GET",
      headers,
      body:    typeof p.body === "string" && p.body.trim() ? p.body : null,
      saveAs:  typeof p.saveAs === "string" && p.saveAs.trim() ? p.saveAs.trim() : "http_response",
    }
  },
  execute: async (_ctx, args) => {
    if (!args.url) return { ok: false, error: "http_request: url vazia" }
    try {
      const r = await safeFetch(args.url, { method: args.method, headers: args.headers, body: args.body ?? undefined })
      let body: unknown = r.body
      try { body = JSON.parse(r.body) } catch { /* texto puro */ }
      return { ok: true, data: { status: r.status, body } }
    } catch (e) {
      return { ok: false, error: `http_request: ${e instanceof Error ? e.message : String(e)}` }
    }
  },
})
