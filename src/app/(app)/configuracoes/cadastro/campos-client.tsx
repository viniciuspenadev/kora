"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Loader2, Check, X } from "lucide-react"
import {
  createContactField, updateContactField, deleteContactField,
  type ContactFieldDef, type ContactFieldType,
} from "@/lib/actions/custom-fields"

const TYPES: { v: ContactFieldType; label: string }[] = [
  { v: "text", label: "Texto" }, { v: "number", label: "Número" }, { v: "date", label: "Data" },
  { v: "select", label: "Lista de opções" }, { v: "bool", label: "Sim / Não" },
]
const typeLabel = (t: ContactFieldType) => TYPES.find((x) => x.v === t)?.label ?? t
const inputCls = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"

export function CamposClient({ fields }: { fields: ContactFieldDef[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [label, setLabel]   = useState("")
  const [type, setType]     = useState<ContactFieldType>("text")
  const [options, setOptions] = useState("")
  const [error, setError]   = useState<string | null>(null)

  function add() {
    if (!label.trim()) { setError("Dê um nome ao campo."); return }
    setError(null)
    start(async () => {
      const r = await createContactField({ label, type, options: type === "select" ? options.split("\n").map((s) => s.trim()).filter(Boolean) : undefined })
      if ("error" in r) { setError(r.error); return }
      setLabel(""); setType("text"); setOptions(""); setAdding(false); router.refresh()
    })
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 h-12 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">{fields.length} campo{fields.length !== 1 ? "s" : ""}</p>
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> Novo campo
            </button>
          )}
        </div>

        {adding && (
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Nome do campo</span>
                <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Convênio" className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Tipo</span>
                <select value={type} onChange={(e) => setType(e.target.value as ContactFieldType)} className={inputCls}>
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </label>
            </div>
            {type === "select" && (
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Opções <span className="font-normal text-slate-400">· uma por linha</span></span>
                <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={3} placeholder={"Amil\nBradesco\nUnimed"} className={`${inputCls} h-auto py-2 resize-none`} />
              </label>
            )}
            {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={add} disabled={pending} className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
                {pending && <Loader2 className="size-3.5 animate-spin" />} Criar campo
              </button>
              <button type="button" onClick={() => { setAdding(false); setError(null) }} className="h-8 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            </div>
          </div>
        )}

        {fields.length === 0 && !adding ? (
          <p className="px-4 py-10 text-center text-xs text-slate-400">Nenhum campo ainda. Crie o primeiro pra adaptar o cadastro ao seu negócio.</p>
        ) : (
          <ul>
            {fields.map((f) => <FieldRow key={f.id} field={f} disabled={pending} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

function FieldRow({ field, disabled }: { field: ContactFieldDef; disabled: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(field.label)
  const [options, setOptions] = useState((field.options ?? []).join("\n"))
  const busy = pending || disabled

  function save() {
    start(async () => {
      await updateContactField(field.id, { label, options: field.type === "select" ? options.split("\n").map((s) => s.trim()).filter(Boolean) : undefined })
      setEditing(false); router.refresh()
    })
  }
  function toggle() { start(async () => { await updateContactField(field.id, { active: !field.active }); router.refresh() }) }
  function remove() { start(async () => { await deleteContactField(field.id); router.refresh() }) }

  if (editing) return (
    <li className="px-4 py-3 border-b border-slate-100 last:border-0 bg-slate-50/50 space-y-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      {field.type === "select" && <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} placeholder="Uma opção por linha" />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1 h-7 px-3 text-xs font-semibold bg-primary text-white rounded-lg disabled:opacity-50"><Check className="size-3" /> Salvar</button>
        <button type="button" onClick={() => { setEditing(false); setLabel(field.label) }} className="h-7 px-2 text-xs text-slate-500">Cancelar</button>
      </div>
    </li>
  )

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setEditing(true)} className={`text-sm font-medium text-left ${field.active ? "text-slate-900" : "text-slate-400 line-through"} hover:text-primary-700`}>{field.label}</button>
        <p className="text-[11px] text-slate-400">{typeLabel(field.type)}{field.type === "select" && field.options ? ` · ${field.options.length} opções` : ""}</p>
      </div>
      <button type="button" onClick={toggle} disabled={busy} title={field.active ? "Ativo" : "Inativo"}
        className={`h-6 px-2 text-[10px] font-semibold rounded-full transition-colors ${field.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
        {field.active ? "Ativo" : "Inativo"}
      </button>
      <button type="button" onClick={remove} disabled={busy} title="Excluir" className="size-7 grid place-items-center rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
    </li>
  )
}
