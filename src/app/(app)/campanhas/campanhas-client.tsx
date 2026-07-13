"use client"

import { useTransition, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Send, Loader2, Trash2, Clock, CheckCircle2, Pause, Ban, FileEdit, AlertTriangle, Megaphone, X } from "lucide-react"
import { deleteCampaign, getCampaignWizardData, type CampaignRow, type CampaignStatus, type CampaignWizardData } from "@/lib/actions/campaigns"
import { EmptyState } from "@/components/ui/empty-state"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { WizardClient } from "./nova/wizard-client"

const brl = (v: number | null) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null

const STATUS_META: Record<CampaignStatus, { label: string; cls: string; icon: typeof Clock }> = {
  draft:     { label: "Rascunho",  cls: "bg-slate-100 text-slate-500 border-slate-200",     icon: FileEdit },
  scheduled: { label: "Agendada",  cls: "bg-amber-50 text-amber-700 border-amber-200",       icon: Clock },
  running:   { label: "Enviando",  cls: "bg-sky-50 text-sky-700 border-sky-200",             icon: Send },
  paused:    { label: "Pausada",   cls: "bg-orange-50 text-orange-700 border-orange-200",    icon: Pause },
  done:      { label: "Concluída", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  canceled:  { label: "Cancelada", cls: "bg-slate-100 text-slate-500 border-slate-200",      icon: Ban },
  failed:    { label: "Falhou",    cls: "bg-red-50 text-red-700 border-red-200",             icon: AlertTriangle },
}

export function CampanhasClient({ campaigns, hasOfficial }: { campaigns: CampaignRow[]; hasOfficial: boolean }) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [wiz, setWiz] = useState<CampaignWizardData | null>(null)
  const [loadingWiz, setLoadingWiz] = useState(false)

  function openModal() {
    setModalOpen(true)
    if (!wiz) {
      setLoadingWiz(true)
      getCampaignWizardData().then((d) => { setWiz(d); setLoadingWiz(false) })
    }
  }

  if (!hasOfficial) {
    return (
      <EmptyState
        icon={Megaphone}
        title="Conecte um número oficial para disparar campanhas"
        description="Marketing em massa exige o WhatsApp API Oficial (Meta Cloud) — é o que protege seu número e cumpre as regras. Conecte em Integrações para começar."
        action={<Link href="/integracoes/whatsapp-oficial" className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">Conectar número oficial</Link>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-slate-400 tabular-nums">{campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}</span>
        <button type="button" onClick={openModal}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
          <Plus className="size-3.5" /> Nova campanha
        </button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nenhuma campanha ainda"
          description="Crie a primeira: escolha a audiência (uma lista consentida), o template aprovado e o número de saída — com o custo estimado antes de disparar."
          action={<button type="button" onClick={openModal} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"><Plus className="size-3.5" /> Nova campanha</button>}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Campanha</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Audiência</th>
                  <th className="text-left font-medium py-2.5 px-3">Status</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Agendada</th>
                  <th className="text-right font-medium py-2.5 px-3 hidden lg:table-cell">Custo est.</th>
                  <th className="text-right font-medium py-2.5 px-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => <Row key={c.id} c={c} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
        <b className="text-slate-500">Consentimento primeiro:</b> só entram na campanha os contatos que <b>autorizaram receber marketing</b> — o preview mostra quantos ficam de fora e por quê, antes de qualquer envio. Isso protege seu número (quality rating) e cumpre a LGPD.
      </p>

      {/* Modal GRANDE de criação */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm sm:p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-canvas w-full sm:max-w-4xl sm:rounded-2xl shadow-2xl h-full sm:h-auto sm:max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-200 bg-white shrink-0">
              <span className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0"><Megaphone className="size-4.5" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-slate-900 leading-tight">Nova campanha</h2>
                <p className="text-[11px] text-slate-400 leading-tight">Audiência · mensagem · envio · revisão — com o custo estimado antes de disparar.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} title="Fechar" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors shrink-0"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {loadingWiz || !wiz ? (
                <div className="py-24 text-center"><Loader2 className="size-5 animate-spin text-slate-300 mx-auto" /></div>
              ) : wiz.numbers.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm text-slate-500">Conecte um número oficial primeiro pra disparar campanhas.</p>
                  <Link href="/integracoes/whatsapp-oficial" className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">Conectar número oficial</Link>
                </div>
              ) : (
                <WizardClient
                  audiences={wiz.audiences} templates={wiz.templates} numbers={wiz.numbers} flows={wiz.flows}
                  onClose={() => setModalOpen(false)}
                  onCreated={(id) => { setModalOpen(false); router.push(`/campanhas/${id}`) }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ c }: { c: CampaignRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  const st = STATUS_META[c.status]
  const StIcon = st.icon
  const open = () => router.push(`/campanhas/${c.id}`)

  async function handleDelete() {
    if (!(await confirm({ title: `Excluir "${c.name}"?`, body: "A campanha e seus destinatários serão removidos. Esta ação não pode ser desfeita.", confirmLabel: "Excluir" }))) return
    startTransition(async () => {
      const r = await deleteCampaign(c.id)
      if ("error" in r) { alert(r.error); return }
      router.refresh()
    })
  }

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={open}>
      <td className="py-2.5 px-4">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{c.name}</p>
        <p className="text-[11px] text-slate-400 truncate">
          {c.template_name ?? "sem template"}
          {c.template_category && <span className={c.template_category === "MARKETING" ? "text-violet-500" : "text-sky-500"}> · {c.template_category === "MARKETING" ? "Marketing" : "Utilidade"}</span>}
          {c.recipients > 0 && <span> · {c.recipients} destinatários</span>}
        </p>
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500 hidden sm:table-cell truncate max-w-[160px]">{c.audience_label ?? "—"}</td>
      <td className="py-2.5 px-3">
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>
          <StIcon className="size-2.5" /> {st.label}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500 tabular-nums hidden md:table-cell whitespace-nowrap">{fmtDate(c.scheduled_at) ?? "—"}</td>
      <td className="py-2.5 px-3 text-xs text-slate-600 tabular-nums text-right hidden lg:table-cell">{brl(c.est_cost)}</td>
      <td className="py-2.5 px-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end">
          {["draft", "scheduled", "canceled", "failed", "done"].includes(c.status) && (
            <button type="button" onClick={handleDelete} disabled={pending} title="Excluir"
              className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            </button>
          )}
        </div>
        {confirmDialog}
      </td>
    </tr>
  )
}
