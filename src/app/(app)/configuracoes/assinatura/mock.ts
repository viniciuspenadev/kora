// ═══════════════════════════════════════════════════════════════
// Dados de exemplo das telas de assinatura
// ═══════════════════════════════════════════════════════════════
// 🔴 TODO(dev): substituir por `getBillingStanding()` + as queries reais.
// Nada aqui vai pra produção — é fixture de DESIGN. As datas são relativas a
// hoje de propósito: uma tela de cobrança revisada em outubro com "vence em
// 6 de setembro" mente sobre o próprio estado e desperdiça a revisão.
//
// Pra revisar os cinco degraus sem banco: `?degrau=grace|restricted|readonly|terminated`.

import type {
  AssinaturaResumo, BillingDegrau, BillingStanding, ContaDoMes,
  Fatura, LinhaDiscreta, LinhaMedida,
} from "./types"
import { dataCurta, mesDe, parseData } from "./format"

const DIA = 86_400_000
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const emDias = (n: number, base = new Date()) => iso(new Date(base.getTime() + n * DIA))

/** Dia 6 do mês que vem — o fechamento do ciclo. */
function proximoFechamento(base = new Date()): string {
  return iso(new Date(base.getFullYear(), base.getMonth() + 1, 6))
}

export function parseDegrau(v: string | string[] | undefined): BillingDegrau {
  const s = Array.isArray(v) ? v[0] : v
  return s === "trial" || s === "trial_ended" || s === "grace" || s === "restricted" || s === "readonly" || s === "terminated" ? s : "ok"
}

/** Atraso típico de cada degrau — a escada do docs/access-revocation-design.md §2. */
// `trial` não tem atraso: não existe fatura em teste. Zero é o valor honesto.
const ATRASO: Record<BillingDegrau, number> = { trial: 0, trial_ended: 0, ok: 0, grace: 3, restricted: 9, readonly: 21, terminated: 47 }

// ── O que continua × o que parou (LINGUAGEM DE RESULTADO) ──────
// A metade que CONTINUA é tão importante quanto a que parou: é ela que
// responde "eu ainda consigo tocar meu negócio hoje?".
const TUDO = [
  "Atendimento no WhatsApp", "Instagram Direct", "Contatos e histórico",
  "Agenda", "Negócios", "Campanhas", "Inteligência artificial", "Automações",
  "Relatórios", "Exportar seus dados",
]
const GASTA = ["Campanhas", "Inteligência artificial", "Automações"]

function escada(degrau: BillingDegrau): Pick<BillingStanding, "paused" | "continues"> {
  if (degrau === "ok" || degrau === "grace") return { paused: [], continues: TUDO }
  if (degrau === "restricted") return { paused: GASTA, continues: TUDO.filter((x) => !GASTA.includes(x)) }
  if (degrau === "readonly") {
    const segue = ["Contatos e histórico", "Relatórios", "Exportar seus dados"]
    return { paused: TUDO.filter((x) => !segue.includes(x)), continues: segue }
  }
  return { paused: TUDO.filter((x) => x !== "Exportar seus dados"), continues: ["Exportar seus dados"] }
}

export interface AssinaturaMock {
  standing:     BillingStanding
  /** Módulos que a conta REALMENTE tem, pelo nome do catálogo. Ver `subscription-view`. */
  incluso:      string[]
  /** O que o gateway vai cobrar e quando. `null` ⇒ tela usa a projeção local. */
  cobranca:     { valorCents: number; proximaEm: string | null } | null
  /** Tem assinatura real no gateway? Governa a porta de "Trocar cartão". */
  temAssinatura: boolean
  resumo:       AssinaturaResumo
  conta:        ContaDoMes
  medidas:      LinhaMedida[]
  discretas:    LinhaDiscreta[]
  faturaAberta: Fatura | null
  faturas:      Fatura[]
}

