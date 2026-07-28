import { Receipt } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import type { InstanceBillingSummary } from "@/lib/actions/wa-billing"

/** Rótulo PT-BR + cor semântica por categoria de cobrança da Meta. */
const LABEL: Record<string, { label: string; hint: string; dot: string }> = {
  marketing:           { label: "Marketing",     hint: "promoções e campanhas",            dot: "bg-violet-500" },
  utility:             { label: "Utilidade",     hint: "confirmações e atualizações",      dot: "bg-sky-500"    },
  authentication:      { label: "Autenticação",  hint: "códigos de verificação",           dot: "bg-amber-500"  },
  service:             { label: "Atendimento",   hint: "respostas dentro da janela de 24h", dot: "bg-emerald-500" },
  referral_conversion: { label: "Vindo de anúncio", hint: "clique-para-WhatsApp",          dot: "bg-primary"    },
  other:               { label: "Outras",        hint: "categoria nova da Meta",           dot: "bg-slate-400"  },
}

/**
 * Mensagens cobráveis pela Meta neste número, por categoria.
 * Sem R$ de propósito — quem fatura é a Meta, direto com o cliente (ver wa-billing.ts).
 */
export function BillingCard({ summary }: { summary: InstanceBillingSummary }) {
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Receipt className="size-4 text-primary-600" />
          Mensagens cobráveis · últimos {summary.days} dias
        </span>
      }
    >
      {summary.total === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhuma mensagem cobrável registrada ainda neste número.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.rows.map((r) => {
              const meta = LABEL[r.category] ?? LABEL.other
              const pct  = summary.total > 0 ? Math.round((r.count / summary.total) * 100) : 0
              return (
                <div
                  key={r.category}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 bg-white"
                >
                  <span className={`size-2 rounded-full shrink-0 ${meta.dot}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{meta.label}</p>
                    <p className="text-[11px] text-slate-500 truncate">{meta.hint}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums text-slate-900">{r.count}</p>
                    <p className="text-[11px] text-slate-500 tabular-nums">{pct}%</p>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            {summary.total} mensagem{summary.total === 1 ? "" : "s"} cobrável
            {summary.total === 1 ? "" : "eis"} no período. A Kora informa o que gera custo;
            o valor é cobrado pela Meta direto na sua conta — confira na fatura do
            Gerenciador de Negócios.
          </p>
        </>
      )}
    </SectionCard>
  )
}
