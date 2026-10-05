import { describe, expect, it } from "vitest"
import { preConversationNodes, formFlowProblems, outreachContentProblem } from "./form-entry-rules"

// O que a publicação recusa num fluxo de formulário — a MESMA regra que o motor obedece.
const n = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, config }) as never
const chamar = n("chamar", "outreach", { channel: "baileys", text: "Oi" })
const g = (nodes: unknown[], edges: { from: string; to: string; branch?: string }[]) => ({ nodes, edges }) as never

describe("antes do Disparar: só o que roda sem conversa", () => {
  it("o caminho do Início ao Disparar entra; o que vem depois de 'Enviado', não", () => {
    const graph = g([n("start", "start"), n("sw", "switch"), chamar, n("msg", "message", { text: "x" }), n("tag", "tag")],
      [{ from: "start", to: "sw" }, { from: "sw", to: "chamar" }, { from: "chamar", to: "msg", branch: "sent" }, { from: "chamar", to: "tag", branch: "no_whatsapp" }])
    expect(preConversationNodes(graph).map((x: { id: string }) => x.id)).toEqual(["start", "sw", "chamar", "tag"])
    expect(formFlowProblems(graph)).toEqual([])
  })
  it("Mensagem antes do Disparar é recusada, com o nome do nó", () => {
    const graph = g([n("start", "start"), n("msg", "message"), chamar], [{ from: "start", to: "msg" }, { from: "msg", to: "chamar" }])
    expect(formFlowProblems(graph)).toEqual([expect.stringContaining("o nó Mensagem só pode vir depois do Disparar no WhatsApp")])
  })
  it("Menu ou Esperar na saída 'Sem WhatsApp' também é recusado (ainda não há conversa)", () => {
    const graph = g([n("start", "start"), chamar, n("menu", "menu")], [{ from: "start", to: "chamar" }, { from: "chamar", to: "menu", branch: "no_whatsapp" }])
    expect(formFlowProblems(graph)[0]).toContain("Menu")
  })
  it("a saída PADRÃO do Disparar serve também ao 'Sem WhatsApp' — o que estiver nela vale para os dois", () => {
    const soPadrao = g([n("start", "start"), chamar, n("msg", "message")], [{ from: "start", to: "chamar" }, { from: "chamar", to: "msg" }])
    expect(formFlowProblems(soPadrao)[0]).toContain("Mensagem")
    // Com as duas recusas ligadas, a padrão só é usada pelo "Enviado".
    const ligadas = g([n("start", "start"), chamar, n("msg", "message"), n("t1", "tag"), n("t2", "tag")], [
      { from: "start", to: "chamar" }, { from: "chamar", to: "msg" },
      { from: "chamar", to: "t1", branch: "no_whatsapp" }, { from: "chamar", to: "t2", branch: "blocked" }])
    expect(formFlowProblems(ligadas)).toEqual([])
  })
  it("ciclo no desenho não trava a checagem", () => {
    const graph = g([n("start", "start"), n("a", "set_variable"), n("b", "condition")],
      [{ from: "start", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "a", branch: "true" }])
    expect(formFlowProblems(graph)).toEqual([])
  })
})

describe("o Disparar tem com o que chamar", () => {
  it("oficial exige modelo; comum exige texto; automático exige um dos dois", () => {
    expect(outreachContentProblem({ channel: "official" } as never)).toContain("modelo aprovado")
    expect(outreachContentProblem({ channel: "official", template: { name: "pedido_recebido", language: "pt_BR" } } as never)).toBeNull()
    expect(outreachContentProblem({ channel: "baileys", text: "  " } as never)).toContain("Escreva a mensagem")
    expect(outreachContentProblem({ channel: "auto" } as never)).toContain("número comum")
    expect(outreachContentProblem({ channel: "auto", text: "Oi" } as never)).toBeNull()
  })
})
