import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Megaphone, Users, MessageSquareText, Send, ShieldCheck, Clock, DollarSign } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getCampaign } from "@/lib/actions/campaigns"

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null

const STATUS_PT: Record<string, string> = {
  draft: "Rascunho", scheduled: "Agendada", running: "Enviando", paused: "Pausada",
  done: "Concluída", canceled: "Cancelada", failed: "Falhou",
}

export default async function CampanhaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "broadcasts"))) redirect("/inbox")

  const { id } = await params
  const c = await getCampaign(id)
  if ("error" in c) notFound()

  const funnel = [
    { key: "queued",    label: "Na fila" },
    { key: "sent",      label: "Enviadas" },
    { key: "delivered", label: "Entregues" },
    { key: "read",      label: "Lidas" },
    { key: "replied",   label: "Responderam" },
  ]
  const hasRecipients = c.recipients > 0

  return (
    <PageShell
      title={c.name}
      description={`Campanha · ${STATUS_PT[c.status] ?? c.status}`}
      icon={Megaphone}
      actions={
        <Link href="/campanhas" className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      }
    >
      <div className="max-w-3xl space-y-4">
        {/* Resumo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Info icon={Users} label="Audiência" value={c.audience_label ?? "—"} />
          <Info icon={MessageSquareText} label="Template" value={c.template_name ? `${c.template_name}${c.template_category ? ` · ${c.template_category === "MARKETING" ? "Marketing" : "Utilidade"}` : ""}` : "—"} />
          <Info icon={Send} label="Número de saída" value={c.instance_label ?? "—"} />
          <Info icon={Clock} label="Quando" value={c.scheduled_at ? fmt(c.scheduled_at)! : "Rascunho (manual)"} />
          <Info icon={ShieldCheck} label="Opt-out" value={c.opt_out_enabled ? "Ativado" : "Desativado"} />
          <Info icon={DollarSign} label="Custo estimado" value={brl(c.est_cost)} />
        </div>

        {/* Funil de resultado */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Resultado</h3>
          {hasRecipients ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {funnel.map((f) => (
                <div key={f.key} className="rounded-lg border border-slate-200 p-3 text-center">
                  <p className="text-xl font-extrabold text-slate-900 tabular-nums">{c.byStatus[f.key] ?? 0}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{f.label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed">
              Os destinatários são materializados quando a campanha dispara. O <b>motor de envio</b> (fila, ritmo, status ao vivo e funil até o negócio ganho) chega na próxima entrega — por ora, a campanha está registrada e pronta.
            </p>
          )}
        </div>
      </div>
    </PageShell>
  )
}

function Info({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-xs font-semibold text-slate-800 truncate">{value}</p>
      </div>
    </div>
  )
}
