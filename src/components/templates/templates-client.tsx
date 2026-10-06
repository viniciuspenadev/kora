"use client"

import { useState, useMemo } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import {
  Plus, CheckCircle2, FileText,
  Search, LayoutGrid, List as ListIcon, Gauge, BookMarked,
} from "lucide-react"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { StatusDot } from "@/components/ui/status-dot"
import { EmptyState } from "@/components/ui/empty-state"
import { TemplatePreview, bodyText } from "./template-preview"

const INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

type Tone = "success" | "warning" | "danger" | "neutral"
const STATUS: Record<string, { tone: Tone; label: string }> = {
  APPROVED: { tone: "success", label: "Aprovado" },
  PENDING:  { tone: "warning", label: "Em análise" },
  REJECTED: { tone: "danger",  label: "Reprovado" },
  PAUSED:   { tone: "neutral", label: "Pausado" },
  DISABLED: { tone: "neutral", label: "Desabilitado" },
}
const QUALITY: Record<string, { tone: Tone; label: string }> = {
  GREEN: { tone: "success", label: "Alta" }, YELLOW: { tone: "warning", label: "Média" },
  RED: { tone: "danger", label: "Baixa" }, UNKNOWN: { tone: "neutral", label: "—" },
}
const CATEGORY: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" }
// Categorias internas do Kora (etiqueta de propósito) — vêm do cache local via koraByName.
const KORA_LABELS: Record<string, string> = { agenda: "Agenda", atendimento: "Atendimento", marketing: "Marketing", cobranca: "Cobrança", outro: "Outro" }

export function TemplatesClient({ templates, error, created, koraByName = {} }: { templates: MetaTemplate[]; error: string | null; created?: boolean; koraByName?: Record<string, string> }) {
  const router = useRouter()
  const [view, setView] = useState<"grid" | "list">("grid")
  const [q, setQ] = useState("")
  const [fStatus, setFStatus] = useState("all")
  const [fCat, setFCat] = useState("all")
  const [fKora, setFKora] = useState("all")

  const koraOf = (t: MetaTemplate) => koraByName[`${t.name.toLowerCase()}|${t.language}`]
  // Só mostra o filtro Kora se houver ao menos um template etiquetado.
  const hasKora = useMemo(() => Object.keys(koraByName).length > 0, [koraByName])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return templates.filter((t) =>
      (fStatus === "all" || t.status === fStatus) &&
      (fCat === "all" || t.category === fCat) &&
      (fKora === "all" || koraOf(t) === fKora) &&
      (!term || t.name.toLowerCase().includes(term) || bodyText(t).toLowerCase().includes(term)),
    )
  }, [templates, q, fStatus, fCat, fKora, koraByName])

  // Cada card/linha navega pra página dedicada (precisa do id da Graph).
  function open(t: MetaTemplate) {
    if (t.id) router.push(`/templates/${t.id}`)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Não foi possível carregar os templates: {error}
        </div>
      )}
      {created && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg text-xs bg-emerald-50 border border-emerald-200 text-emerald-800">
          <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          <span>Template enviado para análise!</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou conteúdo…"
            className={`${INPUT} pl-9`} />
        </div>
        <div className="w-44"><SimpleSelect value={fStatus} onChange={setFStatus}
          options={[{ value: "all", label: "Todos os status" }, ...Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} /></div>
        <div className="w-44" title="Categoria da Meta"><SimpleSelect value={fCat} onChange={setFCat}
          options={[{ value: "all", label: "Todas categorias" }, ...Object.entries(CATEGORY).map(([k, v]) => ({ value: k, label: v }))]} /></div>
        {hasKora && (
          <div className="w-48" title="Categoria do Kora (propósito)"><SimpleSelect value={fKora} onChange={setFKora}
            options={[{ value: "all", label: "Todos os propósitos" }, ...Object.entries(KORA_LABELS).map(([k, v]) => ({ value: k, label: v }))]} /></div>
        )}
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          <button onClick={() => setView("grid")} className={`size-7 inline-flex items-center justify-center rounded-md ${view === "grid" ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-600"}`} title="Grade"><LayoutGrid className="size-4" /></button>
          <button onClick={() => setView("list")} className={`size-7 inline-flex items-center justify-center rounded-md ${view === "list" ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-600"}`} title="Lista"><ListIcon className="size-4" /></button>
        </div>
        <button onClick={() => router.push("/templates/biblioteca")}
          className="h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors">
          <BookMarked className="size-3.5" /> Biblioteca
        </button>
        <button onClick={() => router.push("/templates/novo")}
          className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 transition-colors">
          <Plus className="size-3.5" /> Criar template
        </button>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title={templates.length === 0 ? "Nenhum template ainda" : "Nada encontrado"}
          description={templates.length === 0 ? "Crie seu primeiro modelo para iniciar conversas fora da janela de 24 horas." : "Ajuste a busca ou os filtros."}
          action={templates.length === 0 ? <button onClick={() => router.push("/templates/novo")} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5"><Plus className="size-3.5" /> Criar template</button> : undefined} />
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => {
            const st = STATUS[t.status] ?? { tone: "neutral" as Tone, label: t.status }
            const ql = QUALITY[t.quality_score?.score ?? "UNKNOWN"] ?? QUALITY.UNKNOWN
            return (
              <button key={`${t.name}-${t.language}`} onClick={() => open(t)}
                className="text-left bg-white rounded-xl border border-slate-200 shadow-card hover:shadow-soft hover:border-slate-300 transition-shadow p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                      <span>{CATEGORY[t.category] ?? t.category} · {t.language}</span>
                      {koraOf(t) && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide rounded-full bg-primary-50 text-primary-700 px-1.5 py-0.5">{KORA_LABELS[koraOf(t)!] ?? koraOf(t)}</span>}
                    </p>
                  </div>
                  <StatusDot tone={st.tone} label={st.label} size="sm" />
                </div>
                <TemplatePreview t={t} />
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Gauge className="size-3" /> Qualidade: <StatusDot tone={ql.tone} label={ql.label} size="sm" />
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card divide-y divide-slate-100">
          {filtered.map((t) => {
            const st = STATUS[t.status] ?? { tone: "neutral" as Tone, label: t.status }
            const ql = QUALITY[t.quality_score?.score ?? "UNKNOWN"] ?? QUALITY.UNKNOWN
            return (
              <button key={`${t.name}-${t.language}`} onClick={() => open(t)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{bodyText(t)}</p>
                </div>
                <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0 w-32">
                  <span>{CATEGORY[t.category] ?? t.category}</span>
                  {koraOf(t) && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide rounded-full bg-primary-50 text-primary-700 px-1.5 py-0.5">{KORA_LABELS[koraOf(t)!] ?? koraOf(t)}</span>}
                </span>
                <span className="hidden md:flex shrink-0 w-20"><StatusDot tone={ql.tone} label={ql.label} size="sm" /></span>
                <span className="shrink-0 w-24"><StatusDot tone={st.tone} label={st.label} size="sm" /></span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
