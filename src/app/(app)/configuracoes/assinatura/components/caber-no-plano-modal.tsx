"use client"

import Link from "next/link"
import { ArrowUpRight, Scaling, Users2 } from "lucide-react"
import { BTN_GHOST, BTN_PRIMARY, BTN_WHITE, ModalShell } from "./modal-shell"
import { brl } from "../format"
import type { LinhaMedida } from "../types"

// ═══════════════════════════════════════════════════════════════
// Modal "Quero caber no plano"
// ═══════════════════════════════════════════════════════════════
// DECISÃO: a saída não pode ser só "assine um plano maior". Isso é a saída da
// KORA, não a do cliente. Toda linha de excedente tem DUAS saídas honestas —
// pagar mais e caber melhor — e este modal mostra as duas lado a lado, com o
// número dos dois lados. Se caber no plano maior for pior pro cliente, a tela
// tem que deixar isso visível; esconder faz o cliente descobrir depois e o
// preço disso é a confiança.
//
// A segunda saída é ACIONÁVEL, não conselho: "3 usuários sem entrar há 30 dias"
// com link direto pra Equipe. Dica sem link é a mesma coisa que culpa.

interface PlanoSugerido {
  nome:      string
  precoCents: number
  inclui:    string[]
}

export function CaberNoPlanoModal({
  medidas, gastoAtualCents, planoAtualCents, onClose,
}: {
  medidas:         LinhaMedida[]
  /** Plano + excedente do mês corrente — a régua de comparação honesta. */
  gastoAtualCents: number
  planoAtualCents: number
  onClose:         () => void
}) {
  // TODO(dev): vem do catálogo de planos (tabela `plans`), com a recomendação
  // calculada pelo consumo real dos últimos 3 ciclos.
  const sugerido: PlanoSugerido = {
    nome: "Enterprise", precoCents: 59900,
    inclui: ["15 usuários", "20.000 disparos por mês", "IA sem cota", "3 números conectados"],
  }
  const diferenca = sugerido.precoCents - gastoAtualCents
  const excedendo = medidas.filter((m) => m.excedente > 0 || m.projecaoCents > 0)

  return (
    <ModalShell
      icon={Scaling}
      title="Quero caber no plano"
      desc="Duas saídas, com o número dos dois lados"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_GHOST}>Manter como está</button>
          <button type="button" className={BTN_PRIMARY}>Mudar pro {sugerido.nome}</button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Onde você está hoje */}
        <div className="flex items-baseline justify-between gap-3 pb-3.5 border-b border-slate-100">
          <div>
            <p className="text-xs font-medium text-slate-500">Você paga hoje</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {brl(planoAtualCents)} do plano + {brl(gastoAtualCents - planoAtualCents)} de excedente
            </p>
          </div>
          <p className="text-xl font-bold text-slate-900 tabular-nums shrink-0">{brl(gastoAtualCents)}</p>
        </div>

        {/* Saída 1 — plano maior */}
        <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Plano {sugerido.nome}</p>
            <p className="text-lg font-bold text-slate-900 tabular-nums shrink-0">{brl(sugerido.precoCents)}<span className="text-xs font-medium text-slate-400">/mês</span></p>
          </div>
          <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
            {diferenca > 0
              ? <>Fica <span className="font-semibold text-slate-900">{brl(diferenca)} a mais</span> por mês que o seu gasto atual — e o valor para de variar com o uso.</>
              : <>Fica <span className="font-semibold text-emerald-700">{brl(Math.abs(diferenca))} a menos</span> por mês que o seu gasto atual, com mais folga.</>}
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
            {sugerido.inclui.map((i) => (
              <li key={i} className="text-[11px] text-slate-600 flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-primary shrink-0" /> {i}
              </li>
            ))}
          </ul>
        </div>

        {/* Saída 2 — caber no que já tem */}
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">Ou caber no plano que você já tem</p>
          <p className="text-xs text-slate-500 mt-1">O que está estourando a cota hoje — e o caminho mais curto pra cada um.</p>

          <div className="mt-3 divide-y divide-slate-100">
            {excedendo.map((m) => (
              <div key={m.key} className="py-2.5 flex items-center justify-between gap-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{m.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {m.key === "users"
                      ? "3 pessoas não entram há mais de 30 dias — desativar já resolve"
                      : `Cota de ${m.cota?.toLocaleString("pt-BR")} ${m.unidade}s por mês`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-slate-900 tabular-nums">
                    {brl(m.excedenteCents || m.projecaoCents)}
                  </span>
                  {m.key === "users" ? (
                    <Link href="/configuracoes/equipe" className={BTN_WHITE}>
                      <Users2 className="size-3.5" /> Ver equipe
                    </Link>
                  ) : (
                    <Link href="/configuracoes/uso" className={BTN_WHITE}>
                      <ArrowUpRight className="size-3.5" /> Ajustar
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Não fazer nada também é uma opção: o excedente é cobrado por uso, sem multa e sem contrato novo.
        </p>
      </div>
    </ModalShell>
  )
}
