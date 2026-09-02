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
import { readFileSync, readdirSync } from "node:fs"
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

describe("a âncora da janela só anda quando o evento é do canal certo", () => {
  // 🔴 A REGRESSÃO QUE ESTES TESTES TRANCAM: `last_inbound_at` é a âncora da janela de
  //    24h da Meta. O formulário do site reusa o fio de WhatsApp do contato (dedup sem
  //    escopo de canal, de propósito), então carimbar ali REABRE a janela por um
  //    formulário — o composer libera texto livre, a Meta recusa com 131047, e a
  //    mensagem fica "enviada" sem chegar.

  it("a porta do formulário do site NÃO carimba a âncora", async () => {
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "lead", touchWindow: false })
    expect(rpcs[0].args.p_touch_window).toBe(false)
  })

  it("omitir o parâmetro carimba — as portas de transporte não mudam", async () => {
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })
    // Explícito, nunca `undefined`: o DEFAULT do banco não pode ser o único guarda.
    expect(rpcs[0].args.p_touch_window).toBe(true)
  })

  it("🔑 o FALLBACK também respeita — senão o conserto tem bypass silencioso", async () => {
    // A janela em que o fallback mais roda é o próprio deploy da migration (recarga do
    // schema cache do PostgREST). Se ele carimbar, o bug sobrevive ao conserto.
    rpcErro = { message: "function public.bump_conversation_inbound(...) does not exist" }
    linha   = { unread_count: 3, status: "open", metadata: {} }
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "lead", touchWindow: false })
    expect(updates[0].patch).not.toHaveProperty("last_inbound_at")
    // ...e o resto do bump continua acontecendo (a não-lida não pode sumir junto)
    expect(updates[0].patch.unread_count).toBe(4)
  })

  it("🔑 o fallback SEM o parâmetro segue carimbando (não quebra as 3 portas de transporte)", async () => {
    rpcErro = { message: "function ... does not exist" }
    linha   = { unread_count: 0, status: "open", metadata: {} }
    await bumpConversationInbound({ tenantId: TENANT, conversationId: CONV, preview: "oi" })
    expect(updates[0].patch).toHaveProperty("last_inbound_at")
  })

  it("🔑 a migration usa DROP, não CREATE OR REPLACE — overload derruba as 4 portas", () => {
    // Postgres só faz REPLACE quando a assinatura de TIPOS bate. Com um parâmetro novo,
    // `CREATE OR REPLACE` cria uma SEGUNDA função: PostgREST ambíguo + a nova sem grant
    // pro service_role ⇒ todas as portas caem no fallback lê-soma-grava.
    // Só o DDL de verdade: comentário `--` fala de rollback e cita formas proibidas
    // de propósito. O teste afirma sobre o que o Postgres executa, não sobre a prosa.
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260901000100_bump_conversation_inbound_touch_window.sql"), "utf8")
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
    expect(sql).toMatch(/DROP FUNCTION public\.bump_conversation_inbound\(uuid, uuid, text, timestamptz, jsonb\)/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bump_conversation_inbound\([^)]*boolean\)[\s\S]*?TO service_role/)
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.bump_conversation_inbound/)
  })

  it("🔑 a PORTA do formulário passa touchWindow:false — e as de transporte não passam", () => {
    // 🔴 Este teste nasceu de uma mutação que SOBREVIVEU: eu exercitava o helper com
    //    `touchWindow: false`, mas nada travava a ROTA passando o parâmetro. Dava pra
    //    apagar a linha do `/api/site/lead` e a suíte inteira continuava verde — ou
    //    seja, a regressão original podia voltar sem nenhum teste vermelho.
    const ler = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8")
    expect(ler("app/api/site/lead/route.ts")).toMatch(/touchWindow:\s*false/)

    // Simetria: quem é transporte de verdade NÃO desliga a âncora. Se um dia alguém
    // copiar a linha pro webhook errado, a janela do canal pago para de rearmar.
    for (const porta of [
      "app/api/webhooks/evolution/route.ts",
      "lib/channels/meta-inbound.ts",
      "lib/channels/instagram-inbound.ts",
      "app/api/site/message/route.ts",   // webchat: mensagem de verdade no próprio canal
    ]) {
      expect(ler(porta), `${porta} não deveria mexer em touchWindow`).not.toMatch(/touchWindow/)
    }
  })

  it("🔑 o formulário do site marca a mensagem como 'não conta pra janela'", () => {
    // O composer calcula a janela pelo MAIOR entre a coluna e a última msg de contato.
    // Sem o marcador, a tela diria "aberta" e o servidor "fechada" — duas verdades.
    const src = readFileSync(join(process.cwd(), "src/app/api/site/lead/route.ts"), "utf8")
    expect(src).toMatch(/counts_for_window:\s*false/)
    const painel = readFileSync(join(process.cwd(), "src/components/chat/chat-panel.tsx"), "utf8")
    expect(painel).toMatch(/counts_for_window/)
  })
})

