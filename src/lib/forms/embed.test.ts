import { describe, expect, it } from "vitest"
import { normalizeAllowedDomain, normalizeAllowedDomains, isHostAllowed, frameAncestors, embedHostPage, MAX_ALLOWED_DOMAINS } from "./embed"

// O formulário no site do cliente: só abre nos sites que o dono autorizou (o navegador impõe).
describe("site autorizado: como se guarda", () => {
  it("o que a pessoa cola vira só o domínio (sem protocolo, caminho, porta, www)", () => {
    expect(normalizeAllowedDomain("https://www.BernardoTecnoglass.com.br/envidracamento-de-sacadas/?utm=x#topo")).toBe("bernardotecnoglass.com.br")
    expect(normalizeAllowedDomain("loja.site.com:8443")).toBe("loja.site.com")
    expect(normalizeAllowedDomain("*.site.com")).toBe("site.com")
    expect(normalizeAllowedDomain("site.com.")).toBe("site.com")
  })
  it("o que não é site é recusado", () => {
    for (const bad of ["", "localhost", "site", "http://", "site .com", "<script>.com", "a@b.com", 42, null]) {
      expect(normalizeAllowedDomain(bad)).toBeNull()
    }
  })
  it("lista sem repetir, sem lixo e com teto", () => {
    expect(normalizeAllowedDomains(["site.com", "https://www.site.com", "x", "outro.com.br"])).toEqual(["site.com", "outro.com.br"])
    expect(normalizeAllowedDomains(Array.from({ length: 30 }, (_, i) => `s${i}.com`))).toHaveLength(MAX_ALLOWED_DOMAINS)
    expect(normalizeAllowedDomains("site.com")).toEqual([])
  })
})

describe("site autorizado: como se confere", () => {
  const allowed = ["bernardotecnoglass.com.br"]
  it("o próprio domínio e os subdomínios dele", () => {
    expect(isHostAllowed("bernardotecnoglass.com.br", allowed)).toBe(true)
    expect(isHostAllowed("www.bernardotecnoglass.com.br", allowed)).toBe(true)
    expect(isHostAllowed("lp.bernardotecnoglass.com.br", allowed)).toBe(true)
  })
  it("🔒 parecido não passa", () => {
    expect(isHostAllowed("xbernardotecnoglass.com.br", allowed)).toBe(false)
    expect(isHostAllowed("bernardotecnoglass.com.br.golpe.com", allowed)).toBe(false)
    expect(isHostAllowed("", allowed)).toBe(false)
  })
})

describe("o que o navegador impõe (frame-ancestors)", () => {
  it("só HTTPS, o domínio e os subdomínios", () => {
    expect(frameAncestors(["site.com"])).toBe("https://site.com https://*.site.com")
  })
  it("🔒 sem site autorizado, nenhum site mostra o formulário", () => {
    expect(frameAncestors([])).toBe("'none'")
  })
  it("a máquina local só em desenvolvimento", () => {
    expect(frameAncestors([], { dev: true })).toContain("http://localhost:*")
    expect(frameAncestors(["site.com"])).not.toContain("localhost")
  })
})

describe("a página do site que a moldura aceita", () => {
  const allowed = ["site.com"]
  it("página de site autorizado vira a origem (sem âncora e sem senha no endereço)", () => {
    expect(embedHostPage("https://user:pw@www.site.com/lp?utm_campaign=verao#form", allowed))
      .toEqual({ url: "https://www.site.com/lp?utm_campaign=verao", origin: "https://www.site.com" })
  })
  it("🔒 outro site, HTTP ou lixo = sem página (a moldura não fala com ninguém)", () => {
    expect(embedHostPage("https://golpe.com/lp", allowed)).toBeNull()
    expect(embedHostPage("http://site.com/lp", allowed)).toBeNull()
    expect(embedHostPage("javascript:alert(1)", allowed)).toBeNull()
    expect(embedHostPage(undefined, allowed)).toBeNull()
    expect(embedHostPage("http://localhost:4321/lp", allowed)).toBeNull()
  })
  it("a máquina local só em desenvolvimento", () => {
    expect(embedHostPage("http://localhost:4321/lp", allowed, { dev: true })?.origin).toBe("http://localhost:4321")
  })
})
