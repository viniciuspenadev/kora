"use client"

import { useState, useMemo, useTransition } from "react"
import { toast } from "sonner"
import { FileText, MessageSquare, ScrollText, Plus, Pencil, Trash2, Check, Loader2, X } from "lucide-react"
import { RichEditor } from "@/components/commercial/rich-editor"
import { richDocToPlain, isEmptyRichDoc, type RichDoc } from "@/lib/commercial/richdoc"
import {
  createQuoteTemplate, updateQuoteTemplate, setTemplateActive, setTemplateAlwaysInclude,
  deleteQuoteTemplate, type QuoteTemplate, type TemplateContext,
} from "@/lib/actions/quote-templates"

const CTX: { key: TemplateContext; label: string; icon: typeof FileText; hint: string }[] = [
  { key: "condicoes",   label: "Condições",   icon: FileText,      hint: "Modelos de condições de pagamento" },
  { key: "observacoes", label: "Observações", icon: MessageSquare, hint: "Notas visíveis ao cliente" },
  { key: "contrato",    label: "Contrato",    icon: ScrollText,    hint: "Cláusulas e texto do contrato" },
]

export function TemplatesClient({ initial }: { initial: QuoteTemplate[] }) {
  const [items, setItems] = useState<QuoteTemplate[]>(initial)
  const [ctx, setCtx] = useState<TemplateContext>("condicoes")
  const [pending, startTransition] = useTransition()

  const byCtx = useMemo(() => {
    const m: Record<TemplateContext, QuoteTemplate[]> = { condicoes: [], observacoes: [], contrato: [] }
    for (const t of items) m[t.context].push(t)
    return m
  }, [items])
  const list = byCtx[ctx]

  function patch(id: string, p: Partial<QuoteTemplate>) {
    setItems((xs) => xs.map((x) => x.id === id ? { ...x, ...p } : x))
  }

  function addNew() {
    startTransition(async () => {
      const r = await createQuoteTemplate(ctx, "Novo modelo")
      if (r.error || !r.id) { toast.error(r.error ?? "Não deu pra criar."); return }
      setItems((xs) => [...xs, { id: r.id!, context: ctx, title: "Novo modelo", body: { v: 1, blocks: [] }, active: true, always_include: false, position: xs.length }])
    })
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-5">
      {/* Menu lateral — contextos */}
      <nav className="flex md:flex-col gap-1">
        {CTX.map((c) => {
          const on = ctx === c.key
          const Icon = c.icon
          const n = byCtx[c.key].length
          return (
            <button key={c.key} onClick={() => setCtx(c.key)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${on ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon className={`size-4 shrink-0 ${on ? "text-primary-600" : "text-slate-400"}`} />
              <span className="text-sm font-medium flex-1">{c.label}</span>
              <span className="text-[11px] font-semibold tabular-nums text-slate-400">{n}</span>
            </button>
          )
        })}
      </nav>

      {/* Lista do contexto */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-400">{CTX.find((c) => c.key === ctx)?.hint}</p>
          <button onClick={addNew} disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-primary hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50">
            <Plus className="size-3.5" /> Novo modelo
          </button>
        </div>

        {list.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl px-4 py-10 text-center">
            <p className="text-sm text-slate-500">Nenhum modelo em {CTX.find((c) => c.key === ctx)?.label.toLowerCase()} ainda.</p>
            <p className="text-xs text-slate-400 mt-1">Crie os seus com o botão “Novo modelo”.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {list.map((t) => (
              <TemplateRow key={t.id} tpl={t} onPatch={(p) => patch(t.id, p)} onRemove={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TemplateRow({ tpl, onPatch, onRemove }: {
  tpl: QuoteTemplate; onPatch: (p: Partial<QuoteTemplate>) => void; onRemove: () => void
}) {
  const [editing, setEditing] = useState(isEmptyRichDoc(tpl.body))
  const [title, setTitle] = useState(tpl.title)
  const [body, setBody] = useState<RichDoc>(tpl.body)
  const [pending, startTransition] = useTransition()
  const [confirmDel, setConfirmDel] = useState(false)

  function save() {
    startTransition(async () => {
      const r = await updateQuoteTemplate(tpl.id, { title, body })
      if (r.error) { toast.error(r.error); return }
      onPatch({ title, body })
      setEditing(false)
    })
  }
  function toggleActive() {
    const next = !tpl.active
    onPatch({ active: next, ...(next ? {} : { always_include: false }) })   // otimista
    startTransition(async () => { const r = await setTemplateActive(tpl.id, next); if (r.error) { toast.error(r.error); onPatch({ active: !next }) } })
  }
  function toggleAlways() {
    const next = !tpl.always_include
    onPatch({ always_include: next, ...(next ? { active: true } : {}) })
    startTransition(async () => { const r = await setTemplateAlwaysInclude(tpl.id, next); if (r.error) { toast.error(r.error); onPatch({ always_include: !next }) } })
  }
  function remove() {
    startTransition(async () => { const r = await deleteQuoteTemplate(tpl.id); if (r.error) { toast.error(r.error); return } onRemove() })
  }

  if (editing) {
    return (
      <div className="border border-slate-200 rounded-xl p-3.5 bg-white">
        <div className="flex items-center gap-2 mb-2.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome do modelo"
            className="flex-1 h-9 px-3 text-sm font-semibold border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <button onClick={save} disabled={pending || !title.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-primary hover:bg-primary-700 rounded-lg disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Salvar
          </button>
        </div>
        <RichEditor value={body} onChange={setBody} placeholder="Texto do modelo…" minHeight={220} />
      </div>
    )
  }

  return (
    <div className={`border rounded-xl px-3.5 py-3 bg-white ${tpl.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900">{tpl.title}</p>
            {tpl.always_include && (
              <span className="text-[9.5px] font-bold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">Sempre inclui</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{richDocToPlain(tpl.body) || "Vazio"}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEditing(true)} title="Editar"
            className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
          {confirmDel ? (
            <span className="inline-flex items-center gap-1">
              <button onClick={remove} disabled={pending} className="h-8 px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50 rounded-lg">Apagar</button>
              <button onClick={() => setConfirmDel(false)} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-3.5" /></button>
            </span>
          ) : (
            <button onClick={() => setConfirmDel(true)} title="Apagar"
              className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button>
          )}
        </div>
      </div>

      {/* Governança: Ativo · Sempre incluir */}
      <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-slate-100">
        <Toggle on={tpl.active} onClick={toggleActive} label="Ativo" hint="Disponível pro time inserir" />
        <Toggle on={tpl.always_include} onClick={toggleAlways} label="Sempre incluir" hint="Entra sozinho em toda cotação" />
      </div>
    </div>
  )
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button onClick={onClick} title={hint} className="inline-flex items-center gap-2 group">
      {/* Trilho relativo + bolinha ABSOLUTA (não depende de flex pra posicionar —
          evitava a bolinha vazar do trilho). */}
      <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-primary" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
      </span>
      <span className={`text-xs font-medium ${on ? "text-slate-700" : "text-slate-400"}`}>{label}</span>
    </button>
  )
}
