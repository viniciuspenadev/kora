"use client"

import { Check, Download, Eye, Lock } from "lucide-react"
import { brl, dataLonga, plural } from "../format"
import type { BillingStanding } from "../types"

// ═══════════════════════════════════════════════════════════════
// Degrau 4 — a tela cheia do bloqueio
// ═══════════════════════════════════════════════════════════════
// DECISÃO: esta é a tela mais fácil de desenhar errado do produto inteiro,
// porque a tentação é usá-la como alavanca de cobrança. Quatro escolhas
// deliberadas contra isso:
//
// 1. "Continuar em modo leitura" é BOTÃO, do mesmo tamanho do "Pagar", não link
//    cinza no rodapé. Modal que só tem uma saída não é aviso, é sequestro — e
//    quem se sente sequestrado não paga: reclama, tuíta e cancela.
// 2. "Baixar meus dados" tem CARTÃO PRÓPRIO e destaque. É direito (LGPD Art. 18)
//    e é a prova de que a gente não usa o dado do cliente como refém. Ninguém
//    exporta por causa do botão; a existência dele é que devolve a calma.
// 3. Fundo é o canvas do app, não overlay preto. O cliente não foi expulso —
//    ele está DENTRO do sistema, e a tela precisa parecer parte dele.
// 4. A lista do que continua funcionando vem antes da lista do que parou. O
//    medo real do inadimplente não é "perdi campanha", é "perdi meu histórico".

export function BloqueioTotal({
  standing, onPagar, onContinuar, onExportar,
}: {
  standing:    BillingStanding
  onPagar:     () => void
  onContinuar: () => void
  onExportar:  () => void
}) {
  const inv = standing.invoice

  return (
    <div className="fixed inset-0 z-[80] bg-canvas overflow-y-auto">
      <div className="min-h-full flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl">
          <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="px-6 sm:px-8 py-7">
              <span className="size-11 rounded-xl bg-red-50 text-red-600 grid place-items-center">
                <Lock className="size-5" strokeWidth={1.75} />
              </span>

              <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-4">
                Sua conta está em modo leitura
              </h1>
              <p className="text-sm text-slate-500 leading-relaxed mt-2">
                {inv ? (
                  <>A fatura de <span className="font-semibold text-slate-700">{brl(inv.totalCents)}</span> venceu
                  há <span className="font-semibold text-slate-700">{plural(inv.daysOverdue, "dia")}</span>, em {dataLonga(inv.dueDate)}. </>
                ) : null}
                Nada foi apagado: seus contatos, conversas, negócios e arquivos continuam aqui, inteiros.
              </p>

              {/* Ações — as duas com o mesmo peso de botão, lado a lado. */}
              <div className="flex flex-col sm:flex-row gap-2 mt-6">
                {inv && (
                  <button
                    type="button" onClick={onPagar}
                    className="h-11 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
                  >
                    Pagar {brl(inv.totalCents)} agora
                  </button>
                )}
                <button
                  type="button" onClick={onContinuar}
                  className="h-11 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <Eye className="size-4" /> Continuar em modo leitura
                </button>
              </div>

              {/* O que continua — antes do que parou, sempre. */}
              <div className="mt-7 pt-5 border-t border-slate-100">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  O que continua funcionando
                </p>
                <ul className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4">
                  {standing.continues.map((c) => (
                    <li key={c} className="text-xs text-slate-600 flex items-center gap-2">
                      <Check className="size-3.5 text-emerald-600 shrink-0" strokeWidth={2.5} /> {c}
                    </li>
                  ))}
                </ul>
                {standing.paused.length > 0 && (
                  <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                    Pausado até o pagamento: {standing.paused.join(" · ")}. Volta sozinho, sem precisar
                    reconfigurar nada.
                  </p>
                )}
              </div>
            </div>

            {/* Exportação em destaque — direito, não concessão. */}
            <div className="px-6 sm:px-8 py-5 bg-slate-50 border-t border-slate-200">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Baixar meus dados</p>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-md leading-relaxed">
                    Contatos, conversas, negócios e arquivos em CSV. Disponível sempre — inclusive agora,
                    e mesmo se você decidir não continuar com a Kora.
                  </p>
                </div>
                <button
                  type="button" onClick={onExportar}
                  className="h-10 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold bg-white border border-slate-300 text-slate-800 hover:bg-white hover:border-slate-400 rounded-lg transition-colors shrink-0"
                >
                  <Download className="size-4" /> Baixar (CSV)
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center mt-4">
            Dúvida na cobrança? Fale com a gente no WhatsApp — respondemos no mesmo dia útil.
          </p>
        </div>
      </div>
    </div>
  )
}
