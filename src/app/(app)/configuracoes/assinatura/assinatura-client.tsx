"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowRight, Check, Download, Mail, Pause, Receipt } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { brl, dataCurta, dataLonga, num } from "./format"
import type { AssinaturaMock } from "./mock"
import { StandingHero } from "./components/standing-hero"
import { PagarModal } from "./components/pagar-modal"
import { MaisDiasModal } from "./components/mais-dias-modal"
import { CaberNoPlanoModal } from "./components/caber-no-plano-modal"
import { BloqueioTotal } from "./components/bloqueio-total"

// ═══════════════════════════════════════════════════════════════
// B1 · Minha assinatura
// ═══════════════════════════════════════════════════════════════
// DECISÃO DE UX (o porquê, não o quê):
//
// • O TOPO É UMA FRASE E UMA DATA. Ver `standing-hero.tsx` — a regra inteira
//   mora lá. Aqui o compromisso é: nada acima dela, nada do lado dela que
//   compita. O que veio depois é tudo subordinado.
//
// • "O QUE ESTÁ INCLUSO" EM LINGUAGEM DE RESULTADO. O cliente contratou
//   "Campanhas" e "Agenda", não `broadcasts` e `agenda_reminders`. Nome interno
//   de módulo numa tela de assinatura tem dois efeitos ruins: ele não reconhece
//   o que está pagando, e quando algo é pausado ele não sabe o que perdeu. A
//   lista vem do contrato (`continues`/`paused`) justamente pra a tradução
//   acontecer ANTES de chegar aqui.
//
// • O QUE CONTINUA VEM ANTES DO QUE PAROU. Em qualquer degrau. O pânico de quem
//   está atrasado é "perdi meu histórico" — responder isso primeiro é o que
//   mantém a conversa sobre pagamento, e não sobre cancelamento.
//
// • A CONTA DO MÊS É UMA LINHA, NÃO UM DEMONSTRATIVO. Plano + o que variou +
//   total, ancorados à direita. Quem quer auditar clica em Consumo ou na
//   fatura; quem só quer saber "vai dar quanto?" já sabe aqui.
//
// • O RAIL DIREITO É UM PAINEL CONTÍNUO com divisórias, não três cartões
//   flutuando. Cara de extrato, que é o que ele é.

