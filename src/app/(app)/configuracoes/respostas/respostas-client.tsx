"use client"

import { useState, useTransition } from "react"
import { Plus, Pencil, Trash2, MessageSquare, Loader2, X } from "lucide-react"
import { createQuickReply, updateQuickReply, deleteQuickReply } from "@/lib/actions/chat"
import { EmptyState } from "@/components/ui/empty-state"
import type { ChatQuickReply } from "@/types/chat"

interface Props {
  quickReplies: ChatQuickReply[]
}

export function RespostasConfigClient({ quickReplies }: Props) {
  const [editing, setEditing]   = useState<ChatQuickReply | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {quickReplies.length === 0
            ? "Nenhuma resposta rápida criada ainda."
            : `${quickReplies.length} ${quickReplies.length === 1 ? "resposta" : "respostas"}`}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" />
          Nova resposta
        </button>
      </div>

      {quickReplies.length === 0 && !creating ? (
        <EmptyState
          icon={MessageSquare}
          title="Nenhuma resposta rápida"
          description="Crie atalhos como /preco ou /horario — o time digita o atalho no chat e a mensagem aparece pronta."
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card divide-y divide-slate-100 overflow-hidden">
          {quickReplies.map((qr) => (
            <div key={qr.id} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <code className="text-[11px] font-mono font-semibold text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
                    {qr.shortcut}
                  </code>
                  <p className="text-xs font-semibold text-slate-900 truncate">{qr.title}</p>
                </div>
                <p className="text-xs text-slate-500 line-clamp-2 whitespace-pre-line">{qr.content}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditing(qr)}
                  className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                  title="Editar"
                >
                  <Pencil className="size-3.5" />
                </button>
                <DeleteButton qr={qr} />
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <RespostaDialog
          qr={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function DeleteButton({ qr }: { qr: ChatQuickReply }) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`Excluir a resposta "${qr.title}"?`)) return
    startTransition(async () => {
      await deleteQuickReply(qr.id)
    })
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
      title="Excluir"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  )
}

function RespostaDialog({ qr, onClose }: { qr: ChatQuickReply | null; onClose: () => void }) {
  const [shortcut, setShortcut] = useState((qr?.shortcut ?? "").replace(/^\//, ""))
  const [title, setTitle]       = useState(qr?.title ?? "")
  const [content, setContent]   = useState(qr?.content ?? "")
  const [pending, startTransition] = useTransition()
  const [error, setError]       = useState<string | null>(null)

  function handleSave() {
    setError(null)
    const cleanShortcut = shortcut.trim().replace(/^\//, "").replace(/[^a-z0-9_-]/gi, "")
    if (!cleanShortcut) {
      setError("Atalho é obrigatório")
      return
    }
    if (!title.trim()) {
      setError("Título é obrigatório")
      return
    }
    if (!content.trim()) {
      setError("Conteúdo é obrigatório")
      return
    }

    startTransition(async () => {
      try {
        if (qr) {
          await updateQuickReply(qr.id, {
            shortcut: `/${cleanShortcut}`,
            title:    title.trim(),
            content:  content.trim(),
          })
        } else {
          await createQuickReply({
            shortcut: `/${cleanShortcut}`,
            title:    title.trim(),
            content:  content.trim(),
          })
        }
        onClose()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {qr ? "Editar resposta" : "Nova resposta rápida"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Atalho</label>
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40">
                <span className="pl-3 text-sm text-slate-400 font-mono">/</span>
                <input
                  type="text"
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value.toLowerCase())}
                  placeholder="preco"
                  maxLength={20}
                  autoFocus
                  className="w-full px-1 py-2 text-sm bg-transparent focus:outline-none font-mono"
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Título</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tabela de preços"
                maxLength={50}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Mensagem</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Texto que será enviado quando o atendente digitar o atalho no chat."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Você pode usar quebras de linha. Emojis também funcionam.
            </p>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {qr ? "Salvar" : "Criar resposta"}
          </button>
        </div>
      </div>
    </div>
  )
}
