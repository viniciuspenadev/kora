import { supabaseAdmin } from "@/lib/supabase"
import { FileText, AlertTriangle, CheckCircle2, Boxes, Gauge } from "lucide-react"

const ACTION_LABEL: Record<string, string> = {
  "contact.delete_personal_data": "Apagou dados (LGPD)",
  "contact.export_personal_data": "Exportou dados (LGPD)",
  "module.enable":                "Habilitou módulo",
  "module.disable":               "Desabilitou módulo",
  "module.clear_override":        "Limpou override de módulo",
  "limit.set":                    "Setou limite",
  "limit.clear_override":         "Limpou override de limite",
}

function ActionIcon({ action }: { action: string }) {
  const cls = "size-3.5"
  if (action.startsWith("contact.delete")) return <AlertTriangle className={`${cls} text-red-600`} />
  if (action.startsWith("contact.export")) return <FileText className={`${cls} text-slate-600`} />
  if (action.startsWith("module.enable"))  return <CheckCircle2 className={`${cls} text-emerald-600`} />
  if (action.startsWith("module.disable")) return <AlertTriangle className={`${cls} text-amber-600`} />
  if (action.startsWith("module."))        return <Boxes className={`${cls} text-primary-600`} />
  if (action.startsWith("limit."))         return <Gauge className={`${cls} text-primary-600`} />
  return <FileText className={`${cls} text-slate-500`} />
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "agora"
  if (min < 60) return `${min}min`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export default async function TenantActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: events } = await supabaseAdmin
    .from("audit_log")
    .select("id, action, target_id, actor_email, created_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: false })
    .limit(50)

  const rows = events ?? []

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <FileText className="size-4 text-primary-600" />
        <h2 className="text-sm font-bold text-slate-900">Atividade</h2>
        <span className="text-xs text-slate-400">· ações sensíveis</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">Sem atividade registrada para este tenant.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-5 py-2.5">
              <div className="size-6 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                <ActionIcon action={a.action} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {ACTION_LABEL[a.action] ?? a.action}
                  {a.target_id && <span className="ml-1 text-slate-400 font-mono font-normal">· {a.target_id.slice(0, 24)}{a.target_id.length > 24 ? "…" : ""}</span>}
                </p>
                <p className="text-[11px] text-slate-500 truncate">{a.actor_email ?? "sistema"}</p>
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{fmtRelative(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
