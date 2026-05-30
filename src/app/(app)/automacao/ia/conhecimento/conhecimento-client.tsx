"use client"

import { useState, useTransition } from "react"
import {
  BookOpen, Plus, Pencil, Trash2, Loader2, CheckCircle2, AlertCircle,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  createKnowledgeItem, updateKnowledgeItem, deleteKnowledgeItem,
} from "@/lib/actions/ai/knowledge"
import type { AIKnowledgeItem } from "@/types/ai"

const INPUT_CLASS =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const TEXTAREA_CLASS =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"

interface Props {
  items: AIKnowledgeItem[]
}

export function ConhecimentoClient({ items }: Props) {
  const [editing, setEditing]   = useState<AIKnowledgeItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          {items.length === 0
            ? "Sem itens ainda. Cada item é um fato que a IA pode usar pra responder."
            : `${items.length} ${items.length === 1 ? "item" : "itens"}. A IA consulta todos ao responder.`}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0"
        >
          <Plus className="size-3.5" />
          Novo item
        </button>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-100 text-success"
            : "bg-danger-bg border border-red-100 text-danger"
        }`}>
          {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
          {feedback.text}
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={BookOpen}
          title="Sua base está vazia"
          description={'Exemplos: "Horário de atendimento", "Política de troca", "Formas de pagamento". A IA usa esses fatos pra responder sem inventar.'}
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 bg-white rounded-xl border border-slate-200 shadow-card px-4 py-3"
            >
              <div className="size-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0 mt-0.5">
                <BookOpen className="size-4 text-primary-600" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  {item.category && (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {item.category}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">{item.content}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                  title="Editar"
                >
                  <Pencil className="size-3.5" />
                </button>
                <DeleteButton item={item} onFeedback={flash} />
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ItemSheet
          item={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onFeedback={flash}
        />
      )}
    </div>
  )
}

function ItemSheet({
  item, onClose, onFeedback,
}: {
  item:       AIKnowledgeItem | null
  onClose:    () => void
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [title, setTitle]       = useState(item?.title ?? "")
  const [category, setCategory] = useState(item?.category ?? "")
  const [content, setContent]   = useState(item?.content ?? "")
  const [error, setError]       = useState<string | null>(null)
  const [pending, startT]       = useTransition()

  function handleSave() {
    setError(null)
    startT(async () => {
      const input = { title, category: category || null, content }
      const result = item
        ? await updateKnowledgeItem(item.id, input)
        : await createKnowledgeItem(input)
      if (result?.error) setError(result.error)
      else {
        onFeedback("ok", item ? "Item atualizado" : "Item criado")
        onClose()
      }
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={item ? "Editar item" : "Novo item"}
      description="Um fato que a IA pode usar pra responder"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Salvar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-danger-bg border border-red-100 px-3 py-2">
            <AlertCircle className="size-3.5 text-danger shrink-0" />
            <p className="text-xs text-red-800">{error}</p>
          </div>
        )}
        <FormRow label="Título" required hint="Como você se refere a esse fato">
          <input
            className={INPUT_CLASS}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Horário de atendimento"
            autoFocus
          />
        </FormRow>
        <FormRow label="Categoria" hint="Opcional — agrupa itens parecidos">
          <input
            className={INPUT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Ex: FAQ, Política, Catálogo"
          />
        </FormRow>
        <FormRow label="Conteúdo" required hint="O fato em si, como a IA deve saber">
          <textarea
            className={TEXTAREA_CLASS}
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Ex: Atendemos de segunda a sexta, das 8h às 18h. Sábado das 8h às 12h. Domingo fechado."
          />
        </FormRow>
      </div>
    </Sheet>
  )
}

function DeleteButton({
  item, onFeedback,
}: {
  item:       AIKnowledgeItem
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [confirm, setConfirm] = useState(false)

  async function handleDelete() {
    const result = await deleteKnowledgeItem(item.id)
    if (result?.error) onFeedback("error", result.error)
    else onFeedback("ok", `"${item.title}" excluído`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors"
        title="Excluir"
      >
        <Trash2 className="size-3.5" />
      </button>
      <DangerConfirm
        open={confirm}
        title={`Excluir "${item.title}"?`}
        body={<>Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}
