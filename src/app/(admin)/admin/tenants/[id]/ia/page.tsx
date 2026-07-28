// God Mode → Tenant → IA: custo REAL de IA do tenant (30 dias), por tipo de
// gasto. Fonte = ledger studio_runs (v2: turnos, router, dossiê, aiParse,
// transcrição) + ai_runs (v1, sunset — só o total). Custo em USD (preço direto
// da OpenAI — tabela única em src/lib/ai/pricing.ts); margem/plano é assunto
// da aba Cobrança, aqui é o CUSTO da plataforma com este tenant.

import { Sparkles, AlertTriangle } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { SectionCard } from "@/components/ui/section-card"

export const dynamic = "force-dynamic"

const KIND_LABELS: Record<string, string> = {
  node_exec:     "Respostas em fluxo (nó Agente IA)",
  agent_turn:    "Respostas do Agente (fora de fluxo)",
  router:        "Roteador de intenção",
  dossier:       "Dossiê no handoff",
  ai_parse:      "Entender pedido (Agendar)",
  transcription: "Transcrição de áudio",
}

interface Row { kind: string; model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null }

export default async function TenantIaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: v2 }, { data: v1 }] = await Promise.all([
    supabaseAdmin
      .from("studio_runs")
      .select("kind, model, input_tokens, output_tokens, cost_usd")
      .eq("tenant_id", id)
      .gte("created_at", day30),
    supabaseAdmin
      .from("ai_runs")
      .select("input_tokens, output_tokens, cost_usd")
      .eq("tenant_id", id)
      .gte("created_at", day30),
  ])

  // Agrega por kind
  const byKind = new Map<string, { events: number; tokens: number; cost: number; unpriced: number }>()
  let total = { events: 0, tokens: 0, cost: 0, unpriced: 0 }
  const add = (kind: string, r: { input_tokens: number | null; output_tokens: number | null; cost_usd: number | null }) => {
    const g = byKind.get(kind) ?? { events: 0, tokens: 0, cost: 0, unpriced: 0 }
    const tokens = (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
    g.events += 1
    g.tokens += tokens
    if (r.cost_usd != null) g.cost += Number(r.cost_usd)
    else if (tokens > 0) g.unpriced += 1
    byKind.set(kind, g)
    total.events += 1
    total.tokens += tokens
    if (r.cost_usd != null) total.cost += Number(r.cost_usd)
    else if (tokens > 0) total.unpriced += 1
  }
  for (const r of (v2 ?? []) as Row[]) add(r.kind, r)
  for (const r of (v1 ?? [])) add("v1_legacy", r as Row)

  const rows = [...byKind.entries()]
    .map(([kind, g]) => ({ kind, ...g }))
    .sort((a, b) => b.cost - a.cost)

  const usd = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`
  const num = (n: number) => n.toLocaleString("pt-BR")

  return (
    <div className="space-y-6">
      {/* KPIs do mês corrido */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Custo de IA (30 dias)", value: usd(total.cost), hint: "preço OpenAI, tabela única da plataforma" },
          { label: "Tokens (entrada + saída)", value: num(total.tokens), hint: "todos os modelos" },
          { label: "Eventos de IA", value: num(total.events), hint: "respostas, roteios, dossiês, transcrições" },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{k.value}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{k.hint}</p>
          </div>
        ))}
      </div>

      <SectionCard title="Onde a IA gastou" description="Últimos 30 dias, por tipo de uso" icon={Sparkles} flush>
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-400 text-center">Nenhum uso de IA nos últimos 30 dias.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-2.5">Tipo</th>
                <th className="px-3 py-2.5 text-right">Eventos</th>
                <th className="px-3 py-2.5 text-right">Tokens</th>
                <th className="px-5 py-2.5 text-right">Custo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 font-medium text-slate-700">
                    {KIND_LABELS[r.kind] ?? (r.kind === "v1_legacy" ? "Atendente IA (v1 — legado)" : r.kind)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{num(r.events)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{num(r.tokens)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-slate-900">{usd(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {total.unpriced > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-warning-bg border border-amber-100 px-4 py-3">
          <AlertTriangle className="size-4 text-warning shrink-0" />
          <p className="text-xs text-amber-800">
            {total.unpriced.toLocaleString("pt-BR")} evento(s) com modelo fora da tabela de preços — custo não calculado.
            Atualize <code className="font-mono">src/lib/ai/pricing.ts</code>.
          </p>
        </div>
      )}
    </div>
  )
}
