"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { Plus, Pencil, Trash2, Loader2, X, Search, Users, ListChecks, Zap } from "lucide-react"
import { createList, updateList, deleteList, type ContactList, type ListKind } from "@/lib/actions/lists"
import { describeSegment, type SegmentRules } from "@/lib/crm/segment-rules"
import { SimpleSelect } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { useConfirm } from "@/components/ui/confirm-dialog"

interface TagLite { id: string; name: string; color: string }

export function ListasClient({ lists, tags }: { lists: ContactList[]; tags: TagLite[] }) {
  const [search, setSearch]     = useState("")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<ContactList | null>(null)

  const tagName = useMemo(() => {
    const m = new Map(tags.map((t) => [t.id, t.name]))
    return (id: string) => m.get(id) ?? "?"
  }, [tags])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return lists
    return lists.filter((l) => l.name.toLowerCase().includes(q) || (l.description ?? "").toLowerCase().includes(q))
  }, [lists, search])

  return (
    <div className="space-y-4">
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
          icon={ListChecks}
          title={search ? "Nada encontrado" : "Nenhuma lista ainda"}
          description={search ? "Tente outro termo." : "Estática: você escolhe quem entra (seleção em massa no roster). Dinâmica: você define regras e ela se mantém atualizada sozinha."}
          action={!search ? (
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-3.5" /> Criar lista
            </button>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Lista</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Descrição / regras</th>
                  <th className="text-left font-medium py-2.5 px-3">Contatos</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Data de criação</th>
                  <th className="text-right font-medium py-2.5 px-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => <ListRow key={l.id} l={l} tagName={tagName} onEdit={() => setEditing(l)} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <ListDialog list={editing} tags={tags} onClose={() => { setCreating(false); setEditing(null) }} />
      )}
    </div>
  )
}

