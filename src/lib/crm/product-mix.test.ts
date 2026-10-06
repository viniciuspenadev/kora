import { describe, expect, it } from "vitest"
import { aggregateProductMix } from "./product-mix"

const cat = (name: string, total: number, sku: string | null = null) => ({ name, total, sku, manual: false })
const avulso = (name: string, total: number) => ({ name, total, sku: null, manual: true })

describe("mix de produtos do painel", () => {
  it("produtos do catálogo somam por nome; avulsos viram um grupo só", () => {
    const rows = aggregateProductMix([
      { items: [cat("Vidro", 100, "VID"), avulso("Instalação", 50)] },
      { items: [cat("Vidro", 200), avulso(" Instalação ", 70), avulso("Frete", 30)] },
    ])
    expect(rows).toEqual([
      { name: "Vidro", sales: 2, total: 300, sku: "VID" },
      { name: "Itens avulsos", sales: 3, total: 150, sku: null, manualHint: "Mais repetido: Instalação (2×) — vale cadastrar no catálogo" },
    ])
  })
  it("sem repetição, conta os nomes fora do catálogo; sem avulso, não aparece o grupo", () => {
    expect(aggregateProductMix([{ items: [avulso("A", 1), avulso("B", 1)] }])[0].manualHint).toBe("2 itens fora do catálogo")
    expect(aggregateProductMix([{ items: [cat("Vidro", 1)] }]).some((r) => r.manualHint)).toBe(false)
  })
  it("respeita o limite de linhas, ordenado pelo total", () => {
    const rows = aggregateProductMix([{ items: [cat("a", 1), cat("b", 5), cat("c", 3)] }], 2)
    expect(rows.map((r) => r.name)).toEqual(["b", "c"])
  })
})
