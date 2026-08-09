// ═══════════════════════════════════════════════════════════════
// A escada: carência, paywall e quem ainda entra
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE ESTES TESTES EXISTEM. A função que ANTES ia aplicar a carência
//    (`isTenantBlockedForSpendAt`) tinha o nome certo, a assinatura certa, zero chamadores
//    e o comportamento **invertido** — durante a carência ela LIBERAVA o gasto, porque foi
//    escrita pra uma escada anterior. Trocá-la pela outra passaria no `tsc` (mesma
//    assinatura) e ligaria IA e campanhas justamente nos dias em que a escada quer
//    cortá-las. O único sinal seria a fatura da OpenAI no mês seguinte.
//
// 🔑 Aqui o que se tranca não é o código: é a REGRA. Cada `it` afirma uma decisão do dono
//    em uma frase — e se alguém inverter a decisão sem querer, o nome do teste diz qual.

import { describe, it, expect } from "vitest"
import {
  passouDaCarencia, motivoDoPaywall, isTenantInPaywall,
  isTenantBlockedForAccessAs, PAST_DUE_GRACE_DAYS,
  type AcessoDoTenant,
} from "./lifecycle-shared"

const DIA = 86_400_000
const AGORA = Date.UTC(2026, 7, 8, 12, 0, 0)   // 08/08/2026 12:00 UTC
const haDias = (n: number) => new Date(AGORA - n * DIA).toISOString()

/** Tenant saudável — cada teste muda só o que interessa. */
const base = (over: Partial<AcessoDoTenant> = {}): AcessoDoTenant => ({
  lifecycle_state: "active",
  subscription_status: "active",
  past_due_since: null,
  past_due_grace_days: null,
  ...over,
})

describe("o relógio da carência", () => {
  it("dentro do prazo NÃO passou", () => {
    expect(passouDaCarencia(haDias(3), 7, AGORA)).toBe(false)
  })

  it("no dia exato JÁ passou (a carência é de N dias, não N+1)", () => {
    expect(passouDaCarencia(haDias(7), 7, AGORA)).toBe(true)
  })

  it("carência 0 corta junto com o degrau 2 — é valor válido, não 'sem valor'", () => {
    expect(passouDaCarencia(haDias(0), 0, AGORA)).toBe(true)
  })

  it("carência nula cai no padrão do sistema, nunca em zero", () => {
    expect(passouDaCarencia(haDias(PAST_DUE_GRACE_DAYS - 1), null, AGORA)).toBe(false)
    expect(passouDaCarencia(haDias(PAST_DUE_GRACE_DAYS), null, AGORA)).toBe(true)
  })

  // 🔴 A assimetria deliberada: fail-CLOSED pela data, fail-OPEN pelo prazo. Sem carimbo o
  //    atraso EXISTE e só a data se perdeu — presumir "acabou de começar" daria carência
  //    infinita a quem tem o carimbo faltando.
  it("sem carimbo trata como PASSADO (senão carimbo faltando = carência infinita)", () => {
    expect(passouDaCarencia(null, 7, AGORA)).toBe(true)
    expect(passouDaCarencia("data-podre", 7, AGORA)).toBe(true)
  })
})

