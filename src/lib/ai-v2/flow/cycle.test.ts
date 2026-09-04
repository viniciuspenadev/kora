// ═══════════════════════════════════════════════════════════════
// Círculo sem pausa — o aviso da prancheta
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Esta regra falha nos DOIS sentidos, e os dois custam caro:
//    • Falso POSITIVO ("crescer lobo") é o pior: se ela acusar "voltar ao menu" — que é o
//      círculo mais comum e é seguro — o dono aprende a ignorar o aviso, e aí ele deixa de
//      servir pro caso que importa. Um aviso desacreditado é pior que aviso nenhum.
//    • Falso NEGATIVO deixa passar o círculo que gira: o cliente final recebe a mesma
//      mensagem uma dúzia de vezes até o disjuntor do motor cortar.
//
// Nada aqui toca banco, rede nem React: a regra é pura de propósito (foi extraída de
// dentro de um `useCallback`, onde era intestável).

import { describe, it, expect } from "vitest"
import { circuloSemPausa, paraEEspera, type CycleNode, type CycleEdge } from "./cycle"

const no = (id: string, type: string, replyButtons = 0): CycleNode => ({ id, type, replyButtons })
const lig = (source: string, target: string): CycleEdge => ({ source, target })

describe("paraEEspera — quem segura o fluxo", () => {
  it("Menu, Coletar dado, Esperar, Agendar e Agente IA esperam a pessoa", () => {
    for (const t of ["menu", "collect", "wait", "schedule", "ai_agent"]) {
      expect(paraEEspera(no("x", t))).toBe(true)
    }
  })

  it("Mensagem, Condição, Etiquetar e Definir variável NÃO esperam", () => {
    for (const t of ["message", "condition", "tag", "set_variable", "send_media", "start"]) {
      expect(paraEEspera(no("x", t))).toBe(false)
    }
  })

  it("Mensagem COM botão de resposta espera", () => {
    expect(paraEEspera(no("x", "message", 1))).toBe(true)
  })

  it("nó desconhecido não espera (fail-safe: erra avisando, não calando)", () => {
    expect(paraEEspera(undefined)).toBe(false)
    expect(paraEEspera(no("x", "no_que_ainda_nao_existe"))).toBe(false)
  })
})

describe("circuloSemPausa — o que o editor denuncia", () => {
  it("🔴 DENUNCIA: Mensagem → Condição e a volta, sem ninguém parando", () => {
    const nodes = [no("m", "message"), no("c", "condition")]
    const edges = [lig("m", "c")]
    // ligando c → m fecha o círculo
    expect(circuloSemPausa(nodes, edges, "c", "m")).toBe(true)
  })

  it("✅ NÃO denuncia 'voltar ao menu' — o Menu para e espera a pessoa", () => {
    const nodes = [no("menu", "menu"), no("msg", "message")]
    const edges = [lig("menu", "msg")]
    expect(circuloSemPausa(nodes, edges, "msg", "menu")).toBe(false)
  })

  it("✅ NÃO denuncia círculo com Esperar dentro", () => {
    const nodes = [no("a", "message"), no("w", "wait"), no("b", "message")]
    const edges = [lig("a", "w"), lig("w", "b")]
    expect(circuloSemPausa(nodes, edges, "b", "a")).toBe(false)
  })

  it("✅ NÃO denuncia círculo que passa por Mensagem COM botão de resposta", () => {
    const nodes = [no("pergunta", "message", 2), no("t", "tag")]
    const edges = [lig("pergunta", "t")]
    expect(circuloSemPausa(nodes, edges, "t", "pergunta")).toBe(false)
  })

  it("✅ NÃO denuncia ligação pra frente (não há círculo nenhum)", () => {
    const nodes = [no("a", "message"), no("b", "message"), no("c", "message")]
    const edges = [lig("a", "b")]
    expect(circuloSemPausa(nodes, edges, "b", "c")).toBe(false)
  })

  it("🔴 DENUNCIA laço no próprio nó quando ele não espera", () => {
    expect(circuloSemPausa([no("a", "message")], [], "a", "a")).toBe(true)
  })

  it("✅ NÃO denuncia laço no próprio nó quando ele espera (Menu que repete)", () => {
    expect(circuloSemPausa([no("a", "menu")], [], "a", "a")).toBe(false)
  })

  it("🔴 DENUNCIA círculo LONGO sem pausa (5 nós determinísticos)", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => no(id, "condition"))
    const edges = [lig("a", "b"), lig("b", "c"), lig("c", "d"), lig("d", "e")]
    expect(circuloSemPausa(nodes, edges, "e", "a")).toBe(true)
  })

  it("✅ uma pausa EM QUALQUER PONTO do círculo longo já desarma", () => {
    const nodes = [no("a", "condition"), no("b", "condition"), no("c", "collect"), no("d", "condition")]
    const edges = [lig("a", "b"), lig("b", "c"), lig("c", "d")]
    expect(circuloSemPausa(nodes, edges, "d", "a")).toBe(false)
  })

  it("termina em grafo que já tem círculo (não trava a tela)", () => {
    const nodes = [no("a", "message"), no("b", "message"), no("c", "message")]
    const edges = [lig("a", "b"), lig("b", "a"), lig("b", "c")]
    expect(() => circuloSemPausa(nodes, edges, "c", "a")).not.toThrow()
  })

  it("ligação pra um nó que não existe no desenho não quebra", () => {
    expect(() => circuloSemPausa([no("a", "message")], [], "a", "fantasma")).not.toThrow()
  })
})
