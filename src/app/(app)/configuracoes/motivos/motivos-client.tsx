"use client"

import { useMemo, useState, useTransition } from "react"
import { Plus, Pencil, Trash2, Loader2, X, Search, ClipboardList } from "lucide-react"
import {
  createOutcomeReason, updateOutcomeReason, deleteOutcomeReason,
  type OutcomeReason,
} from "@/lib/actions/outcome-reasons"
import { EmptyState } from "@/components/ui/empty-state"
import { useConfirm } from "@/components/ui/confirm-dialog"

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR")

export function MotivosClient({ reasons }: { reasons: OutcomeReason[] }) {
  const [search, setSearch]     = useState("")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<OutcomeReason | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return reasons
    return reasons.filter((r) => r.label.toLowerCase().includes(q))
  }, [reasons, search])

  return (
    <div className="space-y-4">
      {/* busca + contagem + criar — layout da referência */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-64 max-w-full">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar…"
            className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100"><X className="size-3" /></button>
          )}
        </div>
        <span className="text-xs text-slate-400 tabular-nums">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
        <button type="button" onClick={() => setCreating(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
          <Plus className="size-3.5" /> Criar
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={search ? "Nada encontrado" : "Nenhum motivo cadastrado"}
          description={search ? "Tente outro termo." : "Motivos estruturados alimentam o relatório de vazamento — de onde o dinheiro escapa: preço, timing, concorrente."}
          action={!search ? (
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> Criar motivo
            </button>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Motivos de perda dos negócios</th>
                  <th className="text-left font-medium py-2.5 px-3">Justificativa obrigatória</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Data de criação</th>
                  <th className="text-right font-medium py-2.5 px-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => <ReasonRow key={r.id} r={r} onEdit={() => setEditing(r)} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <ReasonDialog reason={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}

function ReasonRow({ r, onEdit }: { r: OutcomeReason; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()
  const { confirm, confirmDialog } = useConfirm()

  function toggleNote() {
    startTransition(async () => {
      const res = await updateOutcomeReason(r.id, { requireNote: !r.require_note })
      if ("error" in res) alert(res.error)
    })
  }

  async function handleDelete() {
    if (!(await confirm({
      title: `Excluir "${r.label}"?`,
      body: "Negócios já perdidos com este motivo mantêm o registro (o histórico não muda).",
      confirmLabel: "Excluir",
    }))) return
    startTransition(async () => {
      const res = await deleteOutcomeReason(r.id)
      if ("error" in res) alert(res.error)
    })
  }

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
      <td className="py-2.5 px-4"><span className="text-[13px] font-medium text-slate-800">{r.label}</span></td>
      <td className="py-2.5 px-3">
        {/* toggle — mesma semântica da referência */}
        <button type="button" role="switch" aria-checked={r.require_note} onClick={toggleNote} disabled={pending}
          title={r.require_note ? "Exige justificativa ao usar" : "Não exige justificativa"}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${r.require_note ? "bg-primary" : "bg-slate-200"}`}>
          <span className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${r.require_note ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
        </button>
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500 hidden sm:table-cell">{fmtDate(r.created_at)}</td>
      <td className="py-2.5 px-4">
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={onEdit} title="Editar"
            className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <Pencil className="size-3.5" />
          </button>
          <button type="button" onClick={handleDelete} disabled={pending} title="Excluir"
            className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </button>
        </div>
        {confirmDialog}
      </td>
    </tr>
  )
}

function ReasonDialog({ reason, onClose }: { reason: OutcomeReason | null; onClose: () => void }) {
  const [label, setLabel]           = useState(reason?.label ?? "")
  const [requireNote, setRequireNote] = useState(reason?.require_note ?? true)
  const [error, setError]           = useState<string | null>(null)
  const [pending, startTransition]  = useTransition()

  function save() {
    setError(null)
    if (!label.trim()) { setError("Nome do motivo é obrigatório"); return }
    startTransition(async () => {
      const r = reason
        ? await updateOutcomeReason(reason.id, { label, requireNote })
        : await createOutcomeReason("lost", label, requireNote)
      if ("error" in r) { setError(r.error); return }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">{reason ? "Editar motivo" : "Novo motivo de perda"}</h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Motivo <span className="text-red-500">*</span></label>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80}
              onKeyDown={(e) => { if (e.key === "Enter") save() }}
              placeholder="Ex: Pós reunião: Achou caro"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
            <p className="text-[10px] text-slate-400 mt-1">Dica: prefixe pela fase (&ldquo;Lead:&rdquo;, &ldquo;Pós reunião:&rdquo;) pra ler o vazamento por etapa no painel.</p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <button type="button" role="switch" aria-checked={requireNote} onClick={() => setRequireNote((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5 ${requireNote ? "bg-primary" : "bg-slate-200"}`}>
              <span className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${requireNote ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
            </button>
            <span>
              <span className="block text-xs font-semibold text-slate-700">Justificativa obrigatória</span>
              <span className="block text-[11px] text-slate-400 mt-0.5">Ao perder com este motivo, o atendente precisa escrever o contexto (quanto, quem, por quê).</span>
            </span>
          </label>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {reason ? "Salvar" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  )
}
