"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { Hourglass, Receipt } from "lucide-react"
import { cn } from "@/lib/utils"
import { BILLING_HREF, assuntoDaFatura, linhaDoDocumento, tempoEmAberto } from "./format"
import type { BillingStanding } from "./standing-contract"

// ═══════════════════════════════════════════════════════════════
// C7 · BillingPill — a cobrança como chip do chrome, ao lado do sino
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE ELA EXISTE (pedido do dono, 11/08). A faixa (C1) ocupava uma tira inteira no
//    topo de TODA tela, com título, linha de apoio e as duas listas — em `restricted` isso
//    são ~4 linhas de altura repetidas em cada navegação. E o pior: a informação já estava
//    na tela por baixo dela. No print que originou este pedido, o Studio mostrava a faixa
//    dizendo "Pausado: Automações…" e, dois blocos abaixo, o próprio fluxo dizia "pausado
//    pela fatura em aberto". O mesmo fato, duas vezes, uma delas roubando espaço do
//    trabalho. Aviso repetido não informa melhor — ele treina a pessoa a pular o topo.
//
// 🔑 A REGRA DA ESCADA CONTINUA VALENDO, e é ela que decide o corte: *o aviso sobe de
//    SUPERFÍCIE, nunca de VOLUME*. A pílula é o degrau mais baixo dessa escala de
//    superfície — chip no chrome, do tamanho de um botão de ícone. Onde o produto **ainda
//    funciona** (teste, carência, restrição), chip basta. Onde ele **parou**
//    (`trial_ended`, `paywall`, `readonly`), a faixa fica: ali o aviso não é aviso, é a
//    instrução do que fazer, e escondê-lo num chip seria esconder o estado do produto.
//
// 🔑 UM DESTINO, NENHUM BOTÃO. A pílula não carrega "Pagar agora" — o CTA mora no hero da
//    tela de assinatura, que é pra onde o clique leva. Dois botões de pagar em superfícies
//    diferentes é sempre um deles envelhecendo (foi literalmente o que aconteceu em 06/08,
//    quando o da faixa apontava pro checkout sem plano e o da tela funcionava).
//
// 🔑 O DETALHE APARECE NO HOVER, não no clique: clicar já tem um significado (ir resolver).
//    No toque, onde não há hover, o clique leva à página — que tem tudo isso e mais.
//
// ⚠️ Ícone de RECIBO, nunca ⚠️ ou 🔒 — mesma regra das outras cinco superfícies: fala-se do
//    documento, nunca da pessoa. E a cor aqui é do ESTADO, não do alarme.

type DegrauVisivel = "trial" | "trial_ended" | "grace" | "restricted" | "paywall" | "readonly"

// ⚠️ A régua de quem mostra a faixa mora em `format.ts` (`DEGRAUS_DE_FAIXA`) e não aqui:
//    este módulo é `"use client"`, e constante exportada daqui chega ao servidor como stub
//    de referência, não como valor. Ver o comentário lá — custou um erro em runtime.

