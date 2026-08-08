"use client"

// ─────────────────────────────────────────────────────────────────
// Renderiza campos personalizados (definição → input pelo tipo) e a
// visão read-only. Valores em STRING (denominador comum: produto grava
// em catalog_items.attrs string; negócio em tenant_deals.custom_fields
// jsonb — string cabe nos dois). Fonte das defs: tenant_custom_fields.
// ─────────────────────────────────────────────────────────────────

import { SimpleSelect } from "@/components/ui/select"
import type { CustomFieldDef } from "@/lib/actions/custom-fields"

const FIELD = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

/** Inputs editáveis — um por definição, pelo tipo. `values` é chave→string. */
export function CustomFieldInputs({ defs, values, onChange }: {
  defs: CustomFieldDef[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  if (defs.length === 0) return null
  return (
    <div className="space-y-3">
      {defs.map((d) => {
        const v = values[d.key] ?? ""
        return (
          <div key={d.id}>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">{d.label}</label>

            {d.type === "text" && (
              <input value={v} onChange={(e) => onChange(d.key, e.target.value)} maxLength={200} className={FIELD} />
            )}
            {d.type === "number" && (
              <input type="text" inputMode="decimal" value={v} onChange={(e) => onChange(d.key, e.target.value.replace(/[^\d.,-]/g, ""))} className={`${FIELD} tabular-nums`} />
            )}
            {d.type === "date" && (
              <input type="date" value={v} onChange={(e) => onChange(d.key, e.target.value)} className={FIELD} />
            )}
            {d.type === "select" && (
              <SimpleSelect value={v} onChange={(nv) => onChange(d.key, nv)}
                options={[{ value: "", label: "—" }, ...(d.options ?? []).map((o) => ({ value: o, label: o }))]} />
            )}
            {d.type === "bool" && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={v === "Sim"} onChange={(e) => onChange(d.key, e.target.checked ? "Sim" : "")}
                  className="size-4 rounded border-slate-300 text-primary focus:ring-primary/30" />
                Sim
              </label>
            )}
            {d.type === "multi" && (
              <div className="flex flex-wrap gap-1.5">
                {(d.options ?? []).map((o) => {
                  const sel = v.split(", ").filter(Boolean)
                  const on = sel.includes(o)
                  return (
                    <button key={o} type="button"
                      onClick={() => onChange(d.key, (on ? sel.filter((x) => x !== o) : [...sel, o]).join(", "))}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${on ? "bg-primary-50 border-primary-200 text-primary" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                      {o}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Visão read-only — só os campos preenchidos (label: valor). */
export function CustomFieldsView({ defs, values }: {
  defs: CustomFieldDef[]
  values: Record<string, string>
}) {
  const filled = defs.filter((d) => (values[d.key] ?? "").trim() !== "")
  if (filled.length === 0) return null
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
      {filled.map((d) => (
        <div key={d.id}>
          <dt className="text-[11px] text-slate-400">{d.label}</dt>
          <dd className="text-sm text-slate-800">{d.type === "bool" ? (values[d.key] === "Sim" ? "Sim" : "Não") : values[d.key]}</dd>
        </div>
      ))}
    </dl>
  )
}