export function buildMock(degrau: BillingDegrau = "ok"): AssinaturaMock {
  const hoje       = new Date()
  const atraso     = ATRASO[degrau]
  const vencimento = emDias(-atraso, hoje)
  const fechaEm    = proximoFechamento(hoje)
  const parado     = degrau === "restricted" || degrau === "readonly" || degrau === "terminated"

  // Fatura em aberto (existe do degrau 2 em diante).
  const faturaAberta: Fatura | null = degrau === "ok" ? null : {
    id:            "inv_2026_08",
    referencia:    `${mesDe(vencimento)}/${parseData(vencimento).getFullYear()}`,
    periodoInicio: emDias(-atraso - 31, hoje),
    periodoFim:    emDias(-atraso - 1, hoje),
    vencimento,
    status:        "overdue",
    totalCents:    61420,
    pixCopiaECola: "00020126580014BR.GOV.BCB.PIX0136f1a2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d5204000053039865802BR5913KORA SISTEMAS6009SAO PAULO62070503***6304A1B2",
    linhas: [
      {
        key: "plano", kind: "plan", titulo: "Plano Pro — mensalidade",
        detalhe: `Período de ${dataCurta(emDias(-atraso - 31, hoje))} a ${dataCurta(emDias(-atraso - 1, hoje))}`,
        qtd: 1, unitCents: 44990, totalCents: 44990,
      },
      {
        key: "users", kind: "overage", titulo: "3 usuários acima da cota do plano",
        detalhe: "R$ 39,90 por usuário/mês · o plano inclui 5",
        qtd: 3, unitCents: 3990, totalCents: 11970,
        evidencia: [
          { quem: "Marcos Vieira",  quando: dataCurta(emDias(-atraso - 24, hoje)), detalhe: "atendente" },
          { quem: "Ana Prado",      quando: dataCurta(emDias(-atraso - 24, hoje)), detalhe: "atendente" },
          { quem: "Júlia Neves",    quando: dataCurta(emDias(-atraso - 17, hoje)), detalhe: "administradora" },
        ],
      },
      {
        key: "ia", kind: "overage", titulo: "892 respostas da IA além das 5.000 incluídas",
        detalhe: "R$ 0,05 por resposta",
        qtd: 892, unitCents: 5, totalCents: 4460,
        evidencia: [
          { quem: `${dataCurta(emDias(-atraso - 21, hoje))} — campanha de retorno`, detalhe: "412 respostas" },
          { quem: `${dataCurta(emDias(-atraso - 14, hoje))} — pico de atendimento`, detalhe: "287 respostas" },
          { quem: `${dataCurta(emDias(-atraso - 6,  hoje))} — plantão de sábado`,   detalhe: "193 respostas" },
        ],
      },
    ],
  }

  const standing: BillingStanding = {
    degrau,
    invoice: faturaAberta
      ? { id: faturaAberta.id, totalCents: faturaAberta.totalCents, dueDate: vencimento, daysOverdue: atraso }
      : null,
    nextClosingAt: fechaEm,
    // Prévia do degrau 0: 2 dias e cadastro INCOMPLETO — é o pior caso e o que mais
    // precisa ser revisado, porque é nele que o cliente descobre que não consegue pagar.
    trial: degrau === "trial"
      ? { endsAt: emDias(2, hoje), diasRestantes: 2, podeAssinar: false }
      : null,
    ...escada(degrau),
  }

  // ── Consumo do ciclo corrente ────────────────────────────────
  // Três estados de propósito, porque são as três perguntas do cliente:
  // já virou dinheiro (usuários) · VAI virar (IA) · não vai (disparos).
  const medidas: LinhaMedida[] = [
    {
      key: "users", label: "Usuários", unidade: "usuário",
      usado: 8, cota: 5, precoUnitCents: 3990,
      excedente: 3, excedenteCents: 11970, projecaoCents: 11970,
      evidencia: [
        { quem: "Marcos Vieira", quando: dataCurta(emDias(-23, hoje)) },
        { quem: "Ana Prado",     quando: dataCurta(emDias(-23, hoje)) },
        { quem: "Júlia Neves",   quando: dataCurta(emDias(-16, hoje)) },
      ],
    },
    {
      key: "ia", label: "Inteligência artificial", unidade: "resposta",
      usado: 4_120, cota: 5_000, precoUnitCents: 5,
      excedente: 0, excedenteCents: 0, projecaoCents: 7_900,
      parou: parado,
    },
    {
      key: "broadcasts", label: "Disparos de campanha", unidade: "disparo",
      usado: 7_320, cota: 10_000, precoUnitCents: 4,
      excedente: 0, excedenteCents: 0, projecaoCents: 0,
      parou: parado,
    },
  ]

  const conta: ContaDoMes = {
    planoLabel: "Plano Pro",
    planoCents: 44990,
    extras: [{ label: "3 usuários além da cota", cents: 11970 }],
    totalCents: 56960,
    fechaEm,
  }

  const discretas: LinhaDiscreta[] = [
    { key: "contacts",   label: "Contatos",              usado: 3_482, cota: 50_000, textoUso: "3.482 de 50.000" },
    { key: "conversas",  label: "Conversas no mês",      usado: 4_120, cota: 30_000, textoUso: "4.120 de 30.000" },
    {
      key: "storage", label: "Armazenamento", usado: 12_400, cota: 20_000, textoUso: "12,4 GB de 20 GB",
      detalhe: [
        { label: "Conversas e mídia", texto: "9,1 GB" },
        { label: "Campanhas",         texto: "2,1 GB" },
        { label: "Catálogo",          texto: "1,2 GB" },
      ],
    },
    { key: "numeros",    label: "Números conectados",    usado: 2,  cota: 3,   textoUso: "2 de 3" },
    { key: "automacoes", label: "Automações publicadas", usado: 23, cota: 150, textoUso: "23 de 150" },
  ]

  const pago = (mesesAtras: number, totalCents: number, id: string): Fatura => {
    const venc   = iso(new Date(hoje.getFullYear(), hoje.getMonth() - mesesAtras, 6))
    const inicio = iso(new Date(hoje.getFullYear(), hoje.getMonth() - mesesAtras - 1, 6))
    const fim    = iso(new Date(hoje.getFullYear(), hoje.getMonth() - mesesAtras, 5))
    const extra  = totalCents - 44990
    return {
      id, referencia: `${mesDe(venc)}/${parseData(venc).getFullYear()}`,
      periodoInicio: inicio, periodoFim: fim,
      vencimento: venc, status: "paid", totalCents,
      linhas: [
        {
          key: "plano", kind: "plan", titulo: "Plano Pro — mensalidade",
          detalhe: `Período de ${dataCurta(inicio)} a ${dataCurta(fim)}`,
          qtd: 1, unitCents: 44990, totalCents: 44990,
        },
        ...(extra > 0 ? [{
          key: "users" as const, kind: "overage" as const,
          titulo: `${Math.round(extra / 3990)} usuários acima da cota do plano`,
          detalhe: "R$ 39,90 por usuário/mês · o plano inclui 5",
          qtd: Math.round(extra / 3990), unitCents: 3990, totalCents: extra,
        }] : []),
      ],
      pixCopiaECola: "", pagoEm: venc, formaPagamento: "Pix",
    }
  }

  const faturas = [
    ...(faturaAberta ? [faturaAberta] : []),
    pago(1, 56960, "inv_2026_07"),
    pago(2, 48980, "inv_2026_06"),
    pago(3, 44990, "inv_2026_05"),
  ]

  const resumo: AssinaturaResumo = {
    planoNome: "Pro", planoCents: 44990, cicloDia: 6,
    formaPagamento: "Pix automático", emailCobranca: "financeiro@empresa.com.br",
    adiamentoUsado: false,
    adiamentoAte: faturaAberta ? emDias(-atraso + 12, hoje) : null,
  }

  // ⚠️ A prévia (`?degrau=`) usa os mesmos rótulos do mock — ela existe pra revisar os
  //    5 estados da escada, não pra refletir o catálogo real de um tenant.
  // ⚠️ `temAssinatura: true` na PRÉVIA: o modo `?degrau=` existe pra revisar as telas dos
  //    degraus, e esconder a porta de trocar cartão ali tiraria justamente uma das coisas
  //    que o platform admin precisa conferir.
  return { standing, incluso: TUDO, cobranca: null, temAssinatura: true, resumo, conta, medidas, discretas, faturaAberta, faturas }
}