function ListRow({ l, tagName, onEdit }: { l: ContactList; tagName: (id: string) => string; onEdit: () => void }) {
  const [pending, startTransition] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  const dynamic = l.kind === "dynamic"

  async function handleDelete() {
    if (!(await confirm({
      title: `Excluir a lista "${l.name}"?`,
      body: "Os contatos NÃO são excluídos — só saem desta lista. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
    }))) return
    startTransition(async () => {
      const r = await deleteList(l.id)
      if ("error" in r) alert(r.error)
    })
  }

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
            <ListChecks className="size-3.5 text-primary-500" /> {l.name}
          </span>
          {dynamic && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600" title="Se atualiza sozinha pelas regras">
              <Zap className="size-2.5" /> Dinâmica
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 hidden md:table-cell">
        <span className="text-xs text-slate-500 block truncate max-w-[360px]">
          {dynamic && l.rules
            ? <span className="text-violet-600">{describeSegment(l.rules, tagName)}</span>
            : (l.description || <span className="text-slate-300">—</span>)}
        </span>
      </td>
      <td className="py-2.5 px-3">
        {l.members > 0 ? (
          <Link href={`/contatos?list=${l.id}`} title="Ver este público em Contatos"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline underline-offset-2 tabular-nums">
            <Users className="size-3" /> {l.members} contato{l.members !== 1 ? "s" : ""}
          </Link>
        ) : (
          <span className="text-xs text-slate-300 tabular-nums">0 contatos</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-xs text-slate-500 hidden sm:table-cell">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
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

// ── Dialog criar/editar (estática | dinâmica com regras) ────────
const LIFE_OPTS = [
  { value: "contact",  label: "Contato" },
  { value: "lead",     label: "Lead" },
  { value: "customer", label: "Cliente" },
  { value: "lost",     label: "Perdido" },
  { value: "unfit",    label: "Fora do perfil" },
]

function ListDialog({ list, tags, onClose }: { list: ContactList | null; tags: TagLite[]; onClose: () => void }) {
  const r0 = list?.rules ?? null
  const [kind, setKind]               = useState<ListKind>(list?.kind ?? "static")
  const [name, setName]               = useState(list?.name ?? "")
  const [description, setDescription] = useState(list?.description ?? "")
  // regras (modo dinâmico)
  const [life, setLife]         = useState<Set<string>>(() => new Set(r0?.lifecycle ?? []))
  const [tagsAny, setTagsAny]   = useState<Set<string>>(() => new Set(r0?.tags_any ?? []))
  const [tagsNone, setTagsNone] = useState<Set<string>>(() => new Set(r0?.tags_none ?? []))
  const [lpOp, setLpOp]         = useState<string>(r0?.last_purchase?.op ?? "any")
  const [lpDays, setLpDays]     = useState<string>(r0?.last_purchase?.days != null ? String(r0.last_purchase.days) : "90")
  const [crOp, setCrOp]         = useState<string>(r0?.created?.op ?? "any")
  const [crDays, setCrDays]     = useState<string>(r0?.created?.days != null ? String(r0.created.days) : "30")
  const [error, setError]       = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function buildRules(): SegmentRules {
    return {
      lifecycle: life.size ? Array.from(life) : null,
      tags_any:  tagsAny.size ? Array.from(tagsAny) : null,
      tags_none: tagsNone.size ? Array.from(tagsNone) : null,
      last_purchase: lpOp === "any" ? null : lpOp === "never" ? { op: "never" } : { op: lpOp as "gt" | "lte", days: Number(lpDays) || 0 },
      created: crOp === "any" ? null : { op: crOp as "gt" | "lte", days: Number(crDays) || 0 },
    }
  }

  function save() {
    setError(null)
    if (!name.trim()) { setError("Nome da lista é obrigatório"); return }
    startTransition(async () => {
      const rules = kind === "dynamic" ? buildRules() : undefined
      const r = list
        ? await updateList(list.id, { name, description: description || null, ...(list.kind === "dynamic" ? { rules } : {}) })
        : await createList(name, description || null, kind, rules)
      if ("error" in r) { setError(r.error); return }
      onClose()
    })
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n)
  }
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
      active ? "bg-primary-50 text-primary-700 border-primary-200" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
    }`
  const dynamic = kind === "dynamic"
  const daysInput = "w-16 h-8 px-2 text-xs text-center border border-slate-200 rounded-lg bg-slate-50 tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20"

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">{list ? "Editar lista" : "Nova lista"}</h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* tipo — travado na edição (mudar o tipo muda a natureza da lista) */}
          {list ? (
            <p className="text-[11px] text-slate-400">
              Tipo: <span className="font-semibold text-slate-600">{list.kind === "dynamic" ? "Dinâmica (regras)" : "Estática (curadoria manual)"}</span>
            </p>
          ) : (
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
              {(["static", "dynamic"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold rounded-md transition-colors ${kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {k === "static" ? <ListChecks className="size-3.5" /> : <Zap className="size-3.5 text-violet-500" />}
                  {k === "static" ? "Estática" : "Dinâmica"}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome <span className="text-red-500">*</span></label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              placeholder={dynamic ? "Ex: Sem compra há 90 dias" : "Ex: Clientes VIP"}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Descrição <span className="text-slate-300 font-normal">(opcional)</span></label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140}
              placeholder="Pra que serve esta audiência"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          </div>

          {dynamic ? (
            <div className="space-y-4 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700">
                <Zap className="size-3" /> Regras — o contato entra quando atender TODAS as condições abaixo
              </p>

              <div>
                <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Estágio é um de <span className="text-slate-300 font-normal">(vazio = qualquer)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {LIFE_OPTS.map((o) => (
                    <button key={o.value} type="button" onClick={() => toggle(life, setLife, o.value)} className={chip(life.has(o.value))}>{o.label}</button>
                  ))}
                </div>
              </div>

              {tags.length > 0 && (
                <>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-600 mb-1.5">Tem ALGUMA destas tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <button key={t.id} type="button" onClick={() => toggle(tagsAny, setTagsAny, t.id)} className={chip(tagsAny.has(t.id))}>
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-slate-600 mb-1.5">NÃO tem nenhuma destas</p>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <button key={t.id} type="button" onClick={() => toggle(tagsNone, setTagsNone, t.id)} className={chip(tagsNone.has(t.id))}>
                          <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] font-semibold text-slate-600 w-full">Última compra</p>
                <div className="w-48">
                  <SimpleSelect value={lpOp} onChange={setLpOp} className="h-8 text-xs" options={[
                    { value: "any",   label: "Qualquer situação" },
                    { value: "never", label: "Nunca comprou" },
                    { value: "gt",    label: "Há mais de N dias" },
                    { value: "lte",   label: "Nos últimos N dias" },
                  ]} />
                </div>
                {(lpOp === "gt" || lpOp === "lte") && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    N = <input value={lpDays} onChange={(e) => setLpDays(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className={daysInput} /> dias
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] font-semibold text-slate-600 w-full">Contato criado</p>
                <div className="w-48">
                  <SimpleSelect value={crOp} onChange={setCrOp} className="h-8 text-xs" options={[
                    { value: "any", label: "Qualquer época" },
                    { value: "lte", label: "Nos últimos N dias" },
                    { value: "gt",  label: "Há mais de N dias" },
                  ]} />
                </div>
                {crOp !== "any" && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    N = <input value={crDays} onChange={(e) => setCrDays(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className={daysInput} /> dias
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Lista estática: adicione contatos pela <span className="font-semibold text-slate-500">seleção em massa</span> no roster de Contatos.
            </p>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {list ? "Salvar" : "Criar lista"}
          </button>
        </div>
      </div>
    </div>
  )
}
