"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Search, X, Plus, Check, Loader2, ArrowRight, Boxes, PackagePlus, SlidersHorizontal,
  ArrowUpRight, RotateCcw, AlertTriangle, Infinity as InfIcon, Package, Trash2, Layers,
} from "lucide-react"
import {
  getStockMovements, recordStockMovement, recordStockMovementsBatch, setStockConfig,
  type InventoryItem, type StockMovement, type StockState,
} from "@/lib/actions/inventory"
import { unitSpec, formatQuantityWithUnit, parseQuantity } from "@/lib/crm/units"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const nf  = (v: number, d: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })

const STATE: Record<StockState, { label: string; cls: string; dot: string }> = {
  ok:       { label: "Em estoque", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  low:      { label: "Acabando",   cls: "bg-amber-50 text-amber-700",     dot: "bg-amber-500" },
  out:      { label: "Esgotado",   cls: "bg-red-50 text-red-700",         dot: "bg-red-500" },
  infinite: { label: "Infinito",   cls: "bg-slate-100 text-slate-500",    dot: "bg-slate-400" },
}
const barColor = (s: StockState) => s === "out" ? "#dc2626" : s === "low" ? "#d97706" : "#059669"

export function EstoqueClient({ items, canEdit = true, canManage = true }: { items: InventoryItem[]; canEdit?: boolean; canManage?: boolean }) {
  const [q, setQ] = useState("")
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [movTarget, setMovTarget] = useState<string | null>(null)   // produto do modal (null = fechado)
  const [batchOpen, setBatchOpen] = useState(false)

  const tiles = useMemo(() => {
    const ctrl = items.filter((i) => i.stock_qty != null)
    return {
      ctrl: ctrl.length,
      low:  ctrl.filter((i) => i.state === "low").length,
      out:  ctrl.filter((i) => i.state === "out").length,
      inf:  items.filter((i) => i.stock_qty == null).length,
    }
  }, [items])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? items.filter((i) => i.name.toLowerCase().includes(s) || (i.category ?? "").toLowerCase().includes(s)) : items
  }, [items, q])

  const sheetItem = sheetId ? items.find((i) => i.id === sheetId) ?? null : null

  return (
    <div className="space-y-5">
      {/* Ação + tiles */}
      <div className="flex justify-end gap-2">
        {canEdit ? (
          <>
            <button onClick={() => setBatchOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors">
              <Layers className="size-4" /> Entrada em lote
            </button>
            <button onClick={() => setMovTarget(items[0]?.id ?? null)}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Plus className="size-4" /> Lançar movimento
            </button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-lg">
            <Boxes className="size-3.5" /> Somente leitura
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Boxes}          tone="primary" label="Controlados" value={tiles.ctrl} sub="com saldo" />
        <Tile icon={AlertTriangle}  tone="amber"   label="Acabando"    value={tiles.low}  sub="abaixo do mínimo" />
        <Tile icon={X}              tone="red"     label="Esgotados"   value={tiles.out}  sub="saldo zerado" />
        <Tile icon={InfIcon}        tone="slate"   label="Infinitos"   value={tiles.inf}  sub="não controlam" />
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-13 py-2.5 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">Produtos</p>
          <div className="ml-auto relative">
            <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto…"
              className="h-9 w-56 max-w-[40vw] pl-9 pr-3 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-xs text-slate-400">Nenhum produto no catálogo ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 bg-slate-50/60">
                  <th className="text-left font-semibold py-2.5 px-4">Produto</th>
                  <th className="text-left font-semibold py-2.5 px-3 hidden sm:table-cell">Preço</th>
                  <th className="text-right font-semibold py-2.5 px-3">Saldo</th>
                  <th className="text-right font-semibold py-2.5 px-3">Situação</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => <Row key={it.id} item={it} canEdit={canEdit} onOpen={() => setSheetId(it.id)} onMove={() => setMovTarget(it.id)} />)}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
          Produto <b className="text-slate-500">sem saldo</b> = <b className="text-slate-500">∞ infinito</b> (não controla). <b>0 = esgotado.</b> A venda baixa sozinho ao ganhar o negócio.
        </p>
      </div>

      {sheetItem && <StockSheet item={sheetItem} canEdit={canEdit} canManage={canManage} onClose={() => setSheetId(null)} onMove={() => setMovTarget(sheetItem.id)} />}
      {movTarget && <MoveModal items={items} initialId={movTarget} onClose={() => setMovTarget(null)} openSheetId={sheetId} />}
      {batchOpen && <BatchModal items={items} onClose={() => setBatchOpen(false)} />}
    </div>
  )
}

