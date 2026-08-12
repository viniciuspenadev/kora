"use client"

import { useState, useTransition } from "react"
import { CalendarClock, Check, Loader2, Lock, Database, RotateCcw } from "lucide-react"
import { ModalShell, BTN_WHITE } from "./modal-shell"
import { cancelarAssinatura } from "@/lib/actions/subscription"
import { dataLonga } from "../format"

// ═══════════════════════════════════════════════════════════════
// CancelarModal — a porta de saída que não existia
// ═══════════════════════════════════════════════════════════════
// 🔴 ATÉ 11/08 O PRODUTO NÃO TINHA SAÍDA. Para cancelar, a pessoa entrava no painel do
//    Asaas ou falava com a gente. Prender a saída não retém ninguém — empurra pro
//    chargeback, que é o pior desfecho para os dois lados (ele perde tempo, nós perdemos
//    o dinheiro E a taxa, e a relação acaba mal).
//
// 🔑 O QUE ESTE MODAL PRECISA FAZER, e é mais que confirmar: **explicar que cancelar não
//    tira o que já foi pago.** É a dúvida real de quem clica ali — "perco agora?". Um
//    "tem certeza?" seco deixaria a pessoa desistir por medo, ou cancelar achando que
//    perdeu o mês. Por isso ele não usa o `DangerConfirm` (corpo `text-xs` indentado,
//    feito pra pergunta curta) e sim a casca dos modais de cobrança.
//
// 🎯 O HERÓI É A DATA (design-system §0.5.1): a informação que decide o clique é ATÉ
//    QUANDO ele continua com tudo. Ela é o maior elemento do corpo; o resto serve a ela.

export function CancelarModal({
  open, onClose, planoNome, cicloFechaEm, onCancelado,
}: {
  open:          boolean
  onClose:       () => void
  planoNome:     string
  /** Fechamento do ciclo atual, como a tela já exibe. `null` = sem dia definido. */
  cicloFechaEm:  string | null
  onCancelado:   (ateQuando: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  if (!open) return null

  function confirmar() {
    setErro(null)
    startTransition(async () => {
      const r = await cancelarAssinatura()
      if (r.error) { setErro(r.error); return }
      onCancelado(r.ateQuando ?? "")
      onClose()
    })
  }

  return (
    <ModalShell
      title="Cancelar assinatura"
      desc={planoNome}
      icon={CalendarClock}
      accent="bg-amber-50 text-amber-600"
      size="lg"
      onClose={pending ? () => {} : onClose}
      dismissable={!pending}
      closeButton
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={BTN_WHITE}>
            {/* ⚠️ NÃO chamar este botão de "Cancelar". Num modal de cancelamento, "Cancelar"
                é ambíguo — cancela a assinatura ou cancela a ação? O rótulo diz o que
                acontece se clicar, e o que acontece é a assinatura CONTINUAR. */}
            Manter assinatura
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Continuar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ── O HERÓI: até quando ele continua com tudo ──────────────────── */}
        {/* Borda definida em vez de sombra (§0.5.3): cara de documento, não de cartãozinho. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Você continua com tudo
          </p>
          {/* ⚠️ "até o fim do ciclo" e NÃO a data crua do fechamento: o acesso vale até o
              último dia do período PAGO, que é um dia antes do fechamento do próximo.
              Cravar aqui a data que a tela mostra prometeria 24h que o servidor não dá —
              e promessa de acesso é exatamente o que não pode divergir. A data exata sai
              do servidor e aparece na confirmação. */}
          <p className="text-lg font-bold text-slate-900 leading-tight mt-0.5">
            até o fim do ciclo que você já pagou
          </p>
          {cicloFechaEm && (
            <p className="text-xs text-slate-500 mt-1">
              Seu ciclo atual fecha em {dataLonga(cicloFechaEm)}.
            </p>
          )}
        </div>

        {/* ── O que acontece, em ordem de tempo ──────────────────────────── */}
        <ul className="space-y-2.5">
          <li className="flex items-start gap-2.5">
            <Check className="size-4 mt-0.5 shrink-0 text-emerald-600" strokeWidth={2.5} />
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Até lá, nada muda.</span>{" "}
              Campanhas, automações, IA e atendimento seguem funcionando normalmente. Não há
              nova cobrança no seu cartão.
            </p>
          </li>
          <li className="flex items-start gap-2.5">
            <Lock className="size-4 mt-0.5 shrink-0 text-slate-400" strokeWidth={2.25} />
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Depois dessa data, o produto fecha.</span>{" "}
              O acesso à plataforma é encerrado até você contratar de novo.
            </p>
          </li>
          <li className="flex items-start gap-2.5">
            <Database className="size-4 mt-0.5 shrink-0 text-slate-400" strokeWidth={2.25} />
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Seus dados continuam guardados.</span>{" "}
              Conversas, contatos e histórico não são apagados — se voltar, está tudo lá.
            </p>
          </li>
          {/* 🔑 A SAÍDA DIZ QUE TEM VOLTA (11/08). Não é retenção disfarçada: é informação
              que muda a decisão de quem está em dúvida, e a alternativa — descobrir só
              depois que dava pra voltar — é o que faz alguém abrir ticket ou disputa. O
              cartão fica guardado exatamente até a data acima: é isso que torna a volta
              um clique. */}
          <li className="flex items-start gap-2.5">
            <RotateCcw className="size-4 mt-0.5 shrink-0 text-slate-400" strokeWidth={2.25} />
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Dá pra voltar atrás até lá.</span>{" "}
              Enquanto o ciclo não fechar, um botão de <span className="font-medium">Retomar assinatura</span>{" "}
              fica nesta tela — sem informar o cartão de novo e sem cobrança extra.
            </p>
          </li>
        </ul>

        {/* ── A parte que ninguém gosta de ler, e por isso tem que estar clara ── */}
        <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
          O período já pago não é devolvido — ele é seu até o último dia, e é por isso que o
          acesso continua. Depois dessa data, voltar significa contratar de novo, com o ciclo
          começando no dia do pagamento.
        </p>

        {erro && (
          <div className="rounded-lg bg-danger-bg border border-red-100 px-3.5 py-2.5">
            <p className="text-xs text-red-800">{erro}</p>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
