// ═══════════════════════════════════════════════════════════════
// Carteira — quem vira dono do cliente, e quando
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Tudo aqui falha EM SILÊNCIO se voltar atrás — o carimbo é best-effort de
//    propósito (não pode derrubar o envio da mensagem), então erro nenhum aparece:
//      1. carimbar em modo FILA → o cliente ganha dono que a tela não prometeu, e o
//         retorno passa a rotear por uma posse que o admin desligou;
//      2. perder o fill-only-empty → o segundo atendente ROUBA o cliente do primeiro
//         (e o pit-stop do Financeiro vira posse);
//      3. carimbar agente inativo → a conversa de retorno nasce atribuída a um
//         fantasma, some da fila e ninguém é avisado;
//      4. `carteiraOwner` devolver dono inativo → mesma coisa, do lado da leitura;
//      5. a transferência mover a posse quando quem transfere NÃO é o dono → qualquer
//         repasse vira entrega de carteira.
//
// 🔒 Nada toca produção: o supabase é trocado antes do import.

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("server-only", () => ({}))

const eventos: { kind: string; payload: Record<string, unknown> }[] = []
vi.mock("@/lib/commercial/entries", () => ({
  emitCommercialEvent: (_t: string, kind: string, o: { payload?: Record<string, unknown> }) => {
    eventos.push({ kind, payload: o.payload ?? {} })
    return Promise.resolve()
  },
}))

// ── banco falso ────────────────────────────────────────────────────────────────
let binding: string | null = "carteira"
let membroAtivo = true
let donoAtual: string | null = null
/** Linhas que o UPDATE afetou — modela o `.select()` do supabase-js. */
let afetadas: { id: string }[] = []
const updates: { tabela: string; patch: Record<string, unknown>; filtros: [string, unknown][] }[] = []

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (tabela: string) => ({
      select: () => {
        const q = {
          eq: () => q,
          is: () => q,
          maybeSingle: () => Promise.resolve({
            data: tabela === "tenant_config"
              ? { handoff_binding: binding }
              : tabela === "tenant_users"
                ? (membroAtivo ? { user_id: "quem" } : null)
                : { owner_id: donoAtual },
            error: null,
          }),
        }
        return q
      },
      update: (patch: Record<string, unknown>) => {
        const reg = { tabela, patch, filtros: [] as [string, unknown][] }
        updates.push(reg)
        const q = {
          eq: (c: string, v: unknown) => { reg.filtros.push([c, v]); return q },
          is: (c: string, v: unknown) => { reg.filtros.push([`is:${c}`, v]); return q },
          select: () => Promise.resolve({ data: afetadas, error: null }),
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        }
        return q
      },
    }),
  },
}))

const { claimOwnerOnAttendance, carteiraOwner, handOverOwner } = await import("./carteira")

const T = "11111111-1111-1111-1111-111111111111"
const C = "22222222-2222-2222-2222-222222222222"
const EU    = "33333333-3333-3333-3333-333333333333"
const OUTRO = "44444444-4444-4444-4444-444444444444"

