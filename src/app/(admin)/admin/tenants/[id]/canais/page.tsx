import { supabaseAdmin } from "@/lib/supabase"
import { Smartphone, Globe, BadgeCheck } from "lucide-react"
import { CloudTestSend } from "@/components/admin/cloud-test-send"

const WA_STATUS: Record<string, { label: string; tone: string }> = {
  connected:    { label: "Conectado",     tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  connecting:   { label: "Conectando",    tone: "text-sky-700 bg-sky-50 border-sky-200" },
  qr_pending:   { label: "Aguardando QR", tone: "text-amber-700 bg-amber-50 border-amber-200" },
  disconnected: { label: "Desconectado",  tone: "text-red-700 bg-red-50 border-red-200" },
}

interface InstanceRow {
  id: string; status: string; phone_number: string | null
  provider: string | null; meta_phone_number_id: string | null
}

export default async function TenantChannelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [instRes, widgetRes] = await Promise.all([
    supabaseAdmin.from("whatsapp_instances")
      .select("id, status, phone_number, provider, meta_phone_number_id")
      .eq("tenant_id", id).order("created_at", { ascending: true }),
    supabaseAdmin.from("site_widget_config").select("id, mode").eq("tenant_id", id).maybeSingle(),
  ])

  const instances = (instRes.data ?? []) as InstanceRow[]
  const widget = widgetRes.data
  const hasMeta = instances.some((i) => i.provider === "meta_cloud")

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Instâncias WhatsApp (N) */}
      {instances.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Smartphone className="size-4" /></div>
            <h2 className="text-sm font-bold text-slate-900">WhatsApp</h2>
          </div>
          <p className="text-sm text-slate-400">Nenhuma instância configurada.</p>
        </div>
      )}
      {instances.map((wa) => {
        const isMeta = wa.provider === "meta_cloud"
        const meta = WA_STATUS[wa.status] ?? { label: wa.status, tone: "text-slate-600 bg-slate-50 border-slate-200" }
        const number = isMeta ? (wa.meta_phone_number_id ? `ID ${wa.meta_phone_number_id}` : "—") : (wa.phone_number ?? "—")
        return (
          <div key={wa.id} className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${isMeta ? "bg-primary-50 text-primary-600" : "bg-emerald-50 text-emerald-600"}`}>
                {isMeta ? <BadgeCheck className="size-4" /> : <Smartphone className="size-4" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900">{isMeta ? "WhatsApp API Oficial" : "WhatsApp (QR)"}</h2>
                <p className="text-[11px] text-slate-400">{isMeta ? "Meta Cloud API" : "Baileys / Evolution"}</p>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <Row label="Status"><span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${meta.tone}`}>{meta.label}</span></Row>
              <Row label={isMeta ? "Phone Number ID" : "Número"}><span className="font-mono text-slate-700">{number}</span></Row>
            </div>
          </div>
        )
      })}

      {/* Envio de teste pela API oficial (vídeo do App Review) */}
      {hasMeta && <CloudTestSend tenantId={id} />}

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
