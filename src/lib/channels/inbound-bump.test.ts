// ═══════════════════════════════════════════════════════════════
// O bump da conversa pós-inbound
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Tudo aqui falha EM SILÊNCIO se voltar atrás — nada lança, nada quebra tela:
//      1. somar a não-lida em JavaScript → duas mensagens na mesma rajada leem o
//         mesmo contador e gravam o mesmo +1; a bolinha azul mostra 1 onde há 2;
//      2. não carimbar `last_inbound_at` → o motor de inatividade lê "nulo" como
//         "já disparei" e o re-engajamento roda UMA vez, por vida da conversa
//         (era o estado do Baileys até 2026-08-23);
//      3. o fallback virar o caminho normal → volta a corrida do item 1, calado;
//      4. o UPDATE perder o `tenant_id` → escrita fora do escopo do tenant.
//
// 🔒 Nada toca produção: o supabase é trocado antes do import.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("server-only", () => ({}))

// ── banco falso ────────────────────────────────────────────────────────────────
const rpcs:    { nome: string; args: Record<string, unknown> }[] = []
const updates: { patch: Record<string, unknown>; chaves: [string, unknown][] }[] = []
let rpcErro: { message: string } | null = null
let linha:   Record<string, unknown> | null = null

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args })
      return Promise.resolve({ data: null, error: rpcErro })
    },
    from: () => ({
      select: () => {
        const q = {
          eq: () => q,
          maybeSingle: () => Promise.resolve({ data: linha, error: null }),
        }
        return q
      },
      update: (patch: Record<string, unknown>) => {
        const registro = { patch, chaves: [] as [string, unknown][] }
        updates.push(registro)
        const q = {
          eq: (col: string, val: unknown) => { registro.chaves.push([col, val]); return q },
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        }
        return q
      },
    }),
  },
}))

const { bumpConversationInbound } = await import("./inbound-bump")

const TENANT = "11111111-1111-1111-1111-111111111111"
const CONV   = "22222222-2222-2222-2222-222222222222"

beforeEach(() => {
  rpcs.length = 0
  updates.length = 0
  rpcErro = null
  linha = null
  vi.restoreAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("caminho normal — quem soma é o Postgres", () => {
  it("chama a função do banco e NÃO faz lê-soma-grava", async () => {
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })

    expect(rpcs).toHaveLength(1)
    expect(rpcs[0].nome).toBe("bump_conversation_inbound")
    // O ponto do exercício: nenhum UPDATE do lado do Node.
    expect(updates).toHaveLength(0)
  })

  it("repassa tenant, conversa e preview — o tenant vai junto, não é opcional", async () => {
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "bom dia" })

    expect(rpcs[0].args.p_tenant_id).toBe(TENANT)
    expect(rpcs[0].args.p_conversation_id).toBe(CONV)
    expect(rpcs[0].args.p_preview).toBe("bom dia")
  })

  it("canal com relógio próprio (Oficial/IG) manda o timestamp DO PROVEDOR", async () => {
    // A janela de 24h é contada pelo relógio da Meta. Trocar pelo nosso encurta ou
    // estica a janela em silêncio, e o composer passa a mentir sobre poder responder.
    await bumpConversationInbound({
      tenantId: TENANT, conversationId: CONV, preview: "oi",
      lastInboundAt: "2026-08-23T10:00:00.000Z",
    })
    expect(rpcs[0].args.p_last_inbound_at).toBe("2026-08-23T10:00:00.000Z")
  })

  it("canal sem relógio confiável (Baileys/site) manda null — o banco carimba agora", async () => {
    // 🔴 O que NÃO pode voltar é o campo ficar sem carimbo nenhum: `last_inbound_at`
    //    nulo desarma o rearme do re-engajamento por inatividade.
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })
    expect(rpcs[0].args.p_last_inbound_at).toBeNull()
  })

  it("metadata só vai quando o caller manda (o site manda; os webhooks não)", async () => {
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })
    expect(rpcs[0].args.p_metadata).toBeNull()

    rpcs.length = 0
    await bumpConversationInbound({
      tenantId: TENANT, conversationId: CONV, preview: "lead",
      metadata: { site_lead: { page_url: "/precos" } },
    })
    expect(rpcs[0].args.p_metadata).toEqual({ site_lead: { page_url: "/precos" } })
  })
})