function Thumb({ item, size = "size-9" }: { item: InventoryItem; size?: string }) {
  return item.image_path
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={`/api/catalog-image/${item.id}`} alt="" className={`${size} rounded-lg object-cover ring-1 ring-slate-200 shrink-0`} />
    : <span className={`${size} rounded-lg bg-slate-100 grid place-items-center shrink-0 text-slate-400`}><Package className="size-4" /></span>
}

function Tile({ icon: Icon, tone, label, value, sub }: { icon: typeof Boxes; tone: "primary" | "amber" | "red" | "slate"; label: string; value: number; sub: string }) {
  const t = {
    primary: "bg-primary-50 text-primary", amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600", slate: "bg-slate-100 text-slate-500",
  }[tone]
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`size-7 rounded-lg grid place-items-center ${t}`}><Icon className="size-4" /></span>
        <span className="text-[11.5px] font-semibold text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-extrabold tracking-tight leading-none">{value}</p>
      <p className="text-[11px] text-slate-400 mt-1">{sub}</p>
    </div>
  )
}

function Row({ item, canEdit, onOpen, onMove }: { item: InventoryItem; canEdit: boolean; onOpen: () => void; onMove: () => void }) {
  const s = STATE[item.state]
  const fill = item.stock_qty == null ? 0 : Math.max(4, Math.min(100, (item.stock_qty / ((item.stock_min || item.stock_qty || 1) * 2.2)) * 100))
  return (
    <tr className="group border-t border-slate-100 hover:bg-slate-50/50 cursor-pointer" onClick={onOpen}>
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Thumb item={item} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900 truncate">{item.name}</p>
            <p className="text-[11px] text-slate-400 truncate">{item.category ?? "—"}{item.stock_min != null ? ` · mín ${nf(item.stock_min, unitSpec(item.unit).decimals)} ${unitSpec(item.unit).symbol}` : ""}</p>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 hidden sm:table-cell">
        <span className="text-slate-700 font-medium tabular-nums">{brl(item.price)}</span>
        {item.unit !== "un" && <span className="text-[10px] text-slate-400">/{unitSpec(item.unit).symbol}</span>}
      </td>
      <td className="py-2.5 px-3 text-right">
        {item.stock_qty == null ? (
          <span className="text-slate-300 font-bold">∞</span>
        ) : (
          <div className="inline-flex flex-col items-end gap-1">
            <span className="font-bold tabular-nums text-[13px]">{nf(item.stock_qty, unitSpec(item.unit).decimals)} <span className="text-slate-400 font-semibold">{unitSpec(item.unit).symbol}</span></span>
            <span className="block w-24 h-1.5 rounded bg-slate-100 overflow-hidden"><span className="block h-full rounded" style={{ width: `${fill}%`, background: barColor(item.state) }} /></span>
          </div>
        )}
      </td>
      <td className="py-2.5 px-3 text-right">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${s.cls}`}>
          {item.state !== "infinite" && <span className={`size-1.5 rounded-full ${s.dot}`} />}{item.state === "infinite" ? "∞ " : ""}{s.label}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right">
        {canEdit && (
          <button onClick={(e) => { e.stopPropagation(); onMove() }}
            className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 h-8 px-3 text-xs font-semibold border border-slate-200 rounded-lg text-slate-500 hover:border-primary-200 hover:text-primary hover:bg-primary-50">
            <Plus className="size-3.5" /> Movimentar
          </button>
        )}
      </td>
    </tr>
  )
}

const MOV_META: Record<StockMovement["kind"], { label: string; cls: string; icon: typeof Plus }> = {
  in:       { label: "Entrada", cls: "bg-emerald-50 text-emerald-600", icon: PackagePlus },
  out:      { label: "Venda",   cls: "bg-slate-100 text-slate-500",    icon: ArrowUpRight },
  adjust:   { label: "Ajuste",  cls: "bg-amber-50 text-amber-600",     icon: SlidersHorizontal },
  reversal: { label: "Estorno", cls: "bg-violet-50 text-violet-600",   icon: RotateCcw },
}

function StockSheet({ item, canEdit, canManage, onClose, onMove }: { item: InventoryItem; canEdit: boolean; canManage: boolean; onClose: () => void; onMove: () => void }) {
  const router = useRouter()
  const [movs, setMovs] = useState<StockMovement[] | null>(null)
  const dec = unitSpec(item.unit).decimals
  const sym = unitSpec(item.unit).symbol
  const s = STATE[item.state]
  const [editMin, setEditMin] = useState(false)
  const [minStr, setMinStr] = useState(item.stock_min != null ? nf(item.stock_min, dec) : "")
  const [pendingMin, startMin] = useTransition()
  function saveMin() {
    startMin(async () => {
      const val = minStr.trim() === "" ? null : parseQuantity(minStr, item.unit)
      await setStockConfig(item.id, { stockMin: val })
      setEditMin(false); router.refresh()
    })
  }

  useEffect(() => {
    let alive = true
    setMovs(null)
    getStockMovements(item.id).then((r) => { if (alive) setMovs(r) }).catch(() => { if (alive) setMovs([]) })
    return () => { alive = false }
  }, [item.id, item.stock_qty])

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-dvh w-[420px] max-w-[94vw] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
          <Thumb item={item} size="size-11" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-extrabold text-slate-900 truncate">{item.name}</h3>
            <p className="text-[11px] text-slate-400">{item.category ?? "—"} · {brl(item.price)}{item.unit !== "un" ? `/${sym}` : ""}</p>
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {item.stock_qty == null ? (
            <div className="text-center py-10">
              <div className="text-4xl mb-2">∞</div>
              <h4 className="font-bold text-slate-900">Estoque infinito</h4>
              <p className="text-xs text-slate-500 max-w-[34ch] mx-auto mt-1 mb-4">Este item não controla saldo.{canEdit ? " Lance uma entrada pra começar a controlar." : ""}</p>
              {canEdit && (
                <button onClick={onMove} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg">
                  <PackagePlus className="size-4" /> Começar a controlar
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-extrabold tracking-tight tabular-nums" style={{ color: item.state === "out" ? "#dc2626" : item.state === "low" ? "#b45309" : undefined }}>{nf(item.stock_qty, dec)}</span>
                <span className="text-base font-bold text-slate-400">{sym}</span>
              </div>
              <div className="mt-1"><span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${s.cls}`}>{item.state !== "infinite" && <span className={`size-1.5 rounded-full ${s.dot}`} />}{s.label}{item.state === "low" ? " — abaixo do mínimo" : ""}</span></div>

              <div className="flex gap-6 my-4 py-3.5 border-y border-slate-100">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400 font-semibold">Nível mínimo <span className="text-slate-300">· acende “acabando”</span></p>
                  {!canManage ? (
                    <p className="text-[15px] font-bold tabular-nums mt-0.5">{item.stock_min != null ? `${nf(item.stock_min, dec)} ${sym}` : "—"}</p>
                  ) : editMin ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="relative w-24">
                        <input value={minStr} onChange={(e) => setMinStr(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" autoFocus placeholder="—"
                          className="w-full h-8 pl-2.5 pr-8 text-sm tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{sym}</span>
                      </div>
                      <button onClick={saveMin} disabled={pendingMin} className="size-8 grid place-items-center rounded-lg bg-primary text-white disabled:opacity-50">{pendingMin ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditMin(true)} className="text-[15px] font-bold tabular-nums mt-0.5 hover:text-primary-700">{item.stock_min != null ? `${nf(item.stock_min, dec)} ${sym}` : "definir"}</button>
                  )}
                </div>
                <div><p className="text-[11px] text-slate-400 font-semibold">Preço</p><p className="text-[15px] font-bold tabular-nums mt-0.5">{brl(item.price)}<span className="text-[11px] text-slate-400">{item.unit !== "un" ? `/${sym}` : ""}</span></p></div>
              </div>

              {canEdit && (
                <button onClick={onMove} className="w-full inline-flex items-center justify-center gap-1.5 h-9 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg mb-5">
                  <Plus className="size-4" /> Lançar movimento
                </button>
              )}

              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">Extrato de movimentações</p>
              {movs === null ? (
                <p className="text-center py-6"><Loader2 className="size-4 animate-spin inline text-slate-300" /></p>
              ) : movs.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">Sem movimentações ainda.</p>
              ) : (
                <div>
                  {movs.map((m) => {
                    const meta = MOV_META[m.kind]; const Icon = meta.icon
                    return (
                      <div key={m.id} className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
                        <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${meta.cls}`}><Icon className="size-4" /></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800">{meta.label}</p>
                          <p className="text-[11px] text-slate-400 truncate">{[m.note, m.by_name ?? (m.kind === "out" || m.kind === "reversal" ? "automático" : null)].filter(Boolean).join(" · ")}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-[13px] font-extrabold tabular-nums ${m.qty > 0 ? "text-emerald-600" : "text-slate-800"}`}>{m.qty > 0 ? "+" : ""}{nf(m.qty, dec)} {sym}</p>
                          {m.balance != null && <p className="text-[10px] text-slate-400 tabular-nums">saldo {nf(m.balance, dec)}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">O saldo é a <b className="text-slate-500">soma das movimentações</b> — como extrato bancário. A <b>venda</b> baixa ao ganhar o negócio; <b>cancelou → estorna</b>.</p>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function MoveModal({ items, initialId, onClose, openSheetId }: { items: InventoryItem[]; initialId: string; onClose: () => void; openSheetId: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [itemId, setItemId] = useState(initialId)
  const [kind, setKind] = useState<"in" | "adjust">("in")
  const [qtyStr, setQtyStr] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  const item = items.find((i) => i.id === itemId) ?? items[0]
  const spec = unitSpec(item?.unit)
  const cur = item?.stock_qty ?? 0
  const parsed = parseQuantity(qtyStr, item?.unit)
  const hasVal = qtyStr.trim() !== "" && Number.isFinite(parsed)
  const newBal = !hasVal ? cur : kind === "in" ? cur + parsed : parsed

  function save() {
    if (!item) return
    if (!hasVal || parsed < 0) { setError("Informe uma quantidade válida."); return }
    setError(null)
    start(async () => {
      const r = await recordStockMovement(item.id, { kind, qty: parsed, note: note.trim() || undefined })
      if ("error" in r) { setError(r.error); return }
      onClose(); router.refresh()
    })
  }

  if (!item) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">{kind === "in" ? "Entrada de mercadoria" : "Ajuste de estoque"}</h3>
          <button onClick={onClose} className="ml-auto size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">Produto</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}
              className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
            {([["in", "Entrada", PackagePlus], ["adjust", "Ajuste", SlidersHorizontal]] as const).map(([k, lbl, Icon]) => (
              <button key={k} onClick={() => setKind(k)}
                className={`inline-flex items-center justify-center gap-1.5 h-9 text-xs font-bold rounded-lg transition-colors ${kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                <Icon className="size-4" /> {lbl}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">{kind === "in" ? "Quantidade que chegou" : "Novo saldo (correção)"}</span>
            <div className="relative">
              <input value={qtyStr} onChange={(e) => setQtyStr(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" autoFocus placeholder="0"
                className="w-full h-11 pl-3 pr-12 text-sm tabular-nums border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{spec.symbol}</span>
            </div>
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">Motivo <span className="font-normal text-slate-400">(opcional)</span></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: compra fornecedor, quebra, recontagem…"
              className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </label>

          <div className="flex items-center justify-center gap-3 py-3 rounded-xl bg-slate-50 border border-dashed border-slate-200 tabular-nums">
            <span className="text-sm font-bold text-slate-400">{nf(cur, spec.decimals)} {spec.symbol}</span>
            <ArrowRight className="size-4 text-slate-400" />
            <span className="text-lg font-extrabold text-slate-900">{nf(newBal, spec.decimals)} {spec.symbol}</span>
          </div>

          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Lançar
          </button>
        </div>
      </div>
    </div>
  )
}

function BatchModal({ items, onClose }: { items: InventoryItem[]; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: items[0]?.id ?? "", qty: "" }])
  const [error, setError] = useState<string | null>(null)

  const setLine = (i: number, patch: Partial<{ itemId: string; qty: string }>) => setLines((ls) => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const addLine = () => setLines((ls) => [...ls, { itemId: items[0]?.id ?? "", qty: "" }])
  const rmLine  = (i: number) => setLines((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)

  const parsed = lines.map((l) => ({ itemId: l.itemId, qty: parseQuantity(l.qty, items.find((i) => i.id === l.itemId)?.unit) }))
  const valid  = parsed.filter((l) => l.itemId && l.qty > 0)

  function save() {
    if (valid.length === 0) { setError("Adicione ao menos um produto com quantidade."); return }
    setError(null)
    start(async () => {
      const r = await recordStockMovementsBatch({ note: note.trim() || undefined, lines: valid })
      if ("error" in r) { setError(r.error); return }
      onClose(); router.refresh()
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="size-8 rounded-lg bg-primary-50 text-primary grid place-items-center"><Layers className="size-4" /></span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">Entrada em lote</h3>
            <p className="text-[11px] text-slate-400">Recebeu mercadoria? Lance vários de uma vez.</p>
          </div>
          <button onClick={onClose} className="ml-auto size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-600 mb-1">Motivo <span className="font-normal text-slate-400">(vale pra todos)</span></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: Compra fornecedor — NF 1234"
              className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </label>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}
                  className="flex-1 h-10 px-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 min-w-0">
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
                <div className="relative w-28 shrink-0">
                  <input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" placeholder="0"
                    className="w-full h-10 pl-2.5 pr-9 text-sm tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{unitSpec(items.find((x) => x.id === l.itemId)?.unit).symbol}</span>
                </div>
                <button onClick={() => rmLine(i)} className="size-9 grid place-items-center rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 shrink-0"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <button onClick={addLine} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-700"><Plus className="size-3.5" /> Adicionar produto</button>
          </div>

          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100">
          <span className="text-[11px] text-slate-400">{valid.length} produto{valid.length !== 1 ? "s" : ""} pronto{valid.length !== 1 ? "s" : ""}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
            <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Lançar {valid.length > 0 ? valid.length : ""} entrada{valid.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
