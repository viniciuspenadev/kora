// ─────────────────────────────────────────────────────────────────
// Segmento DINÂMICO — regras declarativas (docs/crm-vision-capture.md, F5).
// Lib PURA e compartilhada: o server conta (página de Listas, futura campanha)
// e o roster filtra client-side — UM avaliador, zero divergência.
//
// Doutrina: isto é DADO (estágio, tags, janelas de dias), nunca comportamento.
// Todas as condições combinam com E (AND) — simples de explicar e de prever.
// ─────────────────────────────────────────────────────────────────

export interface SegmentRules {
  /** Estágio do contato é um destes (vazio/null = qualquer). */
  lifecycle?:     string[] | null
  /** Tem PELO MENOS UMA destas tags. */
  tags_any?:      string[] | null
  /** NÃO tem NENHUMA destas tags. */
  tags_none?:     string[] | null
  /** Última compra: nunca comprou · há mais de N dias · nos últimos N dias. */
  last_purchase?: { op: "never" | "gt" | "lte"; days?: number } | null
  /** Criado: há mais de N dias · nos últimos N dias. */
  created?:       { op: "gt" | "lte"; days: number } | null
}

/** Forma enxuta do contato que o avaliador entende (client e server produzem). */
export interface SegmentContact {
  lifecycle_stage: string | null
  tag_ids:         string[]
  created_at:      string
  /** Dias desde a última compra (negócio ganho); null = nunca comprou. */
  ultima_dias:     number | null
}

const LIFECYCLES = ["contact", "lead", "customer", "lost", "unfit"]

/** Valida/normaliza regras vindas do client (whitelist fail-closed). */
export function sanitizeRules(input: unknown): SegmentRules | { error: string } {
  if (!input || typeof input !== "object") return { error: "Regras inválidas" }
  const r = input as Record<string, unknown>
  const out: SegmentRules = {}

  if (Array.isArray(r.lifecycle) && r.lifecycle.length) {
    const ls = r.lifecycle.filter((v): v is string => typeof v === "string" && LIFECYCLES.includes(v))
    if (ls.length) out.lifecycle = ls
  }
  for (const key of ["tags_any", "tags_none"] as const) {
    const v = r[key]
    if (Array.isArray(v) && v.length) {
      const ids = v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 20)
      if (ids.length) out[key] = ids
    }
  }
  const lp = r.last_purchase as { op?: unknown; days?: unknown } | null | undefined
  if (lp && typeof lp === "object" && typeof lp.op === "string" && ["never", "gt", "lte"].includes(lp.op)) {
    const days = Number(lp.days)
    if (lp.op === "never") out.last_purchase = { op: "never" }
    else if (Number.isFinite(days) && days > 0 && days <= 3650) out.last_purchase = { op: lp.op as "gt" | "lte", days: Math.floor(days) }
  }
  const cr = r.created as { op?: unknown; days?: unknown } | null | undefined
  if (cr && typeof cr === "object" && typeof cr.op === "string" && ["gt", "lte"].includes(cr.op)) {
    const days = Number(cr.days)
    if (Number.isFinite(days) && days > 0 && days <= 3650) out.created = { op: cr.op as "gt" | "lte", days: Math.floor(days) }
  }

  if (!out.lifecycle && !out.tags_any && !out.tags_none && !out.last_purchase && !out.created) {
    return { error: "Defina pelo menos uma condição pra lista dinâmica" }
  }
  return out
}

export function matchesSegment(c: SegmentContact, r: SegmentRules, now = Date.now()): boolean {
  if (r.lifecycle?.length && !r.lifecycle.includes(c.lifecycle_stage ?? "contact")) return false
  if (r.tags_any?.length && !r.tags_any.some((t) => c.tag_ids.includes(t))) return false
  if (r.tags_none?.length && r.tags_none.some((t) => c.tag_ids.includes(t))) return false

  if (r.last_purchase) {
    const lp = r.last_purchase
    if (lp.op === "never") { if (c.ultima_dias != null) return false }
    else if (lp.op === "gt")  { if (c.ultima_dias == null || c.ultima_dias <= (lp.days ?? 0)) return false }
    else if (lp.op === "lte") { if (c.ultima_dias == null || c.ultima_dias > (lp.days ?? 0)) return false }
  }

  if (r.created) {
    const ageDays = Math.floor((now - new Date(c.created_at).getTime()) / 86_400_000)
    if (r.created.op === "gt"  && ageDays <= r.created.days) return false
    if (r.created.op === "lte" && ageDays > r.created.days) return false
  }
  return true
}

const LIFE_PT: Record<string, string> = { contact: "Contato", lead: "Lead", customer: "Cliente", lost: "Perdido", unfit: "Fora do perfil" }

/** Frase humana das regras — subtítulo na tabela de Listas ("a opção responde a própria pergunta"). */
export function describeSegment(r: SegmentRules, tagName: (id: string) => string): string {
  const parts: string[] = []
  if (r.lifecycle?.length) parts.push(`estágio: ${r.lifecycle.map((l) => LIFE_PT[l] ?? l).join(" ou ")}`)
  if (r.tags_any?.length)  parts.push(`tem tag ${r.tags_any.map(tagName).join(" ou ")}`)
  if (r.tags_none?.length) parts.push(`sem tag ${r.tags_none.map(tagName).join(" nem ")}`)
  if (r.last_purchase) {
    const lp = r.last_purchase
    parts.push(lp.op === "never" ? "nunca comprou" : lp.op === "gt" ? `última compra há mais de ${lp.days}d` : `comprou nos últimos ${lp.days}d`)
  }
  if (r.created) parts.push(r.created.op === "gt" ? `criado há mais de ${r.created.days}d` : `criado nos últimos ${r.created.days}d`)
  return parts.join(" · ")
}
