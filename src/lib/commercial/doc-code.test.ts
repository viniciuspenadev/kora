import { describe, expect, it, vi } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Número do documento com o prefixo GRAVADO (migration 20260929000100): os emitidos seguem
// COT-000X, os novos saem ORC-000N na mesma sequência (dono, 29/09/2026).
vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: {} }))
vi.mock("@/lib/crm/deals", () => ({ recordDealEvent: async () => {} }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async () => {}, toCents: (v: number) => Math.round(v * 100) }))
vi.mock("@/lib/pdf/quote-pdf", () => ({ QuotePdf: () => null }))
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: async () => Buffer.from("") }))
const { docCode, NEW_PREFIX } = await import("./documents")

describe("document code", () => {
  it("uses the prefix stored in the document — an issued COT never turns ORC", () => {
    expect(docCode("quote", 3, 2026, "COT")).toBe("COT-0003/2026")
    expect(docCode("quote", 12, 2026, "ORC")).toBe("ORC-0012/2026")
  })
  it("new quotes are numbered with the name's prefix; a row without one falls back to the historical", () => {
    expect(NEW_PREFIX.quote).toBe("ORC")
    expect(docCode("quote", 1, 2026, null)).toBe("COT-0001/2026")
    expect(docCode("order", 7, 2026, undefined)).toBe("PED-0007/2026")
  })
})

// Guarda da CLASSE: o erro que queremos impedir é silencioso — uma leitura que monta o código
// sem selecionar `code_prefix` mostraria um ORC novo como COT. Todo arquivo que chama
// docCode() precisa citar `code_prefix` (select + repasse). Derivado do código, não de lista.
describe("every code reader selects the stored prefix", () => {
  it("files calling docCode() also read code_prefix", () => {
    const root = join(process.cwd(), "src")
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue
        const src = readFileSync(p, "utf8")
        if (/\bdocCode\(/.test(src) && !src.includes("export function docCode") && !src.includes("code_prefix")) offenders.push(p.slice(root.length + 1))
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
