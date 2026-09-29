// Mix de produtos do painel do funil. Itens avulsos (sem produto do catálogo) viram UM
// grupo: nome livre não é produto, e o nome mais repetido é sugestão de cadastro.
export interface MixItem { name: string; total: number; sku: string | null; manual: boolean }
export interface MixRow { name: string; sales: number; total: number; sku: string | null; manualHint?: string }

export function aggregateProductMix(deals: { items: MixItem[] }[], limit = 6): MixRow[] {
  const g = new Map<string, { sales: number; total: number; sku: string | null }>()
  const manual = { sales: 0, total: 0, names: new Map<string, number>() }
  for (const d of deals) for (const it of d.items) {
    if (it.manual) {
      manual.sales += 1; manual.total += it.total
      const k = it.name.trim()
      manual.names.set(k, (manual.names.get(k) ?? 0) + 1)
      continue
    }
    const cur = g.get(it.name) ?? { sales: 0, total: 0, sku: it.sku }
    cur.sales += 1; cur.total += it.total
    if (!cur.sku && it.sku) cur.sku = it.sku
    g.set(it.name, cur)
  }
  const rows: MixRow[] = [...g.entries()].map(([name, x]) => ({ name, ...x }))
  if (manual.sales > 0) {
    const [top, times] = [...manual.names.entries()].sort((a, b) => b[1] - a[1])[0]
    rows.push({
      name: "Itens avulsos", sales: manual.sales, total: manual.total, sku: null,
      manualHint: times > 1
        ? `Mais repetido: ${top} (${times}×) — vale cadastrar no catálogo`
        : `${manual.names.size} ${manual.names.size === 1 ? "item" : "itens"} fora do catálogo`,
    })
  }
  return rows.sort((a, b) => b.total - a.total).slice(0, limit)
}
