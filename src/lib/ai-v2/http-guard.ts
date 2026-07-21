// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — guarda anti-SSRF + fetch seguro (nó HTTP)
// ═══════════════════════════════════════════════════════════════
// O nó HTTP deixa o tenant configurar uma URL que o SERVIDOR busca →
// risco de SSRF (apontar pra rede interna / metadata cloud). Guardas:
// só https · bloqueia IP privado/reservado/loopback/link-local · sem
// seguir redirect (anti-rebind) · timeout · cap de tamanho.
// Risco residual conhecido: DNS-rebinding (proteção total = pinar IP) —
// aceitável no v1; documentado.

import "server-only"
import { lookup } from "node:dns/promises"
import net from "node:net"

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"])

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true            // link-local + metadata cloud
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true  // CGNAT
  if (a >= 224) return true                           // multicast/reservado
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase()
  if (low === "::1" || low === "::") return true
  if (low.startsWith("fc") || low.startsWith("fd")) return true  // ULA
  if (low.startsWith("fe80")) return true                        // link-local
  if (low.startsWith("::ffff:")) return isPrivateIPv4(low.split(":").pop() ?? "")
  return false
}

function ipIsPrivate(ip: string): boolean {
  return net.isIPv6(ip) ? isPrivateIPv6(ip) : isPrivateIPv4(ip)
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error("URL inválida") }
  if (url.protocol !== "https:") throw new Error("Apenas https é permitido")

  const host = url.hostname.toLowerCase()
  if (BLOCKED_HOSTS.has(host)) throw new Error("Host bloqueado")

  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error("IP interno bloqueado (SSRF)")
    return url
  }

  let addrs: { address: string; family: number }[]
  try { addrs = await lookup(host, { all: true }) } catch { throw new Error("DNS não resolveu") }
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("Endereço interno bloqueado (SSRF)")
  }
  return url
}

export interface SafeFetchOpts {
  method?:    string
  headers?:   Record<string, string>
  body?:      string
  timeoutMs?: number
  maxBytes?:  number
}

export async function safeFetch(raw: string, opts: SafeFetchOpts = {}): Promise<{ status: number; body: string }> {
  const url = await assertSafeUrl(raw)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000)
  const max = opts.maxBytes ?? 100_000
  try {
    const res = await fetch(url, {
      method:   opts.method ?? "GET",
      headers:  opts.headers,
      body:     opts.body,
      redirect: "manual",   // não seguir redirect (evita rebind pra interno)
      signal:   ctrl.signal,
    })
    const reader = res.body?.getReader()
    const chunks: Buffer[] = []
    let received = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        chunks.push(Buffer.from(value))
        if (received > max) { ctrl.abort(); break }
      }
    }
    return { status: res.status, body: Buffer.concat(chunks).toString("utf8").slice(0, max) }
  } finally {
    clearTimeout(timer)
  }
}
