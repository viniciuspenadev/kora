"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Loader2, BookOpen, Pencil, Trash2, CheckCircle2, AlertCircle, X } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { createKnowledge, updateKnowledge, deleteKnowledge } from "@/lib/actions/studio/knowledge"
import type { StudioKnowledgeItem } from "@/types/studio"

const INPUT = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const AREA  = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"

export function KnowledgeClient({ items }: { items: StudioKnowledgeItem[] }) {
  const router = useRouter()
  const [editing, setEditing]   = useState<string | "new" | null>(null)
  const [title, setTitle]       = useState("")
  const [content, setContent]   = useState("")
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function openNew() { setEditing("new"); setTitle(""); setContent(""); setFeedback(null) }
  function openEdit(it: StudioKnowledgeItem) { setEditing(it.id); setTitle(it.title); setContent(it.content); setFeedback(null) }
  function cancel() { setEditing(null); setFeedback(null) }

  function save() {
    setFeedback(null)
    startTransition(async () => {
      const r = editing === "new"
        ? await createKnowledge({ title, content })
        : await updateKnowledge(editing as string, { title, content })
      if (r?.error) { setFeedback({ kind: "error", text: r.error }); return }
      setEditing(null)
      router.refresh()
    })
  }

  function confirmDelete(id: string) {
    startTransition(async () => {
      await deleteKnowledge(id)
      setDeleting(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {editing === null && (
        <div className="flex justify-end">
          <button type="button" onClick={openNew}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
            <Plus className="size-3.5" /> Novo item
          </button>
        </div>
      )}

      {/* Editor inline */}
      {editing !== null && (
        <div className="rounded-xl border border-primary-200 bg-white shadow-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">{editing === "new" ? "Novo item" : "Editar item"}</h3>
            <button type="button" onClick={cancel} className="text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
          </div>
          <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ex: Nossos serviços e preços)" />
          <textarea className={AREA} rows={8} value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="Escreva o que a IA precisa saber: serviços, preços, políticas, FAQ, horários… Pode colar textos longos — quebramos em pedaços e indexamos automaticamente." />
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar e indexar
            </button>
            <button type="button" onClick={cancel} className="h-9 px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            {feedback && (
              <span className={`inline-flex items-center gap-1.5 text-xs ${feedback.kind === "ok" ? "text-success" : "text-danger"}`}>
                {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
                {feedback.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Lista */}
      {items.length === 0 && editing === null ? (
        <EmptyState
          icon={BookOpen}
          title="Base vazia"
          description="Ensine sua IA sobre o negócio: serviços, preços, políticas, FAQ. Ela consulta isto antes de responder — em vez de transferir ou inventar."
          action={
            <button type="button" onClick={openNew}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> Adicionar primeiro item
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                <BookOpen className="size-5 text-primary-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{it.title}</p>
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{it.content}</p>
              </div>
              <button type="button" onClick={() => openEdit(it)}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-primary-600 hover:bg-slate-100 rounded-lg" aria-label="Editar">
                <Pencil className="size-4" />
              </button>
              <button type="button" onClick={() => setDeleting(it.id)}
                className="inline-flex items-center justify-center size-8 text-slate-400 hover:text-danger hover:bg-slate-100 rounded-lg" aria-label="Excluir">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <DangerConfirm
        open={!!deleting}
        title="Excluir item?"
        body={<>O item e seus trechos indexados são removidos. A IA deixa de saber disto.</>}
        confirmLabel="Excluir"
        onConfirm={() => { if (deleting) confirmDelete(deleting) }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
