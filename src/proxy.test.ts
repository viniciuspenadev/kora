import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// /embed/<id>: o navegador só deixa o formulário abrir nos sites que o dono autorizou.
const ID = "abcdefghij0123456789"
const fetchMock = vi.fn()

let proxy: (req: NextRequest) => Promise<Response>
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.example"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-do-servidor"
  process.env.BLUE_VOICE_ENABLED = "true"
  process.env.BLUE_VOICE_URL = "https://voice.example"
  process.env.EVOLUTION_API_URL = "https://evolution.example"
  process.env.VOICE_EVOLUTION_ALLOWED_ORIGINS = "https://second.example,http://invalid.example,https://user:pass@secret.example"
  vi.stubGlobal("fetch", fetchMock)
  ;({ proxy } = await import("./proxy"))
})
afterEach(() => fetchMock.mockReset())

const csp = (r: Response) => r.headers.get("content-security-policy") ?? ""
const ancestors = (r: Response) => csp(r).match(/frame-ancestors ([^;]*)/)?.[1] ?? ""
const answer = (rows: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, json: async () => rows })

it("permite áudio na navegação do painel flutuante, mantendo o destino restrito", async () => {
  for (const path of ["/inbox", "/contatos", "/configuracoes/equipe", "/integracoes/whatsapp-oficial"]) {
    const r = await proxy(new NextRequest(`http://kora.test${path}`))
    const connections = csp(r).match(/connect-src ([^;]*)/)?.[1] ?? ""
    expect(connections).toContain("wss://voice.example")
    expect(connections).toContain("wss://evolution.example")
    expect(connections).toContain("wss://second.example")
    expect(connections).not.toContain("invalid.example")
    expect(connections).not.toContain("secret.example")
    expect(connections.split(/\s+/)).not.toContain("wss:")
    expect(ancestors(r)).toBe("'self'")
  }
  expect(csp(await proxy(new NextRequest("http://kora.test/auth/signin")))).not.toContain("voice.example")
})

describe("formulário no site do cliente", () => {
  it("abre só nos sites autorizados, sem X-Frame-Options e fora do Google", async () => {
    answer([{ allowed_domains: ["bernardotecnoglass.com.br"] }])
    const r = await proxy(new NextRequest(`http://kora.test/embed/${ID}?page=x`))
    expect(ancestors(r)).toContain("https://bernardotecnoglass.com.br https://*.bernardotecnoglass.com.br")
    expect(r.headers.get("x-frame-options")).toBeNull()
    expect(r.headers.get("x-robots-tag")).toContain("noindex")
    expect(csp(r)).toContain("challenges.cloudflare.com")   // antirrobô do envio
    // Lido pelo código público, com a chave do servidor (nunca a do navegador).
    expect(String(fetchMock.mock.calls[0][0])).toContain(`public_id=eq.${ID}`)
  })
  it("a lista fica guardada um pouco (não consulta o banco a cada visita)", async () => {
    const r = await proxy(new NextRequest(`http://kora.test/embed/${ID}`))
    expect(ancestors(r)).toContain("bernardotecnoglass.com.br")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("🔒 sem site autorizado, banco fora do ar ou código torto = nenhum site", async () => {
    answer([{ allowed_domains: [] }])
    expect(ancestors(await proxy(new NextRequest("http://kora.test/embed/zzzzzzzzzzzzzzzzzzz1")))).not.toContain("https://")
    fetchMock.mockRejectedValue(new Error("fora do ar"))
    expect(ancestors(await proxy(new NextRequest("http://kora.test/embed/zzzzzzzzzzzzzzzzzzz2")))).not.toContain("https://")
    expect(ancestors(await proxy(new NextRequest("http://kora.test/embed/../../admin")))).not.toContain("https://")
    expect(fetchMock).toHaveBeenCalledTimes(2)   // o código torto nem consulta
  })
  it("o resto do app continua sem abrir em site de fora", async () => {
    const r = await proxy(new NextRequest("http://kora.test/inbox"))
    expect(ancestors(r)).toBe("'self'")
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
