"use client"

import { CalendarClock, CreditCard, Download, FileText } from "lucide-react"
import Link from "next/link"
import { brl, dataLonga, plural } from "../format"
import type { BillingStanding, ContaDoMes } from "../types"

// ═══════════════════════════════════════════════════════════════
// StandingHero — UMA frase e UMA data
// ═══════════════════════════════════════════════════════════════
// DECISÃO CENTRAL DA TELA: a pergunta "está tudo em dia?" não pode exigir
// leitura. O cliente entra, o olho bate no bloco de cima e ele já sabe — cor +
// frase, meio segundo. Por isso:
//
// 1. NADA compete com a frase. Sem KPI, sem badge de plano, sem gráfico acima
//    dela. O plano e a forma de pagamento são metadado (text-xs slate-400) —
//    ninguém abre esta tela pra descobrir que assinou o Pro.
// 2. A cor mora na PRIMEIRA oração (e num filete na borda), não num fundo
//    inteiro. Card vermelho de ponta a ponta grita antes de informar, e a
//    escada de inadimplência precisa do contrário: informar sem assustar.
// 3. Vermelho SÓ quando algo parou (degraus 3+). Atraso dentro da carência é
//    âmbar: nada parou, então nada deveria parecer parado.
// 4. Dinheiro e data em negrito dentro da frase — são as duas coisas que ele
//    vai repetir pra alguém ("são 570 e vence dia 6").

type Tom = "ok" | "atencao" | "parado" | "encerrado"

const TOM: Record<Tom, { rail: string; lead: string }> = {
  ok:        { rail: "border-l-emerald-500", lead: "text-emerald-700" },
  atencao:   { rail: "border-l-amber-500",   lead: "text-amber-700" },
  parado:    { rail: "border-l-red-500",     lead: "text-red-700" },
  encerrado: { rail: "border-l-slate-400",   lead: "text-slate-600" },
}

/** A frase do degrau. Fonte única — B1 e a faixa da tela cheia usam esta. */
export function fraseDoDegrau(standing: BillingStanding, conta: ContaDoMes): {
  tom: Tom; lead: string; tail: React.ReactNode
} {
  const forte = (t: string) => <span className="font-bold text-slate-900">{t}</span>
  const inv   = standing.invoice

  switch (standing.degrau) {
    case "ok":
      return {
        tom: "ok", lead: "Tudo certo.",
        tail: standing.nextClosingAt ? (
          <>Sua próxima fatura de {forte(brl(conta.totalCents))} fecha em {forte(dataLonga(standing.nextClosingAt))}.</>
        ) : <>Sua assinatura está em dia.</>,
      }

    case "grace":
      return {
        tom: "atencao",
        lead: inv ? `Sua fatura de ${brl(inv.totalCents)} venceu há ${plural(inv.daysOverdue, "dia")}.` : "Sua fatura está em aberto.",
        tail: <>Nada mudou por enquanto — tudo continua funcionando normalmente.</>,
      }

    case "restricted":
      return {
        tom: "parado",
        lead: "Campanhas, automações e IA estão pausadas.",
        tail: inv ? (
          <>A fatura de {forte(brl(inv.totalCents))} venceu há {forte(plural(inv.daysOverdue, "dia"))}. Seu atendimento, seus contatos e seu histórico seguem no ar.</>
        ) : <>Seu atendimento e seus dados seguem no ar.</>,
      }

    case "readonly":
      return {
        tom: "parado",
        lead: "Sua conta está em modo leitura.",
        tail: inv ? (
          <>A fatura de {forte(brl(inv.totalCents))} venceu há {forte(plural(inv.daysOverdue, "dia"))}. Você continua vendo tudo e pode exportar seus dados quando quiser.</>
        ) : <>Você continua vendo tudo e pode exportar seus dados quando quiser.</>,
      }

    case "terminated":
      return {
        tom: "encerrado",
        lead: "Sua assinatura foi encerrada.",
        tail: <>Seus dados ficam guardados e disponíveis pra download por mais 90 dias.</>,
      }
  }
}

export function StandingHero({
  standing, conta, planoNome, formaPagamento, cicloDia,
  onPagar, onMaisDias, adiamentoUsado, onExportar,
}: {
  standing:        BillingStanding
  conta:           ContaDoMes
  planoNome:       string
  formaPagamento:  string
  cicloDia:        number | null
  onPagar:         () => void
  onMaisDias:      () => void
  adiamentoUsado:  boolean
  onExportar:      () => void
}) {
  const { tom, lead, tail } = fraseDoDegrau(standing, conta)
  const t     = TOM[tom]
  const inv   = standing.invoice
  const fim   = standing.degrau === "terminated"

  return (
    <section className={`bg-white rounded-xl border border-slate-200 border-l-[3px] ${t.rail} shadow-card px-5 sm:px-6 py-5`}>
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <p className="text-lg sm:text-xl leading-snug tracking-tight max-w-2xl">
            <span className={`font-bold ${t.lead}`}>{lead}</span>{" "}
            <span className="font-normal text-slate-500">{tail}</span>
          </p>

          {/* Metadado — deliberadamente miúdo. Ele não é a resposta da tela. */}
          <p className="text-xs text-slate-400 mt-2.5 flex items-center gap-1.5 flex-wrap">
            <span>Plano {planoNome}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1"><CreditCard className="size-3" /> {formaPagamento}</span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" /> {cicloDia ? `cobrança todo dia ${cicloDia}` : "cobrança a definir"}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {inv && !fim && (
            <button type="button" onClick={onPagar} className={BTN_PRIMARY_LG}>
              Pagar {brl(inv.totalCents)}
            </button>
          )}

          {/* Recurso de PRODUTO, não exceção de suporte: fica ao lado do pagar,
              com a mesma dignidade visual de um botão de verdade. */}
          {inv && !fim && (
            <button type="button" onClick={onMaisDias} disabled={adiamentoUsado} title={adiamentoUsado ? "Você já usou este ciclo" : undefined} className={BTN_WHITE_LG}>
              Preciso de mais alguns dias
            </button>
          )}

          {fim && (
            <button type="button" onClick={onExportar} className={BTN_PRIMARY_LG}>
              <Download className="size-4" /> Baixar meus dados
            </button>
          )}

          {inv && (
            <Link href={`/configuracoes/assinatura/faturas/${inv.id}`} className={BTN_WHITE_LG}>
              <FileText className="size-3.5" /> Ver fatura
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

const BTN_PRIMARY_LG = "inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
const BTN_WHITE_LG   = "inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-white"
