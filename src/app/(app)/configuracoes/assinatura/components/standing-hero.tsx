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
export function fraseDoDegrau(
  standing: BillingStanding,
  conta: ContaDoMes,
  /** Verdade do gateway (valor e data reais). `null` ⇒ usa a projeção local. */
  cobranca?: { valorCents: number; proximaEm: string | null } | null,
): {
  tom: Tom; lead: string; tail: React.ReactNode
} {
  const forte = (t: string) => <span className="font-bold text-slate-900">{t}</span>
  const inv   = standing.invoice

  switch (standing.degrau) {
    case "trial": {
      const t = standing.trial
      const dias = t?.diasRestantes ?? 0
      return {
        // ⚠️ Âmbar, nunca verde. Verde diria "não precisa fazer nada" — e precisa: no
        //    vencimento o acesso é cortado. Também não é vermelho: nada parou ainda, e
        //    assustar quem está experimentando o produto é o jeito mais rápido de perdê-lo.
        tom: "atencao",
        lead: dias <= 1 ? "Seu teste termina hoje." : `Seu teste termina em ${plural(dias, "dia")}.`,
        tail: t?.podeAssinar
          ? <>Depois de {forte(dataLonga(t.endsAt))} o acesso é interrompido até você ativar a assinatura.</>
          // 🔴 A pessoa PRECISA saber que não é só clicar em pagar — sem documento, CEP e
          //    número a tokenização do cartão falha. Descobrir isso com o cartão na mão,
          //    no último dia, é perder o cliente por burocracia nossa.
          : <>Antes de assinar, complete o cadastro da sua empresa — sem ele não conseguimos emitir a cobrança.</>,
      }
    }

    case "trial_ended":
      return {
        // Vermelho: alguma coisa PAROU de verdade. Âmbar seria suavizar um fato duro.
        tom: "parado",
        lead: "Seu teste terminou.",
        tail: standing.trial?.podeAssinar
          ? <>Ative sua assinatura para voltar a usar o Kora — seus dados e conversas estão intactos.</>
          // 🔴 Sem cadastro fiscal ele não CONSEGUE pagar. Dizer "ative" aqui mandaria a
          //    pessoa bater numa porta que a gente já sabe que não abre.
          : <>Complete o cadastro da sua empresa para poder ativar — seus dados e conversas estão intactos.</>,
      }

    case "ok": {
      // 🔴 A FRASE ERRAVA OS DOIS NÚMEROS (achado do dono, 06/08). Ela usava
      //    `conta.totalCents` (preço ATUAL do plano) e `nextClosingAt` (projeção do
      //    `billing_day`) — e anunciou *"próxima fatura de R$ 599,90 fecha em 11 de agosto"*
      //    para uma assinatura congelada em R$ 5,00 que cobra em 11 de SETEMBRO.
      //    O valor errava porque mudar o preço do plano não viaja pro gateway; a data
      //    errava porque a projeção não sabia que aquela cobrança já tinha sido paga
      //    adiantada.
      // 🔑 Havendo assinatura no gateway, ele é a fonte: é ele que debita o cartão.
      //    Sem ela (cliente manual/legado) ou se o Asaas não responder, cai na projeção —
      //    imprecisa, mas é o melhor que se sabe.
      const valor = cobranca?.valorCents ?? conta.totalCents
      const quando = cobranca?.proximaEm ?? standing.nextClosingAt
      return {
        tom: "ok", lead: "Tudo certo.",
        tail: quando ? (
          <>Sua próxima fatura de {forte(brl(valor))} fecha em {forte(dataLonga(quando))}.</>
        ) : <>Sua assinatura está em dia.</>,
      }
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

    // Degrau 3 — a carência acabou e o produto fechou. Quem lê isto é o responsável: ele é
    // o único que ainda entra, e a tela dele é esta.
    // ⚠️ NÃO reusa a frase de `restricted` (*"seu atendimento segue no ar"*): aqui o
    //    atendimento parou e a equipe está do lado de fora. Prometer o contrário de dentro
    //    de um app trancado é o defeito que separou `trial_ended` de `restricted` em 05/08.
    case "paywall":
      return {
        tom: "parado",
        lead: "Seu acesso está pausado por falta de pagamento.",
        tail: inv ? (
          <>A fatura de {forte(brl(inv.totalCents))} venceu há {forte(plural(inv.daysOverdue, "dia"))}. Regularize para reabrir o atendimento e o acesso da sua equipe — seus dados e conversas estão intactos.</>
        ) : <>Regularize para reabrir o atendimento e o acesso da sua equipe — seus dados e conversas estão intactos.</>,
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
  standing, conta, cobranca, planoNome, formaPagamento, cicloDia,
  onPagar, onMaisDias, adiamentoUsado, onExportar,
}: {
  standing:        BillingStanding
  cobranca?:       { valorCents: number; proximaEm: string | null } | null
  conta:           ContaDoMes
  planoNome:       string
  formaPagamento:  string
  cicloDia:        number | null
  onPagar:         () => void
  onMaisDias:      () => void
  adiamentoUsado:  boolean
  onExportar:      () => void
}) {
  const { tom, lead, tail } = fraseDoDegrau(standing, conta, cobranca)
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
          {/* ⚠️ O botão do teste leva pra onde a pessoa CONSEGUE agir. Com cadastro
              completo, pro cartão; sem ele, pro cadastro — porque mandar pro checkout
              quem não consegue pagar é fazer a pessoa digitar o cartão inteiro pra
              receber um erro que a gente já sabia. */}
          {standing.degrau === "trial" && (
            standing.trial?.podeAssinar ? (
              // 🔑 Vai pro CATÁLOGO, não direto pro cartão. O checkout precisa saber QUAL
              //    plano cobrar, e desde 05/08 esse dado não mora mais no tenant antes da
              //    contratação — quem está em teste ainda não escolheu nada.
              <Link href="/configuracoes/assinatura/planos" className={BTN_PRIMARY_LG}>
                <CreditCard className="size-4" /> Ativar assinatura
              </Link>
            ) : (
              <Link href="/configuracoes/empresa" className={BTN_PRIMARY_LG}>
                Completar cadastro
              </Link>
            )
          )}

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
