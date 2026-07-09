"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Plus, Trash2, Loader2, Check, ChevronDown, X,
  Type, Hash, Calendar, CircleDot, ListChecks, ToggleLeft,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import {
  createCustomField, updateCustomField, deleteCustomField,
  type CustomFieldDef, type CustomFieldType, type CustomFieldEntity,
} from "@/lib/actions/custom-fields"

// ── Tipos de campo (o dono escolhe da lista — fechado, evita bagunça) ─────────
const TYPES: { v: CustomFieldType; label: string; hint: string; icon: typeof Type }[] = [
  { v: "text",   label: "Texto",            hint: "Campo aberto",   icon: Type },
  { v: "number", label: "Número",           hint: "Valor numérico", icon: Hash },
  { v: "date",   label: "Data",             hint: "DD/MM/AAAA",     icon: Calendar },
  { v: "select", label: "Seleção única",    hint: "Escolhe 1 item", icon: CircleDot },
  { v: "multi",  label: "Seleção múltipla", hint: "Escolhe vários", icon: ListChecks },
  { v: "bool",   label: "Sim / Não",        hint: "Liga/desliga",   icon: ToggleLeft },
]
const typeLabel = (t: CustomFieldType) => TYPES.find((x) => x.v === t)?.label ?? t
const hasOptions = (t: CustomFieldType) => t === "select" || t === "multi"

type Ent = "contact" | "deal" | "product"
const TABS: { ent: Ent; label: string }[] = [
  { ent: "contact", label: "Contato" },
  { ent: "deal",    label: "Negócio" },
  { ent: "product", label: "Produto e Serviço" },
]
const entLabel = (e: Ent) => TABS.find((t) => t.ent === e)!.label
const entLower = (e: Ent) => entLabel(e).toLowerCase()

// ── Sugestões + campos padrões (referência estática por entidade) ─────────────
const SUGGESTIONS: Record<Ent, { label: string; type: CustomFieldType }[]> = {
  contact: [{ label: "Convênio", type: "select" }, { label: "Profissão", type: "text" }, { label: "Cidade", type: "text" }, { label: "Instagram", type: "text" }],
  deal:    [{ label: "Orçamento", type: "number" }, { label: "Motivo da perda", type: "select" }, { label: "Concorrente", type: "text" }, { label: "Nº da proposta", type: "text" }],
  product: [{ label: "Garantia", type: "text" }, { label: "Material", type: "text" }, { label: "Fornecedor", type: "text" }, { label: "Peso", type: "number" }],
}
const DEFAULTS: Record<Ent, { label: string; sub: string }[]> = {
  contact: [{ label: "Nome", sub: "Texto livre" }, { label: "Telefone", sub: "WhatsApp" }, { label: "E-mail", sub: "Texto livre" }, { label: "Empresa", sub: "Vínculo" }, { label: "CPF / CNPJ", sub: "Documento" }, { label: "Aniversário", sub: "Data" }],
  deal:    [{ label: "Nome do negócio", sub: "Texto livre" }, { label: "Empresa", sub: "Vínculo" }, { label: "Valor estimado", sub: "Moeda (R$)" }, { label: "Etapa do funil", sub: "Seleção única" }, { label: "Previsão de fechamento", sub: "Data" }, { label: "Responsável", sub: "Atendente" }],
  product: [{ label: "Nome", sub: "Texto livre" }, { label: "SKU", sub: "Código" }, { label: "Categoria", sub: "Seleção única" }, { label: "Preço", sub: "Moeda (R$)" }, { label: "Cobrança", sub: "Avulso · Mensal · Anual" }],
}

const inputCls = "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"