beforeEach(() => {
  eventos.length = 0
  updates.length = 0
  binding = "carteira"
  membroAtivo = true
  donoAtual = null
  afetadas = [{ id: C }]        // por padrão o carimbo pega
  vi.restoreAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("carimbo por ATENDIMENTO — a segunda porta da carteira", () => {
  it("em Vínculo=carteira, quem fala primeiro vira dono", async () => {
    await claimOwnerOnAttendance(T, C, EU)
    const u = updates.find((x) => x.tabela === "chat_contacts")!
    expect(u.patch.owner_id).toBe(EU)
  })

  it("🔑 em Vínculo=FILA o carimbo NÃO acontece", async () => {
    // A configuração é a chave que liga a porta. Carimbar aqui daria ao cliente um
    // dono que o admin desligou de propósito — e o retorno passaria a rotear por ele.
    binding = "pool"
    await claimOwnerOnAttendance(T, C, EU)
    expect(updates.filter((x) => x.tabela === "chat_contacts")).toHaveLength(0)
  })

  it("sem configuração salva, o default é carteira (mesmo default da leitura)", async () => {
    binding = null
    await claimOwnerOnAttendance(T, C, EU)
    expect(updates.some((x) => x.tabela === "chat_contacts")).toBe(true)
  })

  it("🔑 fill-only-empty: a escrita exige owner_id NULO", async () => {
    // É esta trava que faz atendimento e CRM conviverem sem precedência, e é ela que
    // impede o pit-stop de virar posse. Sem o `.is`, o segundo a falar ROUBA o cliente.
    await claimOwnerOnAttendance(T, C, EU)
    const u = updates.find((x) => x.tabela === "chat_contacts")!
    expect(u.filtros).toContainEqual(["is:owner_id", null])
  })

  it("🔑 a escrita é escopada por tenant, não só pelo id do contato", async () => {
    await claimOwnerOnAttendance(T, C, EU)
    const u = updates.find((x) => x.tabela === "chat_contacts")!
    expect(u.filtros).toContainEqual(["tenant_id", T])
  })

  it("🔑 agente INATIVO não vira dono", async () => {
    membroAtivo = false
    await claimOwnerOnAttendance(T, C, EU)
    expect(updates.filter((x) => x.tabela === "chat_contacts")).toHaveLength(0)
  })

  it("🔑 só registra na trilha se o carimbo REALMENTE pegou", async () => {
    // O update com `.is(null)` não afeta linha quando já há dono. Sem checar as linhas
    // afetadas, a trilha registraria uma posse que não aconteceu.
    afetadas = []
    await claimOwnerOnAttendance(T, C, EU)
    expect(eventos).toHaveLength(0)
  })

  it("a trilha registra a PORTA por onde a posse veio", async () => {
    await claimOwnerOnAttendance(T, C, EU)
    expect(eventos[0].kind).toBe("carteira.owner_claimed")
    expect(eventos[0].payload).toMatchObject({ owner_id: EU, via: "atendimento" })
  })

  it("nunca lança — o envio da mensagem não pode falhar por causa do carimbo", async () => {
    await expect(claimOwnerOnAttendance(T, null, EU)).resolves.toBeUndefined()
    await expect(claimOwnerOnAttendance(T, C, null)).resolves.toBeUndefined()
  })
})

describe("leitura do dono — o fantasma", () => {
  it("devolve o dono quando ele ainda é membro ativo", async () => {
    donoAtual = EU; membroAtivo = true
    expect(await carteiraOwner(T, C)).toBe(EU)
  })

  it("🔑 dono que SAIU da empresa devolve null (cai no comportamento clássico)", async () => {
    // Sem isto, o retorno do cliente é roteado pra um fantasma: a conversa nasce
    // atribuída a quem não trabalha mais lá, some da fila e fica parada sem aviso.
    donoAtual = EU; membroAtivo = false
    expect(await carteiraOwner(T, C)).toBeNull()
  })

  it("contato sem dono devolve null sem consultar equipe", async () => {
    donoAtual = null
    expect(await carteiraOwner(T, C)).toBeNull()
  })
})

describe("entrega da carteira na transferência", () => {
  it("troca o dono e registra a entrega", async () => {
    await handOverOwner(T, C, EU, OUTRO)
    const u = updates.find((x) => x.tabela === "chat_contacts")!
    expect(u.patch.owner_id).toBe(OUTRO)
    expect(eventos[0].kind).toBe("carteira.owner_handed_over")
    expect(eventos[0].payload).toMatchObject({ from: EU, to: OUTRO })
  })

  it("🔑 a escrita confere o dono ANTERIOR — não atropela troca no meio", async () => {
    await handOverOwner(T, C, EU, OUTRO)
    const u = updates.find((x) => x.tabela === "chat_contacts")!
    expect(u.filtros).toContainEqual(["owner_id", EU])
  })

  it("🔑 NÃO entrega carteira pra quem não é membro ativo", async () => {
    membroAtivo = false
    await handOverOwner(T, C, EU, OUTRO)
    expect(updates.filter((x) => x.tabela === "chat_contacts")).toHaveLength(0)
  })

  it("não registra entrega quando a escrita não afetou ninguém", async () => {
    afetadas = []
    await handOverOwner(T, C, EU, OUTRO)
    expect(eventos).toHaveLength(0)
  })
})
