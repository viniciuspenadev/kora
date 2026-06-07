"use client"

import { Activity, Bot, Workflow, AlertCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"

export interface StudioRunRow {
  id:            string
  kind:          string
  node_id:       string | null
  error:         string | null
  tools_called:  { name: string; arguments: string }[]
  llm_response:  string | null
  model:         string | null
  input_tokens:  number | null
  output_tokens: number | null
  cost_usd:      number | null
  duration_ms:   number | null
  created_at:    string
}

const TOOL_PT: Record<string, string> = {
  send_message:     "respondeu",
  transfer:         "encaminhou",
  update_contact:   "salvou dados",
  search_knowledge: "consultou a base",
  http_request:     "chamou API",
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function AtividadeClient({ runs }: { runs: StudioRunRow[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Nenhuma atividade ainda"
        description="Quando a IA atender ou um fluxo rodar, cada passo aparece aqui — com tools usadas, resposta e custo."
      />
    )
  }

  return (
    <div className="space-y-2">
      {runs.map((r) => {
        const isAgent = r.kind === "agent_turn"
        const tools = r.tools_called ?? []
        const tokens = (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
        return (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2.5">
              <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${isAgent ? "bg-gradient-to-br from-violet-500 to-blue-600" : "bg-primary-50"}`}>
                {isAgent ? <Bot className="size-4 text-white" /> : <Workflow className="size-4 text-primary-600" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-900">{isAgent ? "Turno da IA" : "Passo de fluxo"}</span>
                  {tools.map((t, i) => (
                    <span key={i} className="text-[10px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                      {TOOL_PT[t.name] ?? t.name}
                    </span>
                  ))}
                </div>
                {r.llm_response && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{r.llm_response}</p>}
              </div>
              <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{fmtTime(r.created_at)}</span>
            </div>

            {r.error && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-danger bg-danger-bg border border-red-100 rounded-lg px-2.5 py-1.5">
                <AlertCircle className="size-3.5 shrink-0" /> {r.error}
              </div>
            )}

            <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400 tabular-nums">
              {tokens > 0 && <span>{tokens.toLocaleString("pt-BR")} tokens</span>}
              {r.cost_usd != null && r.cost_usd > 0 && <span>${r.cost_usd.toFixed(4)}</span>}
              {r.duration_ms != null && <span>{r.duration_ms}ms</span>}
              {r.model && <span className="font-mono">{r.model}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
