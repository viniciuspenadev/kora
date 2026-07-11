"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Plus, Pencil, Trash2, Tag as TagIcon, Loader2, X, Check, Search, Users } from "lucide-react"
import { createTag, updateTag, deleteTag } from "@/lib/actions/tags"
import { EmptyState } from "@/components/ui/empty-state"
import { useConfirm } from "@/components/ui/confirm-dialog"

interface Tag {
  id:          string
  name:        string
  color:       string
  description: string | null
  created_at:  string
  /** Contatos com a tag — a contagem CLICÁVEL que transforma tag em segmento. */
  contacts:    number
}

interface Props {
  tags: Tag[]
}

const TAG_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

export function TagsConfigClient({ tags }: Props) {
  const [editing, setEditing]   = useState<Tag | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch]     = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q))
  }, [tags, search])

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
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" /> Criar
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title={search ? "Nada encontrado" : "Você ainda não tem tags"}
          description={search ? "Tente outro termo." : "Tags organizam E segmentam: cada tag vira um público que você abre e aciona."}
          action={!search ? (
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> Criar tag
            </button>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Tag</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Descrição</th>
                  <th className="text-left font-medium py-2.5 px-3">Contatos</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Data de criação</th>
                  <th className="text-right font-medium py-2.5 px-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tag) => (
                  <tr key={tag.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: tag.color + "20", color: tag.color, border: `1px solid ${tag.color}40` }}>
                        <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 hidden md:table-cell">
                      <span className="text-xs text-slate-500 block truncate max-w-[320px]">{tag.description || <span className="text-slate-300">—</span>}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      {tag.contacts > 0 ? (
                        <Link
                          href={`/contatos?tag=${tag.id}`}
                          title="Ver este público em Contatos"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline underline-offset-2 tabular-nums"
                        >
                          <Users className="size-3" /> {tag.contacts} contato{tag.contacts !== 1 ? "s" : ""}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-300 tabular-nums">0 contatos</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-500 hidden sm:table-cell">{new Date(tag.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(tag)}
                          className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <DeleteButton tag={tag} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <TagDialog
          tag={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function DeleteButton({ tag }: { tag: Tag }) {
  const [pending, startTransition] = useTransition()
  const { confirm, confirmDialog } = useConfirm()

  async function handleDelete() {
    if (!(await confirm({ title: `Excluir a tag "${tag.name}"?`, body: "Ela será removida de todos os contatos e conversas. Esta ação não pode ser desfeita.", confirmLabel: "Excluir" }))) return
    startTransition(async () => {
      await deleteTag(tag.id)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
        title="Excluir"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
      {confirmDialog}
    </>
  )
}

function TagDialog({ tag, onClose }: { tag: Tag | null; onClose: () => void }) {
  const [name, setName]               = useState(tag?.name ?? "")
  const [color, setColor]             = useState(tag?.color ?? TAG_COLORS[0])
  const [description, setDescription] = useState(tag?.description ?? "")
  const [pending, startTransition]    = useTransition()
  const [error, setError]             = useState<string | null>(null)

  function handleSave() {
    setError(null)
    if (!name.trim()) {
      setError("Nome é obrigatório")
      return
    }
    startTransition(async () => {
      try {
        if (tag) {
          await updateTag(tag.id, { name: name.trim(), color, description: description.trim() || null })
        } else {
          await createTag(name.trim(), color, description.trim() || undefined)
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
        className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">
            {tag ? "Editar tag" : "Nova tag"}
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
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: VIP, Lead quente, Urgente"
              maxLength={30}
              autoFocus
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Cor</label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="size-8 rounded-lg ring-2 ring-offset-2 transition-all"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px ${c}` : undefined,
                  }}
                  aria-label={`Cor ${c}`}
                >
                  {color === c && <Check className="size-4 text-white mx-auto" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Descrição (opcional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Como ou quando usar esta tag"
              maxLength={120}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
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
            {tag ? "Salvar" : "Criar tag"}
          </button>
        </div>
      </div>
    </div>
  )
}
