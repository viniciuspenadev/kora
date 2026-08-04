"use client"

import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Check, Download, FileText, Mail } from "lucide-react"
import { brl, dataCheia, dataLonga, num, plural } from "../../format"
import type { Fatura } from "../../types"
import { PixBox } from "../../components/pix-box"

// ═══════════════════════════════════════════════════════════════
// B3 · Fatura — visão do CLIENTE
// ═══════════════════════════════════════════════════════════════
// DECISÃO DE UX (o porquê): a ordem desta tela é o INVERSO da ordem da
// contabilidade. Documento fiscal começa por emitente, período e itens, e o
// total mora no rodapé. Aqui:
//
//   1. COMO PAGAR   — Pix copia-e-cola e botão grande, no topo. Quem abre uma
//                     fatura em aberto veio pagar; qualquer coisa antes disso é
//                     pedágio, e pedágio na tela de pagamento vira inadimplência.
//   2. QUANTO       — o total, uma vez, grande, com a composição em uma linha.
//   3. POR QUÊ      — só então os itens, e cada excedente CARREGA A EVIDÊNCIA:
//                     não "3 usuários — R$ 119,70", e sim "3 usuários acima da
//                     cota: Marcos, Ana e Júlia, adicionados em 12/08".
//
// A regra da evidência é a mais importante da tela: o cliente não deve precisar
// CONFIAR na conta — ele deve poder CONFERIR. Cobrança de uso variável sem
// prova verificável é o que gera chargeback, ticket de suporte e a frase mais
// cara do SaaS: "não reconheço essa cobrança". A evidência não é transparência
// decorativa; ela é o que faz o cliente parar de checar.
//
// Fatura paga troca o bloco 1 pelo comprovante — mesma posição, mesmo peso:
// quem abre uma fatura paga veio buscar o comprovante pro contador.

export function FaturaClient({ fatura }: { fatura: Fatura }) {
  const paga    = fatura.status === "paid"
  const plano   = fatura.linhas.filter((l) => l.kind === "plan").reduce((s, l) => s + l.totalCents, 0)
  const extras  = fatura.totalCents - plano
  const linhasExtras = fatura.linhas.filter((l) => l.kind !== "plan")

  // TODO(dev): gerar/baixar o PDF real.
  const baixarPdf = () => toast.success("Preparando o PDF — o download começa em instantes.")

  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 py-6">
        <div className="max-w-3xl">
          {/* Volta explícita: esta tela costuma ser aberta por link de e-mail. */}
          <Link
            href="/configuracoes/assinatura/faturas"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="size-3.5" /> Faturas
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap mt-3 mb-5">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Fatura de {fatura.referencia.split("/")[0].toLowerCase()}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5 tabular-nums">
                Serviços de {dataCheia(fatura.periodoInicio)} a {dataCheia(fatura.periodoFim)}
              </p>
            </div>
            {paga && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <Check className="size-3.5" strokeWidth={3} /> Paga em {dataCheia(fatura.pagoEm ?? fatura.vencimento)}
              </span>
            )}
          </div>

          <div className="space-y-4">
            {/* ── 1. COMO PAGAR (ou o comprovante) ── */}
            {paga ? (
              <section className="bg-white rounded-xl border border-slate-200 shadow-card px-5 sm:px-6 py-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Pagamento confirmado</p>
                    <p className="text-sm text-slate-700 mt-1">
                      {brl(fatura.totalCents)} · {fatura.formaPagamento ?? "Pix"} · {dataCheia(fatura.pagoEm ?? fatura.vencimento)}
                    </p>
                  </div>
                  <button
                    type="button" onClick={baixarPdf}
                    className="h-10 px-4 inline-flex items-center justify-center gap-2 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
                  >
                    <Download className="size-4" /> Baixar comprovante
                  </button>
                </div>
              </section>
            ) : (
              <PixBox
                totalCents={fatura.totalCents}
                vencimento={fatura.vencimento}
                pixCopiaECola={fatura.pixCopiaECola}
              />
            )}

            {/* ── 2. QUANTO ── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-card px-5 sm:px-6 py-5">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs font-medium text-slate-500">Total da fatura</p>
                  <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none mt-1.5">{brl(fatura.totalCents)}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    {brl(plano)} do plano{extras > 0 && <> + {brl(extras)} de uso além da cota</>}
                  </p>
                </div>
                <p className="text-xs text-slate-500">
                  {paga ? "Vencia" : "Vence"} em <span className="font-semibold text-slate-700">{dataLonga(fatura.vencimento)}</span>
                </p>
              </div>
            </section>

            {/* ── 3. POR QUÊ (com a evidência) ── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
              <header className="px-5 sm:px-6 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">De onde vem esse valor</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cada linha mostra o que aconteceu — dá pra conferir item por item.
                </p>
              </header>

              <div className="divide-y divide-slate-100">
                {[...fatura.linhas.filter((l) => l.kind === "plan"), ...linhasExtras].map((l) => (
                  <div key={l.key} className="px-5 sm:px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{l.titulo}</p>
                        {l.detalhe && <p className="text-xs text-slate-500 mt-0.5">{l.detalhe}</p>}
                        {l.kind === "overage" && l.qtd > 1 && (
                          <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                            {num(l.qtd)} × {brl(l.unitCents)}
                          </p>
                        )}
                      </div>
                      <p className="text-base font-bold text-slate-900 tabular-nums shrink-0">{brl(l.totalCents)}</p>
                    </div>

                    {/* A EVIDÊNCIA — o que transforma cobrança em conferência. */}
                    {l.evidencia && l.evidencia.length > 0 && (
                      <ul className="mt-2.5 pl-3.5 border-l-2 border-slate-100 space-y-1">
                        {l.evidencia.map((e) => (
                          <li key={e.quem} className="text-xs text-slate-500 flex items-baseline gap-2 flex-wrap">
                            <span className="font-medium text-slate-700">{e.quem}</span>
                            {e.quando && <span className="tabular-nums">entrou em {e.quando}</span>}
                            {e.detalhe && <span className="text-slate-400">· {e.detalhe}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</span>
                <span className="text-lg font-bold text-slate-900 tabular-nums">{brl(fatura.totalCents)}</span>
              </div>
            </section>

            {/* ── Rodapé documental ── */}
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={baixarPdf} className={BTN_DOC}>
                <FileText className="size-3.5" /> Baixar PDF
              </button>
              <a
                href={`mailto:?subject=${encodeURIComponent(`Fatura Kora — ${fatura.referencia}`)}`}
                className={BTN_DOC}
              >
                <Mail className="size-3.5" /> Enviar por e-mail
              </a>
              <p className="text-[11px] text-slate-400 ml-1">
                Nota fiscal emitida em até {plural(2, "dia útil", "dias úteis")} após o pagamento.
              </p>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Achou algo que não reconhece? Responde o e-mail da cobrança ou fala com a gente no
              WhatsApp — a gente confere junto e, se o erro for nosso, estorna sem discussão.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

const BTN_DOC = "inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors"
