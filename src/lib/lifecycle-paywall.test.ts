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
  carenciaEfetiva,
  passouDaCarencia, motivoDoPaywall, isTenantInPaywall,
  isTenantBlockedForAccessAs, isTenantBlockedForSpendForTenant,
  motivoDoPaywallForTenant, PAST_DUE_GRACE_DAYS,
  type AcessoDoTenant,
} from "./lifecycle-shared"

const DIA = 86_400_000
const AGORA = Date.UTC(2026, 7, 8, 12, 0, 0)   // 08/08/2026 12:00 UTC
const haDias = (n: number) => new Date(AGORA - n * DIA).toISOString()

/** Tenant saudável — cada teste muda só o que interessa. */
const base = (over: Partial<AcessoDoTenant> = {}): AcessoDoTenant => ({
  lifecycle_state: "active",
  subscription_status: "active",
  billing_mode: "gateway",
  past_due_since: null,
  past_due_grace_days: null,
  past_due_reason: null,
  ...over,
})

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 O RISCO QUE ESTES TESTES PEGARAM E O COMPILADOR NÃO PEGA (12/08)
// ═══════════════════════════════════════════════════════════════════════════
// Ao inserir `padraoGlobal` ANTES do `now`, toda chamada que já passava `now` na posição
// anterior passou a entregar o relógio como se fosse a CARÊNCIA — e os dois são `number`,
// então o `tsc` não viu nada. Foi assim que 2 destes testes ficaram vermelhos.
//
// 🔑 Em produção nenhum call site passava `now` (todos usavam o default), então o estrago
//    ficou contido aos testes — mas a lição fica: **parâmetro obrigatório protege quem passa
//    MENOS argumentos; não protege quem já passava o suficiente.** Estes testes são a única
//    parede contra essa classe aqui, e é por isso que eles cobrem a cadeia inteira.
//
// ⚠️ `PADRAO` é o padrão da PLATAFORMA (`platform_settings.past_due_grace_days`) que os
//    motores injetam. Nos testes ele é explícito de propósito: uma constante importada
//    esconderia justamente o parâmetro cuja passagem se quer verificar.
const PADRAO = PAST_DUE_GRACE_DAYS

