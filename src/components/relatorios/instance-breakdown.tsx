import { BadgeCheck, Smartphone } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import type { InstanceSlice } from "@/lib/actions/reports"
import type { AdInstanceSlice } from "@/lib/actions/ads"

interface InstanceMeta { id: string; label: string; provider: string | null }

const fmtN = (n: number) => n.toLocaleString("pt-BR")
const fmtMoney = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

/** Célula "Número" com ícone do provider + nome (display_name resolvido na página). */
function NumberCell({ meta }: { meta: InstanceMeta | null }) {
  const isMeta = meta?.provider === "meta_cloud"
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded ${isMeta ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-500"}`}>
        {isMeta ? <BadgeCheck className="size-3" /> : <Smartphone className="size-3" />}
      </span>
      <span className="text-sm font-medium text-slate-900">{meta?.label ?? "Número removido"}</span>
    </div>
  )
}

const TH = "text-right font-medium py-2 px-2"
const TD = "text-right py-2 px-2 tabular-nums text-slate-700"

/**
 * Breakdown "lado a lado" por número — conversas/contatos/resolvidos/valor.
 * Usado em Geral · Atendimento · Origem. Só renderiza com 2+ números (gate na página).
 */
export function InstanceBreakdown({ rows, instances, subtitle }: {
  rows: InstanceSlice[]
  instances: InstanceMeta[]
  subtitle?: string
}) {
  if (rows.length === 0) return null
  return (
    <SectionCard className="mb-6">
      <div className="px-1 pb-3">
        <h2 className="text-sm font-semibold text-slate-900 mb-0.5">Por número</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="text-left font-medium py-2 px-2">Número</th>
              <th className={TH}>Conversas</th>
              <th className={TH}>Contatos</th>
              <th className={TH}>Resolvidas</th>
              <th className={TH}>% Resolv.</th>
              <th className={TH}>Valor estimado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.conversations > 0 ? Math.round((r.resolved / r.conversations) * 100) : 0
              const meta = instances.find((i) => i.id === r.instanceId) ?? null
              return (
                <tr key={r.instanceId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 px-2"><NumberCell meta={meta} /></td>
                  <td className={TD}>{fmtN(r.conversations)}</td>
                  <td className={TD}>{fmtN(r.contacts)}</td>
                  <td className={TD}>{fmtN(r.resolved)}</td>
                  <td className={TD}>{pct}%</td>
                  <td className={TD}>{fmtMoney(r.valueCents)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

/** Breakdown de leads de anúncio por número — usado em Anúncios. */
export function AdsInstanceBreakdown({ rows, instances }: {
  rows: AdInstanceSlice[]
  instances: InstanceMeta[]
}) {
  if (rows.length === 0) return null
  return (
    <SectionCard className="mb-6">
      <div className="px-1 pb-3">
        <h2 className="text-sm font-semibold text-slate-900 mb-0.5">Leads por número</h2>
        <p className="text-xs text-slate-500">Atribuição de leads de anúncio por número de WhatsApp</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="text-left font-medium py-2 px-2">Número</th>
              <th className={TH}>Leads</th>
              <th className={TH}>Ganhos</th>
              <th className={TH}>Conversão</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = instances.find((i) => i.id === r.instanceId) ?? null
              return (
                <tr key={r.instanceId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 px-2"><NumberCell meta={meta} /></td>
                  <td className={TD}>{fmtN(r.leads)}</td>
                  <td className={TD}>{fmtN(r.won)}</td>
                  <td className={TD}>{r.conversionPct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
