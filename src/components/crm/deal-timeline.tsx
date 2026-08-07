import { Bot } from "lucide-react"
import { dealEventStyle } from "@/components/crm/deal-event-style"
import type { CockpitEvent } from "@/lib/actions/companies"

// Timeline de eventos de negócio — MESMO visual/ícones/infos do detalhe de negócio
// (deal-page-client "Linha do tempo"): círculo colorido por tipo (via dealEventStyle,
// fonte única) + conector + cartão em 2 andares + rodapé com autor e data. Usada na
// ficha da EMPRESA (cruza vários negócios → mostra o nome do negócio como contexto).

const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
}

/** Título + descrição por tipo — espelha describeEvent do deal-page. */
function describe(e: CockpitEvent): { title: string; desc: string } {
  if (e.type === "note") return { title: "Nota", desc: e.note ?? "—" }
  if (e.type === "field_changed") {
    const val = e.change ? `${e.change.from ?? "—"} → ${e.change.to ?? "—"}` : ""
    if (e.note) return { title: e.note, desc: e.change ? `${e.change.label}: ${val}` : "" }
    return { title: `${e.change?.label ?? "Campo"} alterado`, desc: val }
  }
  const label = dealEventStyle(e.type).label
  let desc = ""
  switch (e.type) {
    case "stage_changed": desc = `Etapa alterada de “${e.from_stage ?? "—"}” para “${e.to_stage ?? "—"}”.`; break
    case "created":       desc = `Negócio aberto${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    case "won":           desc = `Negócio ganho${e.to_stage ? ` em “${e.to_stage}”` : ""}.`; break
    case "lost":          desc = `Negócio perdido${e.reason ? ` · ${e.reason}` : ""}.`; break
    case "canceled":      desc = `Negócio cancelado${e.reason ? ` · ${e.reason}` : ""}.`; break
    case "reopened":      desc = `Negócio reaberto${e.reason ? ` — ${e.reason.toLowerCase()}` : ""}.`; break
    default:              desc = e.note ?? ""
  }
  return { title: label, desc }
}

/** Rodapé do cartão — autor (humano/robô) + data. Espelha o CardFooter do deal-page. */
function CardFooter({ by, at }: { by: string | null; at: string }) {
  const robotic = !!by && /^(automação|ia\b|sistema)/i.test(by)
  return (
    <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
      {by ? (
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-slate-500 min-w-0">
          {robotic ? (
            <span className="size-4 rounded-full grid place-items-center bg-slate-200 text-slate-500 shrink-0"><Bot className="size-2.5" /></span>
          ) : (
            <span className="size-4 rounded-full grid place-items-center text-[7px] font-extrabold text-white shrink-0" style={{ background: "#004add" }}>{by.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
          )}
          <span className="truncate">{by}</span>
        </span>
      ) : <span />}
      <span className="ml-auto text-[10px] text-slate-400 tabular-nums shrink-0">{fmtDateTime(at)}</span>
    </div>
  )
}

export function DealTimeline({ events }: { events: CockpitEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-400 text-center py-4">Nenhuma atividade registrada ainda.</p>
  }
  return (
    <ul>
      {events.map((e, i) => {
        const st = dealEventStyle(e.type)
        const { title, desc } = describe(e)
        const Icon = st.Icon
        return (
          <li key={e.id} className="flex gap-3.5">
            {/* trilho: círculo colorido pelo tipo (mesma linguagem do dossiê) + conector */}
            <div className="flex flex-col items-center">
              <span className="relative z-10 size-10 rounded-full grid place-items-center shrink-0 ring-4 ring-white text-white" style={{ background: st.accent }}>
                <Icon className="size-4" />
              </span>
              {i < events.length - 1 && <span className="w-px flex-1 bg-slate-200 -mt-1" />}
            </div>
            {/* cartão */}
            <div className="flex-1 min-w-0 pb-4">
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 pt-2.5 pb-2">
                  <h4 className="text-[13px] font-bold text-slate-900 truncate">{title}</h4>
                  {desc && <p className="text-xs text-slate-600 mt-0.5 break-words whitespace-pre-wrap leading-snug">{desc}</p>}
                  {e.dealName && (
                    <p className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1.5 min-w-0">
                      <span className="size-1 rounded-full bg-slate-300 shrink-0" /><span className="truncate">{e.dealName}</span>
                    </p>
                  )}
                </div>
                <CardFooter by={e.by} at={e.at} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