describe("o relógio da carência", () => {
  it("dentro do prazo NÃO passou", () => {
    expect(passouDaCarencia(haDias(3), 7, PADRAO, null, AGORA)).toBe(false)
  })

  it("no dia exato JÁ passou (a carência é de N dias, não N+1)", () => {
    expect(passouDaCarencia(haDias(7), 7, PADRAO, null, AGORA)).toBe(true)
  })

  it("carência 0 corta junto com o degrau 2 — é valor válido, não 'sem valor'", () => {
    expect(passouDaCarencia(haDias(0), 0, PADRAO, null, AGORA)).toBe(true)
  })

  it("carência nula cai no padrão do sistema, nunca em zero", () => {
    expect(passouDaCarencia(haDias(PAST_DUE_GRACE_DAYS - 1), null, PADRAO, null, AGORA)).toBe(false)
    expect(passouDaCarencia(haDias(PAST_DUE_GRACE_DAYS), null, PADRAO, null, AGORA)).toBe(true)
  })

  // 🔴 A assimetria deliberada: fail-CLOSED pela data, fail-OPEN pelo prazo. Sem carimbo o
  //    atraso EXISTE e só a data se perdeu — presumir "acabou de começar" daria carência
  //    infinita a quem tem o carimbo faltando.
  it("sem carimbo trata como PASSADO (senão carimbo faltando = carência infinita)", () => {
    expect(passouDaCarencia(null, 7, PADRAO, null, AGORA)).toBe(true)
    expect(passouDaCarencia("data-podre", 7, PADRAO, null, AGORA)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// A cadeia de resolução: tenant → global → constante
// ═══════════════════════════════════════════════════════════════════════════
// 🔑 Comportamento novo de 12/08 e sem cobertura nenhuma até aqui. Ele decide QUAL número
//    vale, e errar a precedência não quebra nada visível — só corta (ou deixa de cortar) o
//    cliente no dia errado, que é a definição do bug silencioso.
describe("de onde vem o número da carência", () => {
  it("o valor do TENANT vence o global — é pra isso que a coluna existe", () => {
    // Global frouxo (30), tenant apertado (1): o tenant manda.
    expect(passouDaCarencia(haDias(2), 1, 30, null, AGORA)).toBe(true)
    // Global apertado (0), tenant frouxo (10): o tenant manda de novo.
    expect(passouDaCarencia(haDias(2), 10, 0, null, AGORA)).toBe(false)
  })

  it("tenant NULO cai no global (e não na constante)", () => {
    expect(passouDaCarencia(haDias(5), null, 10, null, AGORA)).toBe(false)
    expect(passouDaCarencia(haDias(10), null, 10, null, AGORA)).toBe(true)
  })

  it("tenant com ZERO é valor válido, não 'sem valor' — corta na hora", () => {
    // 🔴 O teste que impede o `?? global` ingênuo: com `||` ou `??` mal posto, o zero do
    //    tenant seria engolido e ele ganharia a carência global que o operador tirou.
    expect(passouDaCarencia(haDias(0), 0, 30, null, AGORA)).toBe(true)
  })

  it("global ZERO também é válido — não escorrega pra constante", () => {
    expect(passouDaCarencia(haDias(0), null, 0, null, AGORA)).toBe(true)
  })

  // 🔴 O global vem do BANCO, e banco devolve coisa estranha. `NaN` era o pior caso:
  //    `now - inicio >= NaN` é sempre `false` ⇒ carência INFINITA, produto de graça pra
  //    todo mundo, sem erro e sem log. Uma coluna estragada não pode virar isso.
  it("global corrompido cai na constante, nunca em carência infinita", () => {
    expect(passouDaCarencia(haDias(90), null, NaN, null, AGORA)).toBe(true)
    expect(passouDaCarencia(haDias(90), null, -5, null, AGORA)).toBe(true)
    expect(passouDaCarencia(haDias(90), null, Infinity, null, AGORA)).toBe(true)
  })

  it("a precedência atravessa a cadeia inteira até o gate de acesso", () => {
    // Mesmo tenant, mesmo carimbo: só o PADRÃO GLOBAL muda — e ele decide se o atendente
    // entra ou não. É o caminho real: platform_settings → motivoDoPaywall → gate por papel.
    const atrasado = base({ subscription_status: "past_due", past_due_since: haDias(3) })
    expect(isTenantBlockedForAccessAs(atrasado, "agent", 10, AGORA)).toBe(false)  // global 10 → ainda na carência
    expect(isTenantBlockedForAccessAs(atrasado, "agent", 1,  AGORA)).toBe(true)   // global 1  → paywall
    // E o dono entra nos dois casos, porque é ele que resolve pagamento.
    expect(isTenantBlockedForAccessAs(atrasado, "owner", 1, AGORA)).toBe(false)
  })
})

describe("o motivo do paywall", () => {
  it("teste vencido é paywall na hora — não há carência pra quem nunca pagou", () => {
    expect(motivoDoPaywall("trial_ended", "active", null, null, PADRAO, null, AGORA)).toBe("trial_ended")
  })

  it("atraso DENTRO da carência ainda não é paywall (é o degrau 2)", () => {
    expect(motivoDoPaywall("active", "past_due", haDias(2), 7, PADRAO, null, AGORA)).toBeNull()
  })

  it("atraso ALÉM da carência vira paywall", () => {
    expect(motivoDoPaywall("active", "past_due", haDias(8), 7, PADRAO, null, AGORA)).toBe("past_due")
  })

  it("assinatura em dia nunca é paywall, mesmo com carimbo residual", () => {
    // Carimbo órfão (invariante 2 da migration): não pode punir quem está pagando.
    expect(motivoDoPaywall("active", "active", haDias(90), 7, PADRAO, null, AGORA)).toBeNull()
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
    expect(motivoDoPaywall("active", "active", null, null, PADRAO, null, AGORA)).toBeNull()
    // Passada a data, a varredura carimba `canceled` ⇒ produto fecha.
    expect(motivoDoPaywall("active", "canceled", null, null, PADRAO, null, AGORA)).toBe("canceled")
  })

  it("no paywall por cancelamento, quem paga ainda entra pra reativar", () => {
    const encerrado = base({ subscription_status: "canceled" })
    expect(isTenantBlockedForAccessAs(encerrado, "owner", PADRAO, AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(encerrado, "admin", PADRAO, AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(encerrado, "agent", PADRAO, AGORA)).toBe(true)
  })

  it("o booleano é derivado do motivo, nunca uma segunda regra", () => {
    for (const sub of ["active", "past_due", "canceled"]) {
      for (const since of [null, haDias(2), haDias(30)]) {
        const m = motivoDoPaywall("active", sub, since, 7, PADRAO, null, AGORA)
        expect(isTenantInPaywall("active", sub, since, 7, PADRAO, null, AGORA)).toBe(m !== null)
      }
    }
  })
})

describe("quem ainda entra", () => {
  const cortado = base({ subscription_status: "past_due", past_due_since: haDias(30), past_due_grace_days: 7 })

  it("dentro da carência TODO MUNDO entra — inclusive o atendente", () => {
    const naCarencia = base({ subscription_status: "past_due", past_due_since: haDias(1), past_due_grace_days: 7 })
    for (const papel of ["owner", "admin", "agent"]) {
      expect(isTenantBlockedForAccessAs(naCarencia, papel, PADRAO, AGORA)).toBe(false)
    }
  })

  it("no paywall entra quem PODE PAGAR e mais ninguém", () => {
    expect(isTenantBlockedForAccessAs(cortado, "owner", PADRAO, AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(cortado, "admin", PADRAO, AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(cortado, "agent", PADRAO, AGORA)).toBe(true)
  })

  it("papel ausente ou desconhecido NÃO entra (o gate não adivinha)", () => {
    expect(isTenantBlockedForAccessAs(cortado, null, PADRAO, AGORA)).toBe(true)
    expect(isTenantBlockedForAccessAs(cortado, "", PADRAO, AGORA)).toBe(true)
    expect(isTenantBlockedForAccessAs(cortado, "viewer", PADRAO, AGORA)).toBe(true)
  })

  it("teste vencido tem a MESMA regra de papel do atraso", () => {
    const teste = base({ lifecycle_state: "trial_ended" })
    expect(isTenantBlockedForAccessAs(teste, "owner", PADRAO, AGORA)).toBe(false)
    expect(isTenantBlockedForAccessAs(teste, "agent", PADRAO, AGORA)).toBe(true)
  })

  // 🔴 A ordem importa: suspenso é decisão HUMANA (degrau 4) e vence o paywall, que é
  //    automático. Se o paywall vencesse, o owner de um tenant suspenso entraria — e
  //    suspender deixaria de suspender.
  it("suspenso barra TODO MUNDO, inclusive quem paga", () => {
    const suspenso = base({ lifecycle_state: "suspended", subscription_status: "past_due", past_due_since: haDias(30) })
    expect(isTenantBlockedForAccessAs(suspenso, "owner", PADRAO, AGORA)).toBe(true)
  })

  it("cliente em dia entra em qualquer papel", () => {
    for (const papel of ["owner", "admin", "agent"]) {
      expect(isTenantBlockedForAccessAs(base(), papel, PADRAO, AGORA)).toBe(false)
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
    for (const c of cenarios) expect(isTenantBlockedForAccessAs(c, "owner", PADRAO, AGORA)).toBe(false)
  })
})

describe("fronteira de acesso manual versus gateway", () => {
  for (const subscription_status of ["past_due", "canceled"] as const) {
    it(`manual ignora ${subscription_status}, mas gateway aplica o estado financeiro`, () => {
      const financeiro = {
        subscription_status,
        past_due_since: subscription_status === "past_due" ? haDias(30) : null,
      }
      const manual = base({ ...financeiro, billing_mode: "manual" })
      const gateway = base({ ...financeiro, billing_mode: "gateway" })

      expect(isTenantBlockedForAccessAs(manual, "agent", PADRAO, AGORA)).toBe(false)
      expect(isTenantBlockedForSpendForTenant(manual)).toBe(false)
      expect(motivoDoPaywallForTenant(manual, PADRAO, AGORA)).toBeNull()

      expect(isTenantBlockedForAccessAs(gateway, "agent", PADRAO, AGORA)).toBe(true)
      expect(isTenantBlockedForSpendForTenant(gateway)).toBe(true)
      expect(motivoDoPaywallForTenant(gateway, PADRAO, AGORA)).toBe(subscription_status)
    })
  }

  it("modo ausente nao recebe o bypass de manual", () => {
    const semModo = {
      ...base({ subscription_status: "canceled" }),
      billing_mode: undefined,
    } as unknown as AcessoDoTenant
    expect(isTenantBlockedForAccessAs(semModo, "agent", PADRAO, AGORA)).toBe(true)
    expect(isTenantBlockedForSpendForTenant(semModo)).toBe(true)
  })

  it("lifecycle administrativo continua bloqueando manual", () => {
    const manualSuspenso = base({ billing_mode: "manual", lifecycle_state: "suspended", subscription_status: "active" })
    expect(isTenantBlockedForAccessAs(manualSuspenso, "owner", PADRAO, AGORA)).toBe(true)
    expect(isTenantBlockedForSpendForTenant(manualSuspenso)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// R2 · A carência deriva do FATO, não do relógio
// ═══════════════════════════════════════════════════════════════════════════
// 🔑 A regra que estes testes trancam: **estorno não é inadimplência.** Inadimplência é
//    falha mecânica (cartão vencido, limite, banco fora) e a carência existe pra absorver
//    isso. Estorno e chargeback são reversão deliberada — o dinheiro VOLTOU. Dar a eles o
//    prazo que existe pra falha mecânica é dar carência a quem desfez o pagamento.
describe("a causa do atraso decide a carência", () => {
  it("🔒 estorno NÃO tem carência — nem com 30 dias configurados no tenant", () => {
    // Carimbo de agora mesmo, carência generosa: mesmo assim, paywall na hora.
    expect(passouDaCarencia(haDias(0), 30, 30, "estorno", AGORA)).toBe(true)
  })

  it("🔒 chargeback idem", () => {
    expect(passouDaCarencia(haDias(0), 30, 30, "chargeback", AGORA)).toBe(true)
  })

  it("atraso comum CONTINUA respeitando a carência — a regra não vazou", () => {
    // 🔑 O teste mais importante do bloco: é ele que prova que a mudança não alcançou o
    //    caminho por onde passam todos os clientes.
    expect(passouDaCarencia(haDias(2), 30, 30, "vencimento", AGORA)).toBe(false)
    expect(passouDaCarencia(haDias(31), 30, 30, "vencimento", AGORA)).toBe(true)
  })

  it("causa DESCONHECIDA cai no caminho normal — erro pro lado de quem paga", () => {
    // ⚠️ É o que os atrasos anteriores ao R1 têm. Presumir estorno neles cortaria cliente
    //    por falta de dado.
    expect(passouDaCarencia(haDias(2), 30, 30, null, AGORA)).toBe(false)
  })

  it("a carência efetiva IGNORA tenant e global no estorno — não é 'o menor dos três'", () => {
    // 🔑 Um operador que deu 30 dias a um cliente grande não quis dizer "30 dias mesmo se
    //    ele estornar". São perguntas diferentes, e por isso zero não negocia.
    expect(carenciaEfetiva("estorno", 30, 30)).toBe(0)
    expect(carenciaEfetiva("chargeback", 90, 90)).toBe(0)
    expect(carenciaEfetiva("vencimento", 7, 1)).toBe(7)
    expect(carenciaEfetiva("vencimento", null, 5)).toBe(5)
    expect(carenciaEfetiva(null, null, 5)).toBe(5)
    // Global corrompido: cai no piso, nunca em infinito.
    expect(carenciaEfetiva("vencimento", null, NaN)).toBe(PAST_DUE_GRACE_DAYS)
  })

  it("atravessa a cadeia até o gate de acesso: estornado fecha na hora", () => {
    const estornado = base({
      subscription_status: "past_due", past_due_since: haDias(0),
      past_due_grace_days: 30, past_due_reason: "estorno",
    })
    const atrasado = base({
      subscription_status: "past_due", past_due_since: haDias(0),
      past_due_grace_days: 30, past_due_reason: "vencimento",
    })
    // Mesmo carimbo, mesma carência configurada — só a CAUSA muda, e ela decide.
    expect(isTenantBlockedForAccessAs(estornado, "agent", 30, AGORA)).toBe(true)
    expect(isTenantBlockedForAccessAs(atrasado,  "agent", 30, AGORA)).toBe(false)
    // E o dono entra nos dois, porque é ele que resolve pagamento.
    expect(isTenantBlockedForAccessAs(estornado, "owner", 30, AGORA)).toBe(false)
  })
})
