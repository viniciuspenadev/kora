// ═══════════════════════════════════════════════════════════════
// A ficha de Persona — e o que acontece quando ela NÃO existe
// ═══════════════════════════════════════════════════════════════
//
// 🔴 ESTE É O TESTE DO DEFEITO DE 2026-08-17. Ficha ausente era tratada como "Studio
//    desligado" no DESPERTAR, e isso matava todo fluxo com nó Esperar de quem não usa
//    IA — marcando o run como `done`, sem rastro. Se alguém reintroduzir um
//    `if (!config) return null` aqui, ou tirar um campo dos padrões, estes testes caem.
//
// ⚠️ Os campos NÃO são decoração: `doResume` lê `ai_control_decoupled` pra decidir se um
//    humano assumiu, e `ai_model` vai pro contexto de execução. Padrão faltando = `undefined`
//    circulando pelo motor, que é como se troca um defeito barulhento por um silencioso.

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("server-only", () => ({}))

const cenario: { linha: Record<string, unknown> | null } = { linha: null }
const consultas: { tabela: string; tenantId: string }[] = []

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (tabela: string) => ({
      select: () => ({
        eq: (_col: string, tenantId: string) => {
          consultas.push({ tabela, tenantId })
          return { maybeSingle: async () => ({ data: cenario.linha, error: null }) }
        },
      }),
    }),
  },
}))

const { loadStudioConfig } = await import("./studio-config")

beforeEach(() => { cenario.linha = null; consultas.length = 0 })

describe("tenant SEM ficha de Persona (quem não usa IA)", () => {
  it("devolve padrões neutros em vez de nada — o fluxo determinístico roda", async () => {
    const c = await loadStudioConfig("t1")
    expect(c).toBeTruthy()
    expect(c.tenant_id).toBe("t1")
  })

  it("🔴 ai_control_decoupled é FALSE, não undefined", async () => {
    // `doResume` faz `config.ai_control_decoupled ? A : B`. Com undefined ele cairia no
    // ramo legado por acidente, não por decisão — e a diferença é quem consegue acordar.
    const c = await loadStudioConfig("t1")
    expect(c.ai_control_decoupled).toBe(false)
  })

  it("🔴 traz TODOS os campos que o motor lê depois", async () => {
    const c = await loadStudioConfig("t1") as Record<string, unknown>
    for (const campo of [
      "ai_model", "ai_name", "ai_tone", "ai_language",
      "identity_text", "communication_style_text", "anti_patterns_text",
      "ai_control_decoupled",
    ]) {
      expect(Object.hasOwn(c, campo), `faltou o padrão de "${campo}"`).toBe(true)
    }
  })

  it("ai_model tem valor utilizável (o contexto de execução carrega ele)", async () => {
    const c = await loadStudioConfig("t1")
    expect(typeof c.ai_model).toBe("string")
    expect((c.ai_model as string).length).toBeGreaterThan(0)
  })
})

describe("tenant COM ficha — nada muda pra quem já funciona", () => {
  it("devolve a linha real, sem misturar padrão nenhum", async () => {
    cenario.linha = {
      tenant_id: "t2", ai_name: "Bia", ai_model: "gpt-5", ai_control_decoupled: true,
      ai_tone: "formal", ai_language: "pt-BR", identity_text: "x",
      communication_style_text: null, anti_patterns_text: null, ai_enabled: true,
    }
    const c = await loadStudioConfig("t2")
    expect(c.ai_name).toBe("Bia")
    expect(c.ai_model).toBe("gpt-5")
    // 🔴 O padrão é `false`; se ele vazasse por cima da linha real, um tenant no modo
    //    desacoplado passaria a ser avaliado pela regra legada.
    expect(c.ai_control_decoupled).toBe(true)
  })
})

describe("a consulta em si", () => {
  it("lê studio_config filtrando pelo tenant recebido", async () => {
    await loadStudioConfig("t3")
    expect(consultas).toEqual([{ tabela: "studio_config", tenantId: "t3" }])
  })
})
