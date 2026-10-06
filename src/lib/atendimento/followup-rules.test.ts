import { describe, expect, it } from "vitest"
import {
  followUpState, isAnsweredByContact, validateFollowUpInput, followUpChip,
  formatFollowUpMoment, formatOverdue, FOLLOW_UP_PRESETS, FOLLOW_UP_NOTE_MAX,
} from "./followup-rules"

// ═══════════════════════════════════════════════════════════════
// A REGRA da promessa — lida pelo servidor E pelo navegador
// ═══════════════════════════════════════════════════════════════
// Estes testes existem porque a mesma conta roda nos dois lados: se ela mudar
// aqui sem mudar lá, o chip da tela e a varredura passam a discordar.

const AGORA  = new Date("2026-08-20T12:00:00.000Z").getTime()
const h = (n: number) => new Date(AGORA + n * 3_600_000).toISOString()

describe("estado da promessa", () => {
  it("sem prazo, não há promessa", () => {
    expect(followUpState({ follow_up_at: null }, AGORA)).toBe("none")
  })

  it("prazo no futuro = prometido", () => {
    expect(followUpState({ follow_up_at: h(5) }, AGORA)).toBe("scheduled")
  })

  it("prazo vencido = na hora", () => {
    expect(followUpState({ follow_up_at: h(-1) }, AGORA)).toBe("due")
  })

  it("cumprido vence tudo — já aconteceu, não é cobrança nem pendência", () => {
    const c = { follow_up_at: h(-5), follow_up_done_at: h(-1) }
    expect(followUpState(c, AGORA)).toBe("done")
    expect(followUpChip(c, AGORA)).toMatchObject({ tone: "done", label: "cumprido" })
  })

  it("cliente que respondeu vence o vencimento — não vira cobrança", () => {
    const c = { follow_up_at: h(-1), follow_up_set_at: h(-5), last_message_at: h(-2), last_message_dir: "in" }
    expect(followUpState(c, AGORA)).toBe("answered")
  })
})

describe("o cliente respondeu DEPOIS da promessa?", () => {
  const base = { follow_up_set_at: h(-5) }

  it("sim: mensagem dele posterior à promessa", () => {
    expect(isAnsweredByContact({ ...base, last_message_at: h(-1), last_message_dir: "in" })).toBe(true)
  })

  it("não: a mensagem dele é anterior — foi por causa dela que se prometeu voltar", () => {
    expect(isAnsweredByContact({ ...base, last_message_at: h(-9), last_message_dir: "in" })).toBe(false)
  })

  it("não: quem falou depois fomos nós", () => {
    expect(isAnsweredByContact({ ...base, last_message_at: h(-1), last_message_dir: "out" })).toBe(false)
  })

  it("não: conversa sem promessa nunca conta como respondida", () => {
    expect(isAnsweredByContact({ last_message_at: h(-1), last_message_dir: "in" })).toBe(false)
  })
})

describe("validação do que o atendente escolhe", () => {
  it("recusa data inválida, passado e prazo longo demais", () => {
    expect(validateFollowUpInput("qualquer coisa")).toBe("Data inválida")
    expect(validateFollowUpInput(new Date(Date.now() - 1000).toISOString())).toBe("Escolha um horário no futuro")
    expect(validateFollowUpInput(new Date(Date.now() + 400 * 86_400_000).toISOString()))
      .toBe("Prazo longe demais (máximo 1 ano)")
  })

  it("recusa nota acima do teto e aceita no limite", () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString()
    expect(validateFollowUpInput(amanha, "x".repeat(FOLLOW_UP_NOTE_MAX + 1))).toBeTruthy()
    expect(validateFollowUpInput(amanha, "x".repeat(FOLLOW_UP_NOTE_MAX))).toBeNull()
  })
})

describe("o que a tela mostra", () => {
  it("prometido: diz quando volta", () => {
    const chip = followUpChip({ follow_up_at: h(3) }, AGORA)
    expect(chip).toMatchObject({ tone: "scheduled" })
    expect(chip!.label).toMatch(/^volta /)
  })

  it("vencido: o tamanho do atraso é o que dá urgência", () => {
    const chip = followUpChip({ follow_up_at: h(-50) }, AGORA)
    expect(chip).toMatchObject({ tone: "due", label: "atrasado há 2 dias" })
  })

  it("respondido: some a cobrança, fica o aviso", () => {
    const chip = followUpChip(
      { follow_up_at: h(-1), follow_up_set_at: h(-5), last_message_at: h(-2), last_message_dir: "in" },
      AGORA,
    )
    expect(chip).toMatchObject({ tone: "answered", label: "cliente respondeu" })
  })

  it("sem promessa não há chip", () => {
    expect(followUpChip({ follow_up_at: null }, AGORA)).toBeNull()
  })

  it("fala em 'hoje' e 'amanhã' antes de falar em data", () => {
    // 12:00Z = 09:00 em São Paulo, então +3h ainda é hoje e +24h é amanhã.
    expect(formatFollowUpMoment(h(3), AGORA)).toMatch(/^hoje /)
    expect(formatFollowUpMoment(h(24), AGORA)).toMatch(/^amanhã /)
  })

  it("atraso em minutos, horas e dias", () => {
    expect(formatOverdue(h(-0.5), AGORA)).toBe("há 30min")
    expect(formatOverdue(h(-3), AGORA)).toBe("há 3h")
    expect(formatOverdue(h(-24), AGORA)).toBe("há 1 dia")
  })
})

describe("atalhos do 'Voltar depois'", () => {
  it("todos apontam pro futuro e passam na validação", () => {
    for (const p of FOLLOW_UP_PRESETS) {
      const iso = p.at().toISOString()
      expect(new Date(iso).getTime()).toBeGreaterThan(Date.now())
      expect(validateFollowUpInput(iso)).toBeNull()
    }
  })

  it("'Segunda 9h' cai numa segunda-feira e nunca é hoje", () => {
    const seg = FOLLOW_UP_PRESETS.find((p) => p.key === "seg")!.at()
    expect(seg.getDay()).toBe(1)
    expect(seg.getTime()).toBeGreaterThan(Date.now())
  })
})
