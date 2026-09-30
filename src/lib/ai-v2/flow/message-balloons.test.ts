// ═══════════════════════════════════════════════════════════════
// Balões do nó Mensagem — a camada de COMPATIBILIDADE
// ═══════════════════════════════════════════════════════════════
//
// 🔴 O que estes testes protegem não é a feature nova — é o que JÁ RODA. Três formatos
//    convivem no banco (`messages` · `rich` · `text`) e o motor, a retomada, a validação
//    de publicação e o editor perguntam todos a este módulo. Se a escada de fallback
//    inverter, um fluxo publicado hoje passa a enviar outra coisa — em silêncio, porque
//    nada lança.
//
// ⚠️ O caso "nó antigo de texto puro" é o mais importante da suíte e o menos óbvio:
//    `baloesDe` devolve LISTA VAZIA pra ele de propósito. Ele tem caminho de envio
//    próprio no runtime (`sendBotText` direto) e é `temBaloesRicos` que decide isso.
//    Se `baloesDe` passasse a devolver `[{text}]`, o nó antigo sairia pelo caminho rico:
//    outro respiro, outro metadata na linha gravada. Byte a byte igual É o requisito.

import { describe, it, expect } from "vitest"
import {
  baloesDe, baloesBotoes, baloesEsperam, botaoForaDoUltimo, temBaloesRicos, MAX_BALOES,
} from "./message-balloons"
import type { MessageNodeConfig, RichMessage } from "./types"

const cfg = (o: Partial<MessageNodeConfig>): MessageNodeConfig =>
  ({ text: "", ...o }) as MessageNodeConfig

const reply = (id: string) => ({ id, label: "Quero", kind: "reply" as const })
const link  = (id: string) => ({ id, label: "Site", kind: "url" as const, url: "https://x.com" })

describe("nó ANTIGO de texto puro — não pode virar balão", () => {
  it("temBaloesRicos é false (o runtime manda pelo caminho de texto de sempre)", () => {
    expect(temBaloesRicos(cfg({ text: "Olá" }))).toBe(false)
  })

  it("baloesDe devolve lista VAZIA — o texto puro tem caminho próprio", () => {
    expect(baloesDe(cfg({ text: "Olá" }))).toEqual([])
  })

  it("nó completamente vazio também não é rico", () => {
    expect(temBaloesRicos(cfg({}))).toBe(false)
  })
})

describe("nó do compositor de 2026-08-06 (um `rich`) — sai idêntico", () => {
  const rich: RichMessage = { text: "Oi", buttons: [reply("b1")] }

  it("vira exatamente UM balão", () => {
    expect(baloesDe(cfg({ rich }))).toEqual([rich])
  })

  it("é reconhecido como rico", () => {
    expect(temBaloesRicos(cfg({ rich }))).toBe(true)
  })

  it("os botões dele continuam sendo os botões do nó", () => {
    expect(baloesBotoes(cfg({ rich }))).toEqual([reply("b1")])
    expect(baloesEsperam(cfg({ rich }))).toBe(true)
  })
})

describe("balões novos", () => {
  const b1: RichMessage = { text: "Primeiro" }
  const b2: RichMessage = { text: "Segundo" }
  const b3: RichMessage = { text: "Terceiro", buttons: [reply("x")] }

  it("`messages` VENCE `rich` (a escada tem ordem)", () => {
    const c = cfg({ rich: { text: "antigo" }, messages: [b1, b2] })
    expect(baloesDe(c)).toEqual([b1, b2])
  })

  it("os botões vêm do ÚLTIMO balão", () => {
    expect(baloesBotoes(cfg({ messages: [b1, b2, b3] }))).toEqual([reply("x")])
  })

  it("🔴 botão num balão do MEIO é ignorado pela leitura (nunca vira saída)", () => {
    const meio: RichMessage = { text: "meio", buttons: [reply("errado")] }
    expect(baloesBotoes(cfg({ messages: [b1, meio, b2] }))).toEqual([])
    expect(baloesEsperam(cfg({ messages: [b1, meio, b2] }))).toBe(false)
  })

  it("corta em MAX_BALOES na LEITURA — jsonb adulterado não despeja 10 mensagens", () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ text: `m${i}` }))
    expect(baloesDe(cfg({ messages: dez }))).toHaveLength(MAX_BALOES)
  })

  it("lista vazia cai no `rich`, e sem `rich` fica vazia", () => {
    expect(baloesDe(cfg({ messages: [], rich: b1 }))).toEqual([b1])
    expect(baloesDe(cfg({ messages: [] }))).toEqual([])
  })
})

describe("esperar × não esperar", () => {
  it("botão de LINK não faz esperar (o toque abre o navegador e não volta)", () => {
    expect(baloesEsperam(cfg({ messages: [{ text: "a", buttons: [link("l1")] }] }))).toBe(false)
  })

  it("botão de RESPOSTA faz esperar", () => {
    expect(baloesEsperam(cfg({ messages: [{ text: "a", buttons: [reply("r1")] }] }))).toBe(true)
  })

  it("link + resposta no mesmo balão: espera", () => {
    expect(baloesEsperam(cfg({ messages: [{ text: "a", buttons: [link("l"), reply("r")] }] }))).toBe(true)
  })

  it("nó sem balão nenhum não espera", () => {
    expect(baloesEsperam(cfg({}))).toBe(false)
  })
})

describe("botaoForaDoUltimo — o que a publicação recusa", () => {
  it("devolve 0 quando o botão está no último", () => {
    expect(botaoForaDoUltimo(cfg({ messages: [{ text: "a" }, { text: "b", buttons: [reply("r")] }] }))).toBe(0)
  })

  it("aponta o PRIMEIRO infrator, 1-based", () => {
    expect(botaoForaDoUltimo(cfg({ messages: [{ text: "a", buttons: [reply("r")] }, { text: "b" }] }))).toBe(1)
    expect(botaoForaDoUltimo(cfg({ messages: [{ text: "a" }, { text: "b", buttons: [link("l")] }, { text: "c" }] }))).toBe(2)
  })

  it("balão único nunca infringe (ele É o último)", () => {
    expect(botaoForaDoUltimo(cfg({ rich: { text: "a", buttons: [reply("r")] } }))).toBe(0)
  })

  it("botão de LINK no meio também é recusado — ele ocuparia o lugar sem virar saída", () => {
    expect(botaoForaDoUltimo(cfg({ messages: [{ text: "a", buttons: [link("l")] }, { text: "b" }] }))).toBe(1)
  })
})