export function AssinaturaClient({ mock }: { mock: AssinaturaMock }) {
  const { standing, resumo, conta, medidas, faturaAberta } = mock
  const [modal, setModal]       = useState<null | "pagar" | "dias" | "plano">(null)
  const [bloqueio, setBloqueio] = useState(standing.degrau === "readonly")
  const [adiado, setAdiado]     = useState(false)

  // TODO(dev): dispara a exportação real (LGPD Art. 18) e avisa por e-mail.
  const exportar = () => toast.success("Estamos preparando seu arquivo — você recebe o link por e-mail em alguns minutos.")

  return (
    <>
      <div className="space-y-4">
        <StandingHero
          standing={standing}
          conta={conta}
          planoNome={resumo.planoNome}
          formaPagamento={resumo.formaPagamento}
          cicloDia={resumo.cicloDia}
          adiamentoUsado={resumo.adiamentoUsado || adiado}
          onPagar={() => setModal("pagar")}
          onMaisDias={() => setModal("dias")}
          onExportar={exportar}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
          {/* ── Coluna principal ── */}
          <div className="min-w-0 space-y-4">
            <SectionCard
              title="O que está incluso"
              description="O que sua assinatura te deixa fazer hoje"
            >
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {standing.continues.map((item) => (
                  <li key={item} className="flex items-center gap-2 py-0.5">
                    <Check className="size-4 text-emerald-600 shrink-0" strokeWidth={2.5} />
                    <span className="text-sm text-slate-700">{item}</span>
                  </li>
                ))}
                {standing.paused.map((item) => (
                  <li key={item} className="flex items-center gap-2 py-0.5">
                    <Pause className="size-4 text-red-500 shrink-0" strokeWidth={2.5} />
                    <span className="text-sm text-slate-400 line-through decoration-slate-300">{item}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-px">
                      pausado
                    </span>
                  </li>
                ))}
              </ul>

              {standing.paused.length > 0 && (
                <p className="text-xs text-slate-500 mt-4 pt-3.5 border-t border-slate-100 leading-relaxed">
                  Volta sozinho assim que o pagamento cair — nada precisa ser reconfigurado, e as
                  campanhas agendadas seguem na fila.
                </p>
              )}
            </SectionCard>

            {/* Prévia do consumo — glance, não relatório. A profundidade é a aba Consumo. */}
            <SectionCard
              title="Seu consumo até aqui"
              description={conta.fechaEm ? `Ciclo fecha em ${dataLonga(conta.fechaEm)}` : undefined}
              actions={
                <Link
                  href="/configuracoes/assinatura/consumo"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  Ver consumo <ArrowRight className="size-3.5" />
                </Link>
              }
              flush
            >
              <div className="divide-y divide-slate-100">
                {medidas.map((m) => {
                  const vira = m.excedenteCents > 0 || m.projecaoCents > 0
                  return (
                    <div key={m.key} className="px-5 py-3 flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">{m.label}</p>
                        <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                          {num(m.usado)} de {m.cota == null ? "ilimitado" : num(m.cota)} {m.unidade}s incluídos
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${vira ? "text-slate-900" : "text-slate-400"}`}>
                          {brl(m.excedenteCents)}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {m.excedenteCents > 0 ? "de excedente" : m.projecaoCents > 0 ? `~${brl(m.projecaoCents)} no ritmo atual` : "sem excedente"}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          </div>

          {/* ── Rail direito: UM painel, seções por divisória ── */}
          <aside className="bg-white rounded-xl border border-slate-200 shadow-card divide-y divide-slate-100">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {conta.fechaEm ? `Sua conta de ${dataLonga(conta.fechaEm).split(" de ")[1]}` : "Sua conta do mês"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {conta.fechaEm ? `Fecha em ${dataLonga(conta.fechaEm)} — ainda pode mudar até lá.` : "Parcial do ciclo corrente."}
              </p>

              <div className="mt-3.5 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-slate-600">{conta.planoLabel}</span>
                  <span className="text-xs font-semibold text-slate-700 tabular-nums">{brl(conta.planoCents)}</span>
                </div>
                {conta.extras.map((e) => (
                  <div key={e.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-slate-600">{e.label}</span>
                    <span className="text-xs font-semibold text-slate-700 tabular-nums">{brl(e.cents)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-500">Parcial</span>
                <span className="text-xl font-bold text-slate-900 tabular-nums">{brl(conta.totalCents)}</span>
              </div>

              <button
                type="button"
                onClick={() => setModal("plano")}
                className="w-full mt-3.5 h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors"
              >
                Quero caber no plano
              </button>
            </div>

            <div className="px-5 py-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pagamento</h2>
              <dl className="mt-2.5 space-y-2">
                <Row termo="Forma" valor={resumo.formaPagamento} />
                <Row termo="Cobrança" valor={resumo.cicloDia ? `todo dia ${resumo.cicloDia}` : "a definir"} />
                <Row termo="Nota e aviso" valor={resumo.emailCobranca} />
              </dl>
              <Link
                href="/configuracoes/assinatura/faturas"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 mt-3"
              >
                <Receipt className="size-3.5" /> Ver faturas e comprovantes
              </Link>
            </div>

            {faturaAberta && (
              <div className="px-5 py-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Fatura em aberto</h2>
                <div className="flex items-baseline justify-between gap-3 mt-2.5">
                  <span className="text-xs text-slate-600">{faturaAberta.referencia}</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{brl(faturaAberta.totalCents)}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">venceu em {dataCurta(faturaAberta.vencimento)}</p>
                <Link
                  href={`/configuracoes/assinatura/faturas/${faturaAberta.id}`}
                  className="w-full mt-3 h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors"
                >
                  Abrir fatura
                </Link>
              </div>
            )}

            <div className="px-5 py-4">
              <button
                type="button"
                onClick={exportar}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                <Download className="size-3.5" /> Baixar meus dados
              </button>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Disponível sempre, em qualquer situação da conta.
              </p>
              <a
                href="mailto:suporte@kora.app?subject=D%C3%BAvida%20na%20cobran%C3%A7a"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 mt-3"
              >
                <Mail className="size-3.5" /> Falar sobre a cobrança
              </a>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Modais ── */}
      {modal === "pagar" && faturaAberta && (
        <PagarModal
          totalCents={faturaAberta.totalCents}
          vencimento={faturaAberta.vencimento}
          referencia={faturaAberta.referencia}
          pixCopiaECola={faturaAberta.pixCopiaECola}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "dias" && resumo.adiamentoAte && (
        <MaisDiasModal
          novaData={resumo.adiamentoAte}
          jaUsou={resumo.adiamentoUsado || adiado}
          temPausado={standing.paused.length > 0}
          onClose={() => setModal(null)}
          onConfirmar={() => setAdiado(true)}
        />
      )}

      {modal === "plano" && (
        <CaberNoPlanoModal
          medidas={medidas}
          gastoAtualCents={conta.totalCents}
          planoAtualCents={conta.planoCents}
          onClose={() => setModal(null)}
        />
      )}

      {bloqueio && (
        <BloqueioTotal
          standing={standing}
          onPagar={() => { setBloqueio(false); setModal("pagar") }}
          onContinuar={() => setBloqueio(false)}
          onExportar={exportar}
        />
      )}
    </>
  )
}

function Row({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-500 shrink-0">{termo}</dt>
      <dd className="text-xs font-medium text-slate-700 truncate">{valor}</dd>
    </div>
  )
}
