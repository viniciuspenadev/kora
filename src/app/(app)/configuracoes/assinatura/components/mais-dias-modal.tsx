"use client"

import { useState } from "react"
import { CalendarPlus, Check } from "lucide-react"
import { BTN_GHOST, BTN_PRIMARY, ModalShell } from "./modal-shell"
import { dataLonga, diasAte, plural } from "../format"

// ═══════════════════════════════════════════════════════════════
// Modal "Preciso de mais alguns dias"
// ═══════════════════════════════════════════════════════════════
// DECISÃO: isto é RECURSO DE PRODUTO, não exceção de suporte — e a tela precisa
// dizer isso em cada detalhe. Nada de formulário de justificativa, nada de
// "sujeito a análise", nada de tom de favor. Quem está com o caixa apertado já
// está constrangido; fazer ele pedir por escrito pra um humano é o desenho que
// transforma atraso de 5 dias em cancelamento.
//
// Três coisas obrigatórias na tela:
//   • o que ele GANHA, em data ("nada é pausado até 16 de agosto");
//   • o que NÃO muda (a fatura continua a mesma — adiar não é perdoar);
//   • o limite (1× por ciclo), dito antes do clique, não depois.
//
// O botão diz a data de destino, não "confirmar": o cliente sai da tela sabendo
// o dia que precisa lembrar.

export function MaisDiasModal({
  novaData, jaUsou, temPausado = false, onClose, onConfirmar,
}: {
  novaData:    string
  jaUsou:      boolean
  /** Já há algo pausado (degrau 3+)? Então adiar RELIGA, não só segura. */
  temPausado?: boolean
  onClose:     () => void
  onConfirmar: () => void
}) {
  const [feito, setFeito] = useState(false)
  const dias = Math.max(1, diasAte(novaData))

  return (
    <ModalShell
      icon={CalendarPlus}
      accent="bg-amber-50 text-amber-600"
      title="Preciso de mais alguns dias"
      desc="Uma vez por ciclo, sem falar com ninguém"
      onClose={onClose}
      footer={
        feito ? (
          <button type="button" onClick={onClose} className={BTN_PRIMARY}>Entendi</button>
        ) : (
          <>
            <button type="button" onClick={onClose} className={BTN_GHOST}>Agora não</button>
            <button
              type="button"
              disabled={jaUsou}
              onClick={() => { setFeito(true); onConfirmar() }}
              className={BTN_PRIMARY}
            >
              Adiar até {dataLonga(novaData)}
            </button>
          </>
        )
      }
    >
      {feito ? (
        <div className="text-center py-2">
          <span className="size-10 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center mx-auto">
            <Check className="size-5" />
          </span>
          <p className="text-sm font-semibold text-slate-900 mt-3">Combinado.</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Nada é pausado até <span className="font-semibold text-slate-700">{dataLonga(novaData)}</span>.
            A gente te lembra um dia antes, por e-mail.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          <p className="text-sm text-slate-600 leading-relaxed">
            {temPausado ? (
              <>Religa <span className="font-semibold text-slate-900">agora</span> o que a fatura em aberto pausou —
              campanhas, automações e IA — e segura por mais <span className="font-semibold text-slate-900">{plural(dias, "dia")}</span>.</>
            ) : (
              <>Segura por mais <span className="font-semibold text-slate-900">{plural(dias, "dia")}</span> tudo que a fatura
              em aberto causaria: campanhas, automações e IA continuam funcionando normalmente.</>
            )}
          </p>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">Nada é pausado até</p>
            <p className="text-xl font-bold text-slate-900 leading-none mt-1.5">{dataLonga(novaData)}</p>
          </div>

          <ul className="text-xs text-slate-500 space-y-1.5 leading-relaxed">
            <li className="flex gap-2"><span className="text-slate-300">•</span> O valor da fatura não muda — adiar não é desconto.</li>
            <li className="flex gap-2"><span className="text-slate-300">•</span> Vale uma vez por ciclo de cobrança.</li>
            <li className="flex gap-2"><span className="text-slate-300">•</span> Pode pagar antes a qualquer momento; o adiamento simplesmente não é usado.</li>
          </ul>

          {jaUsou && (
            <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2.5">
              <p className="text-xs text-amber-800 leading-relaxed">
                Você já usou o adiamento neste ciclo. Ele volta a ficar disponível na próxima fatura —
                se precisar de mais prazo agora, fale com a gente pelo WhatsApp.
              </p>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}
