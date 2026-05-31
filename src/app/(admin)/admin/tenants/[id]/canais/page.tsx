import { supabaseAdmin } from "@/lib/supabase"
import { Smartphone, Globe } from "lucide-react"

const WA_STATUS: Record<string, { label: string; tone: string }> = {
  connected:    { label: "Conectado",     tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  connecting:   { label: "Conectando",    tone: "text-sky-700 bg-sky-50 border-sky-200" },
  qr_pending:   { label: "Aguardando QR", tone: "text-amber-700 bg-amber-50 border-amber-200" },
  disconnected: { label: "Desconectado",  tone: "text-red-700 bg-red-50 border-red-200" },
}

export default async function TenantChannelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [instanceRes, widgetRes] = await Promise.all([
    supabaseAdmin.from("whatsapp_instances").select("status, phone_number, provider").eq("tenant_id", id).maybeSingle(),
    supabaseAdmin.from("site_widget_config").select("id, mode").eq("tenant_id", id).maybeSingle(),
  ])

  const wa = instanceRes.data
  const waMeta = wa ? (WA_STATUS[wa.status] ?? { label: wa.status, tone: "text-slate-600 bg-slate-50 border-slate-200" }) : null
  const widget = widgetRes.data

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* WhatsApp */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Smartphone className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">WhatsApp</h2>
            <p className="text-[11px] text-slate-400">Canal principal</p>
          </div>
        </div>
        {waMeta ? (
          <div className="space-y-2 text-xs">
            <Row label="Status"><span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${waMeta.tone}`}>{waMeta.label}</span></Row>
            <Row label="Número"><span className="font-mono text-slate-700">{wa?.phone_number ?? "—"}</span></Row>
            <Row label="Provedor"><span className="text-slate-700 capitalize">{wa?.provider ?? "—"}</span></Row>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Instância não configurada.</p>
        )}
      </div>

      {/* Site */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="size-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <Globe className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Chat no site</h2>
            <p className="text-[11px] text-slate-400">Widget</p>
          </div>
        </div>
        {widget ? (
          <div className="space-y-2 text-xs">
            <Row label="Status"><span className="inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border text-emerald-700 bg-emerald-50 border-emerald-200">Configurado</span></Row>
            <Row label="Modo"><span className="text-slate-700">{widget.mode === "chat" ? "Chat ao vivo / IA" : "Formulário"}</span></Row>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Widget não configurado.</p>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      {children}
    </div>
  )
}
