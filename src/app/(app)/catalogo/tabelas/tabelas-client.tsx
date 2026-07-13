"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus, Loader2, X, Table2, Pencil, ArrowLeft, Star, ChevronRight } from "lucide-react"
import { createPriceTable, renamePriceTable, setPriceTableActive, type PriceTableSummary } from "@/lib/actions/price-lists"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Switch } from "@/components/ui/switch"

export function TabelasClient({ tables }: { tables: PriceTableSummary[] }) {
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/catalogo" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
          <ArrowLeft className="size-3.5" /> Catálogo
        </Link>
        <span className="text-xs text-slate-400 tabular-nums">{tables.length} tabela{tables.length !== 1 ? "s" : ""}</span>
        <button type="button" onClick={() => setCreating(true)}
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
          <Plus className="size-3.5" /> Nova tabela
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {tables.map((tb) => <TableRow key={tb.id} table={tb} />)}
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
        <b className="text-slate-500">Como funciona:</b> cada tabela (Varejo, Atacado…) é uma grade viva de preço, custo e teto de desconto —
        editou, salvou, valeu, com <b>cada mudança auditada</b> (quem, quando, de→para). A tabela <b>padrão</b> alimenta o catálogo;
        o cliente pode carregar outra tabela e os negócios dele herdam — ou você escolhe a tabela ao abrir o negócio.
        Nada se apaga: tabela fora de uso se <b>desativa</b> pelo interruptor (some dos seletores, histórico intacto) e reativa quando quiser.
      </p>

      {creating && <NewTableDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function TableRow({ table }: { table: PriceTableSummary }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(table.name)
  const { confirm, confirmDialog } = useConfirm()
  const open = () => router.push(`/catalogo/tabelas/${table.id}`)

  function saveRename() {
    if (!name.trim() || name.trim() === table.name) { setRenaming(false); setName(table.name); return }
    startTransition(async () => {
      const r = await renamePriceTable(table.id, name)
      if ("error" in r) { alert(r.error); setName(table.name) }
      setRenaming(false)
      router.refresh()
    })
  }

  async function toggleActive(next: boolean) {
    if (!next && !(await confirm({
      title: `Desativar a tabela "${table.name}"?`,
      body: <>Ela some do seletor de negócios novos e da ficha do cliente, e negócios presos nela <b>não conseguem lançar itens novos</b> até você trocar a tabela ou reativar. Nada é apagado — preços, histórico e auditoria ficam intactos, e itens já lançados não mudam (preço travado).</>,
      confirmLabel: "Desativar",
    }))) return
    startTransition(async () => {
      const r = await setPriceTableActive(table.id, next)
      if ("error" in r) alert(r.error)
      router.refresh()
    })
  }

  return (
    <div className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60 transition-colors cursor-pointer ${table.active ? "" : "opacity-60 bg-slate-50/40"}`} onClick={open}>
      <span className={`size-9 rounded-lg grid place-items-center shrink-0 ${table.active ? "bg-primary-50 text-primary-600" : "bg-slate-100 text-slate-400"}`}><Table2 className="size-4" /></span>
      <div className="min-w-0 flex-1" onClick={(e) => renaming && e.stopPropagation()}>
        <div className="flex items-center gap-2">
          {renaming ? (
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              onBlur={saveRename} onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") { setRenaming(false); setName(table.name) } }}
              className="h-8 px-2.5 text-sm font-semibold border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          ) : (
            <span className="text-sm font-bold text-slate-900 truncate">{table.name}</span>
          )}
          {table.is_default && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-primary-50 text-primary-600 border-primary-200 shrink-0">
              <Star className="size-2.5" /> Padrão · alimenta o catálogo
            </span>
          )}
          {!table.active && (
            <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200 shrink-0">Desativada</span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">{table.items} {table.items === 1 ? "item" : "itens"} na grade</p>
      </div>
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setRenaming(true)} title="Renomear"
          className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
          <Pencil className="size-3.5" />
        </button>
        {pending
          ? <Loader2 className="size-4 animate-spin text-slate-400" />
          : <Switch size="sm" checked={table.active} onChange={toggleActive} disabled={table.is_default}
              className={table.is_default ? "" : undefined} />}
        <ChevronRight className="size-4 text-slate-300 ml-1" />
      </div>
      {confirmDialog}
    </div>
  )
}

function NewTableDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function create() {
    setError(null)
    if (!name.trim()) { setError("Dê um nome à tabela (ex: Atacado)"); return }
    startTransition(async () => {
      const r = await createPriceTable(name)
      if ("error" in r) { setError(r.error); return }
      onClose()
      router.push(`/catalogo/tabelas/${r.tableId}`)
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">Nova tabela de preço</h3>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome <span className="text-red-500">*</span></label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              onKeyDown={(e) => { if (e.key === "Enter") create() }}
              placeholder="Ex: Atacado · Revenda · Parceiros"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Nasce com os preços da tabela padrão como ponto de partida — ajuste a grade e pronto.
            Marque nos clientes quem compra por ela (os negócios herdam) ou escolha a tabela ao abrir o negócio.
          </p>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={create} disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Criar tabela
          </button>
        </div>
      </div>
    </div>
  )
}