export function CamposClient({ fields }: { fields: Record<Ent, CustomFieldDef[]> }) {
  const [tab, setTab] = useState<Ent>("contact")
  const [modal, setModal] = useState(false)
  const custom = fields[tab]

  return (
    <div className="space-y-5">
      {/* Abas + ação na MESMA linha */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map((t) => {
            const n = fields[t.ent].length
            const on = t.ent === tab
            return (
              <button key={t.ent} type="button" onClick={() => setTab(t.ent)}
                className={`relative px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${on ? "text-primary" : "text-slate-500 hover:text-slate-900"}`}>
                {t.label}
                {n > 0 && <span className="ml-1.5 text-[11px] font-bold bg-primary-50 text-primary rounded-full px-1.5 py-0.5">{n}</span>}
                {on && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded bg-primary" />}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => setModal(true)}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
          <Plus className="size-4" /> Criar campo
        </button>
      </div>

      {/* Sugestão de campos */}
      <Section title="Sugestão de campos" hint={`comuns pra ${entLower(tab)}, adicione num clique`}>
        <ul className="divide-y divide-slate-100">
          {SUGGESTIONS[tab].map((s) => <SuggestionRow key={s.label} entity={tab} label={s.label} type={s.type} />)}
        </ul>
      </Section>

      {/* Campos padrões (referência) */}
      <Section title="Campos padrões" hint="os fixos do Kora" defaultOpen={false}>
        <ul className="divide-y divide-slate-100">
          {DEFAULTS[tab].map((f) => (
            <li key={f.label} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{f.label}</p>
                <p className="text-[11px] text-slate-400">{f.sub}</p>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Padrão</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Campos personalizados */}
      <Section title="Campos personalizados" hint="criados por você" badge={custom.length}>
        {custom.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-slate-700 mb-1">Nenhum campo personalizado ainda</p>
            <p className="text-xs text-slate-400 mb-4 max-w-sm mx-auto">Crie campos próprios pra {entLower(tab)} — eles aparecem na ficha de todos os registros.</p>
            <button type="button" onClick={() => setModal(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg mx-auto">
              <Plus className="size-3.5" /> Criar campo
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {custom.map((f) => <FieldRow key={f.id} field={f} />)}
          </ul>
        )}
      </Section>

      {modal && <CreateModal defaultEntity={tab} onClose={() => setModal(false)} />}
    </div>
  )
}

// ── Section colapsável ────────────────────────────────────────────────────────
function Section({ title, hint, badge, defaultOpen = true, children }: {
  title: string; hint?: string; badge?: number; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 w-full px-4 h-12 text-left hover:bg-slate-50/50">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {badge !== undefined && badge > 0 && <span className="text-[11px] font-bold bg-primary-50 text-primary rounded-full px-1.5 py-0.5">{badge}</span>}
        {hint && <span className="text-xs text-slate-400 font-normal">— {hint}</span>}
        <ChevronDown className={`ml-auto size-4 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="border-t border-slate-100">{children}</div>}
    </div>
  )
}

// ── Linha de sugestão (quick-add) ─────────────────────────────────────────────
function SuggestionRow({ entity, label, type }: { entity: Ent; label: string; type: CustomFieldType }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  function add() {
    start(async () => { await createCustomField({ entity, label, type }); router.refresh() })
  }
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/50">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-[11px] text-slate-400">{typeLabel(type)}</p>
      </div>
      <button type="button" onClick={add} disabled={pending}
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:bg-primary-50 rounded-lg px-2.5 py-1.5 disabled:opacity-50">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Adicionar
      </button>
    </li>
  )
}

// ── Linha de campo personalizado (editar/excluir) ─────────────────────────────
function FieldRow({ field }: { field: CustomFieldDef }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(field.label)
  const [options, setOptions] = useState((field.options ?? []).join("\n"))

  function save() {
    start(async () => {
      await updateCustomField(field.id, { label, options: hasOptions(field.type) ? options.split("\n").map((s) => s.trim()).filter(Boolean) : undefined })
      setEditing(false); router.refresh()
    })
  }
  function toggle() { start(async () => { await updateCustomField(field.id, { active: !field.active }); router.refresh() }) }
  function remove() { start(async () => { await deleteCustomField(field.id); router.refresh() }) }

  if (editing) return (
    <li className="px-4 py-3 bg-slate-50/50 space-y-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      {hasOptions(field.type) && <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={3} className={`${inputCls} h-auto py-2 resize-none`} placeholder="Uma opção por linha" />}
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1 h-7 px-3 text-xs font-semibold bg-primary text-white rounded-lg disabled:opacity-50"><Check className="size-3" /> Salvar</button>
        <button type="button" onClick={() => { setEditing(false); setLabel(field.label) }} className="h-7 px-2 text-xs text-slate-500">Cancelar</button>
      </div>
    </li>
  )

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/50">
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => setEditing(true)} className={`text-sm font-medium text-left ${field.active ? "text-slate-900" : "text-slate-400 line-through"} hover:text-primary-700`}>{field.label}</button>
        <p className="text-[11px] text-slate-400">{typeLabel(field.type)}{hasOptions(field.type) && field.options ? ` · ${field.options.length} opções` : ""}</p>
      </div>
      <button type="button" onClick={toggle} disabled={pending} title={field.active ? "Ativo" : "Inativo"}
        className={`h-6 px-2 text-[10px] font-semibold rounded-full transition-colors ${field.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
        {field.active ? "Ativo" : "Inativo"}
      </button>
      <button type="button" onClick={remove} disabled={pending} title="Excluir" className="size-7 grid place-items-center rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
    </li>
  )
}

// ── Modal Criar campo ─────────────────────────────────────────────────────────
function CreateModal({ defaultEntity, onClose }: { defaultEntity: Ent; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [entity, setEntity] = useState<Ent>(defaultEntity)
  const [label, setLabel]   = useState("")
  const [type, setType]     = useState<CustomFieldType>("text")
  const [options, setOptions] = useState("")
  const [error, setError]   = useState<string | null>(null)

  function save() {
    if (!label.trim()) { setError("Dê um nome ao campo."); return }
    setError(null)
    start(async () => {
      const r = await createCustomField({
        entity: entity as CustomFieldEntity, label, type,
        options: hasOptions(type) ? options.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
      })
      if ("error" in r) { setError(r.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <div className="size-8 rounded-lg bg-primary-50 text-primary grid place-items-center"><Plus className="size-4" /></div>
          <h3 className="text-base font-bold text-slate-900">Criar campo personalizado</h3>
          <button type="button" onClick={onClose} className="ml-auto size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">Onde esse campo aparece</span>
            <SimpleSelect value={entity} onChange={(v) => setEntity(v as Ent)} options={TABS.map((t) => ({ value: t.ent, label: t.label }))} />
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">Nome do campo</span>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Convênio, Orçamento, CNPJ…" className={inputCls} />
          </label>

          <div>
            <span className="block text-[11px] font-semibold text-slate-600 mb-1.5">Tipo do campo</span>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map((t) => {
                const on = t.v === type
                const Icon = t.icon
                return (
                  <button key={t.v} type="button" onClick={() => setType(t.v)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors ${on ? "border-primary bg-primary-50" : "border-slate-200 hover:border-primary-200"}`}>
                    <span className={`size-7 rounded-lg grid place-items-center shrink-0 ${on ? "bg-primary-100 text-primary" : "bg-slate-100 text-slate-500"}`}><Icon className="size-4" /></span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-900">{t.label}</span>
                      <span className="block text-[10px] text-slate-400 truncate">{t.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {hasOptions(type) && (
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Opções <span className="font-normal text-slate-400">· uma por linha</span></span>
              <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={3} placeholder={"Unimed\nBradesco\nParticular"} className={`${inputCls} h-auto py-2 resize-none`} />
            </label>
          )}

          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Salvar campo
          </button>
        </div>
      </div>
    </div>
  )
}