const ESTILO: Record<Exclude<DegrauVisivel, "trial">, { pill: string; dot: string }> = {
  // Carência — chrome puro. Nada parou; o chip só marca presença.
  grace:       { pill: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50", dot: "bg-slate-300" },
  // Restrição — âmbar: atenção, não erro.
  restricted:  { pill: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100", dot: "bg-amber-500" },
  // Os três abaixo só chegam aqui se a faixa for suprimida em algum contexto. O chip
  // continua correto e legível — melhor um chip vermelho que nenhum sinal.
  trial_ended: { pill: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100", dot: "bg-red-500" },
  paywall:     { pill: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100", dot: "bg-red-500" },
  readonly:    { pill: "border-slate-800 bg-slate-900 text-white hover:bg-slate-800", dot: "bg-slate-300" },
}

function estiloDoTrial(dias: number): { pill: string; badge: string } {
  if (dias <= 2) {
    return {
      pill: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
      badge: "border-amber-200 bg-white/80 text-amber-800",
    }
  }

  return {
    pill: "border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100",
    badge: "border-primary-100 bg-white/80 text-primary-600",
  }
}

function prazoDoTrial(dias: number): string {
  if (dias <= 0) return "Hoje"
  return dias === 1 ? "1 dia" : `${dias} dias`
}

function dataDoTrial(iso: string | undefined): string | null {
  if (!iso) return null

  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return null

  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(data)
}

/** O rótulo curto do chip. Cabe em ~18 caracteres — é chrome, não frase. */
function rotulo(standing: BillingStanding): string {
  switch (standing.degrau) {
    case "trial":       return "Teste grátis"
    case "trial_ended": return "Teste terminou"
    case "paywall":     return "Acesso pausado"
    case "readonly":    return "Conta em leitura"
    // ⚠️ `grace` e `restricted` dizem a MESMA coisa de propósito: o fato é o mesmo (a
    //    fatura está em aberto) e o que muda entre eles é a consequência — que é
    //    justamente o conteúdo do detalhe abaixo, não do rótulo.
    default:            return "Fatura em aberto"
  }
}

/** O detalhe: o fato, a consequência e o que continua de pé. Mesmo vocabulário da faixa. */
function detalhe(standing: BillingStanding): { titulo: string; apoio: string | null } {
  const { degrau, invoice, nextClosingAt } = standing
  const assunto  = assuntoDaFatura(invoice)
  const emAberto = tempoEmAberto(invoice)

  if (degrau === "trial_ended") {
    return {
      titulo: "Seu teste terminou.",
      apoio: standing.trial?.podeAssinar
        ? "Ative sua assinatura para voltar a usar."
        : "Complete o cadastro da empresa para poder ativar.",
    }
  }
  if (degrau === "trial") {
    const d = standing.trial?.diasRestantes ?? 0
    const ate = dataDoTrial(standing.trial?.endsAt)
    return {
      titulo:
        d <= 0
          ? "Hoje é o último dia do seu teste grátis."
          : d === 1
            ? "Falta 1 dia de teste grátis."
            : `Faltam ${d} dias de teste grátis.`,
      apoio: standing.trial?.podeAssinar
        ? `${ate ? `Seu acesso de teste vai até ${ate}. ` : ""}Escolha um plano para continuar sem interrupção.`
        : "Complete o cadastro da empresa — sem ele não conseguimos emitir a cobrança.",
    }
  }
  if (degrau === "paywall") {
    return {
      titulo: "Seu acesso está pausado por falta de pagamento.",
      apoio: linhaDoDocumento(invoice) || null,
    }
  }
  return {
    titulo: `${assunto} está em aberto${degrau !== "grace" && emAberto ? ` ${emAberto}` : ""}.`,
    apoio: linhaDoDocumento(invoice, nextClosingAt) || null,
  }
}

export function BillingPill({ standing, className }: { standing: BillingStanding; className?: string }) {
  const [aberto, setAberto] = useState(false)
  const tooltipId = useId()

  const { degrau, paused, continues } = standing
  if (degrau === "ok" || degrau === "terminated") return null

  const diasTrial = standing.trial?.diasRestantes ?? 0
  const trial = degrau === "trial"
  const trialStyle = trial ? estiloDoTrial(diasTrial) : null
  const statusStyle = trial ? null : ESTILO[degrau as Exclude<DegrauVisivel, "trial">]
  const { titulo, apoio } = detalhe(standing)

  // ⚠️ Na carência nada parou — listar "o que continua" ali inventaria uma consequência que
  //    ainda não existe (mesma decisão da faixa). Teste idem: nada foi pausado.
  const listar = degrau !== "grace" && degrau !== "trial" && (paused.length > 0 || continues.length > 0)

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setAberto(true)}
      onMouseLeave={() => setAberto(false)}
    >
      <Link
        href={BILLING_HREF}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        aria-label={trial ? `Teste grátis: ${prazoDoTrial(diasTrial)} restante${diasTrial === 1 ? "" : "s"}. Ver planos.` : rotulo(standing)}
        aria-describedby={aberto ? tooltipId : undefined}
        // O chip tem a altura dos outros controles do chrome (size-9 do sino) pra a barra
        // continuar alinhada — ele é um vizinho, não um intruso.
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-nav",
          trialStyle?.pill ?? statusStyle?.pill,
        )}
      >
        {trial ? (
          <Hourglass className="size-3.5 shrink-0" strokeWidth={2} />
        ) : (
          <Receipt className="size-3.5 shrink-0" strokeWidth={2} />
        )}

        {trial ? (
          <>
            <span className="hidden sm:inline">Teste grátis</span>
            <span className="sm:hidden tabular-nums">{diasTrial <= 0 ? "Hoje" : `${diasTrial}d`}</span>
            <span className={cn("hidden rounded-md border px-1.5 py-0.5 font-bold tabular-nums sm:inline", trialStyle?.badge)}>
              {prazoDoTrial(diasTrial)}
            </span>
          </>
        ) : (
          <>
            {/* No mobile sobra o ícone + o ponto: a barra é estreita e o texto seria o primeiro
                a espremer a trilha de navegação. O destino do toque continua igual. */}
            <span className="hidden sm:inline">{rotulo(standing)}</span>
            <span className={cn("size-1.5 shrink-0 rounded-full", statusStyle?.dot)} />
          </>
        )}
      </Link>

      {aberto && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3.5 shadow-soft"
        >
          <p className="text-[13px] font-semibold leading-snug text-slate-900">{titulo}</p>
          {apoio && <p className="mt-0.5 text-[11px] leading-relaxed tabular-nums text-slate-500">{apoio}</p>}

          {listar && (
            <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2.5">
              {paused.length > 0 && (
                <p className="text-[11px] leading-relaxed">
                  <span className="font-semibold text-slate-700">Pausado:</span>{" "}
                  <span className="text-slate-500">{paused.join(" · ")}</span>
                </p>
              )}
              {/* "Continua" nunca é omitido quando existe: é ele que segura o tom. Um aviso
                  que só enumera perdas lê como punição; enumerar o que segue de pé lê como
                  estado. Mesma informação, outra relação com quem lê. */}
              {continues.length > 0 && (
                <p className="text-[11px] leading-relaxed">
                  <span className="font-semibold text-slate-700">Continua:</span>{" "}
                  <span className="text-slate-500">{continues.join(" · ")}</span>
                </p>
              )}
            </div>
          )}

          <p className="mt-2.5 text-[11px] font-semibold text-primary-600">
            {trial ? "Conhecer planos" : "Ver assinatura"} →
          </p>
        </div>
      )}
    </div>
  )
}