describe("toda porta de entrada usa a fonte única", () => {
  // Este teste lê o FONTE de propósito. A regra que ele protege não é uma função —
  // é "não existe uma cópia divergente".
  //
  // 🔴 A VERSÃO ANTERIOR DESTE TESTE FALHOU NO PRÓPRIO PROPÓSITO. Ela listava QUATRO
  //    portas na mão e se dizia guardiã contra "uma 5ª cópia" — enquanto a 5ª
  //    (`/api/site/message`, o webchat) já existia, divergente, deployada. Uma lista
  //    escrita à mão só protege contra o que quem a escreveu lembrou de listar.
  //    Medido quando finalmente foi olhada: 35 de 35 conversas de site com mensagem
  //    de cliente e ZERO bolinha azul, porque aquela cópia não somava `unread_count`.
  //
  // ✅ Agora a lista é DERIVADA: quem insere mensagem de cliente É uma porta de
  //    entrada, por definição. Uma 6ª porta nasce coberta — ou reprova aqui.
  const RAIZ = join(process.cwd(), "src")

  function arquivosQueInseremMensagemDeCliente(dir: string): string[] {
    const achados: string[] = []
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name)
      if (entrada.isDirectory()) { achados.push(...arquivosQueInseremMensagemDeCliente(caminho)); continue }
      if (!/\.tsx?$/.test(entrada.name) || /\.test\.tsx?$/.test(entrada.name)) continue
      const src = readFileSync(caminho, "utf8")
      if (/sender_type:\s*"contact"/.test(src)) achados.push(caminho)
    }
    return achados
  }

  const ENTRADAS = arquivosQueInseremMensagemDeCliente(RAIZ)

  it("acha as portas de entrada pelo que elas FAZEM, não por uma lista", () => {
    // Se este número cair, alguém removeu uma porta — ou quebrou a varredura.
    expect(ENTRADAS.length).toBeGreaterThanOrEqual(5)
  })

  it.each(ENTRADAS)("%s chama bumpConversationInbound", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).toContain("bumpConversationInbound")
  })

  it.each(ENTRADAS)("%s não soma a não-lida em JavaScript", (arquivo) => {
    // Pega `unread_count: (x ?? 0) + 1` em qualquer forma. O INSERT de conversa
    // nova (`unread_count: 1`) é legítimo — ali não há valor anterior pra perder.
    expect(readFileSync(arquivo, "utf8")).not.toMatch(/unread_count:\s*[^,\n]*\+\s*1/)
  })

  it.each(ENTRADAS)("%s não faz UPDATE artesanal da linha do inbox", (arquivo) => {
    // 🔴 O defeito exato da 5ª porta: ela chamava `.update({ last_message_dir: "in" })`
    //    à mão, e o que faltava no objeto (não-lida, reabertura) sumia em silêncio.
    //    Quem escreve a direção do inbound tem que ser a fonte única, não o caller.
    expect(readFileSync(arquivo, "utf8")).not.toMatch(/last_message_dir:\s*"in"/)
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