describe("fallback — a migration ainda não foi aplicada", () => {
  beforeEach(() => { rpcErro = { message: 'function public.bump_conversation_inbound does not exist' } })

  it("grita um log GREPPÁVEL — o fallback não pode passar despercebido", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    linha = { unread_count: 3, status: "open", metadata: {} }

    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })

    const logado = err.mock.calls.flat().join(" ")
    expect(logado).toContain("bump_conversation_inbound-indisponivel")
  })

  it("ainda assim sobe a conversa (o inbox não pode congelar por ordem de deploy)", async () => {
    linha = { unread_count: 3, status: "open", metadata: {} }

    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })

    expect(updates).toHaveLength(1)
    expect(updates[0].patch.unread_count).toBe(4)
    expect(updates[0].patch.last_message_dir).toBe("in")
    expect(updates[0].patch.last_message_preview).toBe("oi")
    expect(updates[0].patch.last_inbound_at).toBeTruthy()
  })

  it("o UPDATE é dupla-chave (id + tenant_id) — nunca escreve fora do tenant", async () => {
    linha = { unread_count: 0, status: "open", metadata: {} }

    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })

    expect(updates[0].chaves).toEqual([["id", CONV], ["tenant_id", TENANT]])
  })

  it("conversa concluída reabre e limpa o resolved_at", async () => {
    // Sem limpar `resolved_at`, os relatórios seguem contando como "ainda resolvida".
    linha = { unread_count: 0, status: "resolved", metadata: {} }

    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "voltei" })

    expect(updates[0].patch.status).toBe("open")
    expect(updates[0].patch.resolved_at).toBeNull()
  })

  it("conversa aberta NÃO tem o status mexido", async () => {
    linha = { unread_count: 1, status: "pending", metadata: {} }

    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })

    expect(updates[0].patch.status).toBe("pending")
    expect(updates[0].patch.resolved_at).toBeUndefined()
  })

  it("conversa que não é do tenant não vira UPDATE nenhum", async () => {
    linha = null   // o select dupla-chave não achou

    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })

    expect(updates).toHaveLength(0)
  })

  it("nunca lança — a mensagem já foi gravada, perder o bump não pode derrubar o webhook", async () => {
    linha = null
    await expect(
      bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" }),
    ).resolves.toBeUndefined()
  })
})

describe("os 4 caminhos de entrada usam a fonte única", () => {
  // Este teste lê o FONTE de propósito. A regra que ele protege não é uma função —
  // é "não existe uma 5ª cópia divergente". Foi assim que o Baileys ficou meses sem
  // gravar `last_inbound_at` sem ninguém notar.
  const RAIZ = join(process.cwd(), "src")
  const ENTRADAS = [
    "app/api/webhooks/evolution/route.ts",   // Baileys
    "lib/channels/meta-inbound.ts",          // WhatsApp Oficial
    "lib/channels/instagram-inbound.ts",     // Instagram Direct
    "app/api/site/lead/route.ts",            // webchat do site
  ]

  it.each(ENTRADAS)("%s chama bumpConversationInbound", (arquivo) => {
    const src = readFileSync(join(RAIZ, arquivo), "utf8")
    expect(src).toContain("bumpConversationInbound")
  })

  it.each(ENTRADAS)("%s não soma a não-lida em JavaScript", (arquivo) => {
    const src = readFileSync(join(RAIZ, arquivo), "utf8")
    // Pega `unread_count: (x ?? 0) + 1` em qualquer forma. O INSERT de conversa
    // nova (`unread_count: 1`) é legítimo — ali não há valor anterior pra perder.
    expect(src).not.toMatch(/unread_count:\s*[^,\n]*\+\s*1/)
  })
})

describe("opt-out de campanha vale nos dois números do tenant", () => {
  // 🔴 `marketing_opt_in` mora no CONTATO, e o contato é o mesmo no número oficial e
  //    no Baileys. Enquanto isto existiu só no canal oficial, quem respondia "SAIR"
  //    pro outro número continuava recebendo campanha — descadastro ignorado.
  it.each([
    ["lib/channels/meta-inbound.ts",        "WhatsApp Oficial"],
    ["app/api/webhooks/evolution/route.ts", "Baileys"],
  ])("%s (%s) trata o inbound de campanha", (arquivo) => {
    const src = readFileSync(join(process.cwd(), "src", arquivo), "utf8")
    expect(src).toContain("handleCampaignInbound")
  })
})
