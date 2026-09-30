"use client"

import { useState, useTransition } from "react"
import { AlertCircle, CheckCircle2, Loader2, SlidersHorizontal } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { updatePlatformSettings } from "@/lib/actions/admin-platform-settings"

// ═══════════════════════════════════════════════════════════════
// Regras de cobrança da plataforma — o painel de maior alcance do god mode
// ═══════════════════════════════════════════════════════════════
//
// 🔑 A TELA TEM QUE DIZER O ALCANCE, não só aceitar o número. Todo outro campo do god mode
//    age sobre UM cliente; estes dois agem sobre TODOS de uma vez. Um operador que não
//    percebe isso vai testar um valor "só pra ver" — e o teste acontece na base inteira.
//    Por isso o alcance está no subtítulo, e cada campo diz o que acontece no fim do prazo,
//    não só o nome do prazo.
//
// 🔑 E TEM QUE EXPLICAR O QUE `0` FAZ. Zero é valor válido e significa "sem espera" — mas
//    quem digita zero costuma querer dizer "desligado", que aqui seria o oposto (prazo
//    infinito). A frase de ajuda desfaz isso antes do clique, não depois.

const INP = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary tabular-nums"

export function RegrasClient({ pastDue, trialEnded, doBanco }: {
  pastDue:    number
  trialEnded: number
  /** `false` = a leitura falhou e os números na tela são o fallback de emergência. */
  doBanco:    boolean
}) {
  const [atraso, setAtraso] = useState(String(pastDue))
  const [teste,  setTeste]  = useState(String(trialEnded))
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk]   = useState<string | null>(null)
  const [pending, startT] = useTransition()

  const sujo = atraso !== String(pastDue) || teste !== String(trialEnded)

  function salvar() {
    setErr(null); setOk(null)
    startT(async () => {
      const r = await updatePlatformSettings({
        // `Number("")` é 0 e passaria como "corta na hora" — o `trim()` vazio vira NaN, que
        // a action recusa com uma frase humana em vez de aplicar um zero que ninguém digitou.
        pastDueGraceDays:    atraso.trim() === "" ? NaN : Number(atraso),
        trialEndedGraceDays: teste.trim()  === "" ? NaN : Number(teste),
      })
      if (r.error) { setErr(r.error); return }
      setOk("Regras salvas. Valem para todos os clientes que não têm valor próprio.")
    })
  }

  return (
    <SectionCard
      title={<span className="flex items-center gap-2"><SlidersHorizontal className="size-3.5 text-primary-600" /> Regras de cobrança</span>}
      description="Valem para TODOS os clientes. Cada tenant pode ter valor próprio na ficha de cobrança dele, e o valor próprio vence este."
    >
      {/* 🔴 Sinal honesto: se a leitura falhou, os números na tela NÃO são o que está
          gravado — são o fallback do código. Deixar isso invisível faria o operador salvar
          o fallback por cima da configuração real, achando que confirmou o que via. */}
      {!doBanco && (
        <div className="flex items-start gap-2 p-3 mb-3 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-900">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>
            Não conseguimos ler a configuração salva — os valores abaixo são o padrão de
            emergência do sistema, não o que está gravado. <strong>Recarregue antes de salvar</strong>,
            senão você grava este padrão por cima da configuração real.
          </span>
        </div>
      )}

      {(err || ok) && (
        <div className={`flex items-start gap-2 p-3 mb-3 rounded-lg text-xs ${err ? "bg-red-50 border border-red-200 text-red-800" : "bg-green-50 border border-green-200 text-green-800"}`}>
          {err ? <AlertCircle className="size-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="size-4 shrink-0 mt-0.5" />}
          <span>{err ?? ok}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Fatura vencida → acesso fecha
          </label>
          <input value={atraso} onChange={(e) => setAtraso(e.target.value)} inputMode="numeric" className={INP} />
          <p className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
            Dias entre o gateway desistir de cobrar o cartão e o produto fechar (paywall).
            {" "}<b>0 = fecha na hora</b> · teto 90. O relógio só começa depois de todas as
            tentativas do gateway — não é prazo para pagar.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Teste vencido → conta suspensa
          </label>
          <input value={teste} onChange={(e) => setTeste(e.target.value)} inputMode="numeric" className={INP} />
          <p className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
            Dias entre o teste acabar e a conta ser suspensa de vez. Até lá o responsável
            ainda entra para assinar. <b>0 = suspende na hora</b> · teto 90.
          </p>
        </div>
      </div>

      {/* ⚠️ O que NÃO acontece também precisa estar dito: o operador que lê "acesso fecha"
          pode supor que a assinatura morre junto — ela não morre mais desde 12/08, e essa
          é justamente a diferença que fez o encerramento automático ser removido. */}
      <p className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
        Passado o prazo do atraso, o acesso fecha — mas <b>a assinatura continua ativa no
        gateway</b> e nada é cancelado automaticamente. Encerrar a cobrança é decisão de
        gente: o cliente cancelando, ou você suspendendo a conta na ficha dele.
      </p>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={salvar}
          disabled={pending || !sujo}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-40"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Salvar regras
        </button>
      </div>
    </SectionCard>
  )
}