describe("o motivo do paywall", () => {
  it("teste vencido é paywall na hora — não há carência pra quem nunca pagou", () => {
    expect(motivoDoPaywall("trial_ended", "active", null, null, AGORA)).toBe("trial_ended")
  })

  it("atraso DENTRO da carência ainda não é paywall (é o degrau 2)", () => {
    expect(motivoDoPaywall("active", "past_due", haDias(2), 7, AGORA)).toBeNull()
  })

  it("atraso ALÉM da carência vira paywall", () => {
    expect(motivoDoPaywall("active", "past_due", haDias(8), 7, AGORA)).toBe("past_due")
  })

  it("assinatura em dia nunca é paywall, mesmo com carimbo residual", () => {
    // Carimbo órfão (invariante 2 da migration): não pode punir quem está pagando.
    expect(motivoDoPaywall("active", "active", haDias(90), 7, AGORA)).toBeNull()
  })

  // 🔴 ESTE TESTE AFIRMAVA O BURACO ATÉ 08/08. Ele dizia "cancelada NÃO é paywall", e o
  //    pentest mostrou o que isso valia na prática: o cliente parava de pagar e ficava com
  //    a caixa de entrada inteira e a equipe toda trabalhando, para sempre.
  // ⚠️ `canceled` NÃO é "acabou de cancelar" — durante todo o ciclo já pago o tenant segue
  //    `active` (regra do dono: "ele tem tudo até o último dia dele"). Quem escreve
  //    `canceled` é a varredura diária DEPOIS que a data passa. O teste abaixo cobre as
  //    duas metades, porque inverter uma sem a outra recria o furo ou corta quem pagou.
  it("cancelada É paywall — mas só DEPOIS do ciclo pago", () => {
    // Dentro do ciclo: cancelou, mas ainda está `active` ⇒ nada é cortado.
    expect(motivoDoPaywall("active", "active", null, null, AGORA)).toBeNull()
    // Passada a data, a varredura carimba `canceled` ⇒ produto fecha.
    expect(motivoDoPaywall("active", "canceled", null, null, AGORA)).toBe("canceled")
  })

  it("no paywall por cancelamento, quem paga ainda entra pra reativar", () => {
    const encerrado = base({ subscription_status: "canceled" })
    expect(isTenantBlockedForAccessAs(encerrado, "owner", AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(encerrado, "admin", AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(encerrado, "agent", AGORA)).toBe(true)
  })

  it("o booleano é derivado do motivo, nunca uma segunda regra", () => {
    for (const sub of ["active", "past_due", "canceled"]) {
      for (const since of [null, haDias(2), haDias(30)]) {
        const m = motivoDoPaywall("active", sub, since, 7, AGORA)
        expect(isTenantInPaywall("active", sub, since, 7, AGORA)).toBe(m !== null)
      }
    }
  })
})

describe("quem ainda entra", () => {
  const cortado = base({ subscription_status: "past_due", past_due_since: haDias(30), past_due_grace_days: 7 })

  it("dentro da carência TODO MUNDO entra — inclusive o atendente", () => {
    const naCarencia = base({ subscription_status: "past_due", past_due_since: haDias(1), past_due_grace_days: 7 })
    for (const papel of ["owner", "admin", "agent"]) {
      expect(isTenantBlockedForAccessAs(naCarencia, papel, AGORA)).toBe(false)
    }
  })

  it("no paywall entra quem PODE PAGAR e mais ninguém", () => {
    expect(isTenantBlockedForAccessAs(cortado, "owner", AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(cortado, "admin", AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(cortado, "agent", AGORA)).toBe(true)
  })

  it("papel ausente ou desconhecido NÃO entra (o gate não adivinha)", () => {
    expect(isTenantBlockedForAccessAs(cortado, null, AGORA)).toBe(true)
    expect(isTenantBlockedForAccessAs(cortado, "", AGORA)).toBe(true)
    expect(isTenantBlockedForAccessAs(cortado, "viewer", AGORA)).toBe(true)
  })

  it("teste vencido tem a MESMA regra de papel do atraso", () => {
    const teste = base({ lifecycle_state: "trial_ended" })
    expect(isTenantBlockedForAccessAs(teste, "owner", AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(teste, "agent", AGORA)).toBe(true)
  })

  // 🔴 A ordem importa: suspenso é decisão HUMANA (degrau 4) e vence o paywall, que é
  //    automático. Se o paywall vencesse, o owner de um tenant suspenso entraria — e
  //    suspender deixaria de suspender.
  it("suspenso barra TODO MUNDO, inclusive quem paga", () => {
    const suspenso = base({ lifecycle_state: "suspended", subscription_status: "past_due", past_due_since: haDias(30) })
    expect(isTenantBlockedForAccessAs(suspenso, "owner", AGORA)).toBe(true)
  })

  it("cliente em dia entra em qualquer papel", () => {
    for (const papel of ["owner", "admin", "agent"]) {
      expect(isTenantBlockedForAccessAs(base(), papel, AGORA)).toBe(false)
    }
  })

  // 🔴 O caso que a política nomeia: inadimplência NÃO pode derrubar o login de quem
  //    resolve, porque a tela onde ele paga fica DENTRO do sistema.
  it("o dono nunca perde o login por dinheiro — só por decisão humana", () => {
    const cenarios: AcessoDoTenant[] = [
      base({ subscription_status: "past_due", past_due_since: haDias(1) }),
      base({ subscription_status: "past_due", past_due_since: haDias(365) }),
      base({ subscription_status: "past_due", past_due_since: null }),
      base({ subscription_status: "canceled" }),
      base({ lifecycle_state: "trial_ended" }),
    ]
    for (const c of cenarios) expect(isTenantBlockedForAccessAs(c, "owner", AGORA)).toBe(false)
  })
})
