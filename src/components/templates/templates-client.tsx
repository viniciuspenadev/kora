"use client"

import { useState, useMemo, useTransition, Fragment } from "react"
import {
  Plus, Trash2, Loader2, X, AlertCircle, CheckCircle2, FileText,
  Search, LayoutGrid, List as ListIcon, Gauge,
} from "lucide-react"
import { createOfficialTemplate, deleteOfficialTemplate } from "@/lib/actions/whatsapp-official"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { StatusDot } from "@/components/ui/status-dot"
import { EmptyState } from "@/components/ui/empty-state"
import { DangerConfirm } from "@/components/ui/danger-confirm"

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

function comp(t: MetaTemplate, type: string) { return t.components?.find((c) => c.type === type) }
function bodyText(t: MetaTemplate) { return comp(t, "BODY")?.text ?? "" }
function countVars(body: string) { return new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, ""))).size }

/** Renderiza texto com {{n}} destacado. */
function renderVars(text?: string) {
  if (!text) return null
  return text.split(/(\{\{\s*\d+\s*\}\})/g).map((part, i) =>
    /\{\{\s*\d+\s*\}\}/.test(part)
      ? <span key={i} className="inline-block bg-primary-50 text-primary-700 rounded px-1 text-[0.92em] font-medium">{part}</span>
      : <Fragment key={i}>{part}</Fragment>,
  )
}

function TemplatePreview({ t }: { t: MetaTemplate }) {
  const header = comp(t, "HEADER")
  const footer = comp(t, "FOOTER")
  const buttons = comp(t, "BUTTONS")?.buttons ?? []
  return (
    <div className="rounded-xl bg-[#efe7de] p-3">
      <div className="bg-white rounded-lg rounded-tl-none shadow-sm px-2.5 py-2 max-w-[90%] text-[13px] leading-snug">
        {header?.format === "TEXT" && header.text && <p className="font-bold text-slate-900 mb-1">{renderVars(header.text)}</p>}
        <p className="text-slate-800 whitespace-pre-wrap break-words">{renderVars(bodyText(t)) ?? <span className="text-slate-300">(sem corpo)</span>}</p>
        {footer?.text && <p className="text-[11px] text-slate-400 mt-1.5">{footer.text}</p>}
      </div>
      {buttons.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {buttons.map((b, i) => <div key={i} className="bg-white rounded-lg text-center text-[13px] text-sky-600 py-1.5 font-medium shadow-sm">{b.text}</div>)}
        </div>
      )}
    </div>
  )
}

export function TemplatesClient({ templates, error }: { templates: MetaTemplate[]; error: string | null }) {
  const [view, setView] = useState<"grid" | "list">("grid")
  const [q, setQ] = useState("")
  const [fStatus, setFStatus] = useState("all")
  const [fCat, setFCat] = useState("all")
  const [selected, setSelected] = useState<MetaTemplate | null>(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<string | null>(null)
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null)
  const [, startT] = useTransition()

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return templates.filter((t) =>
      (fStatus === "all" || t.status === fStatus) &&
      (fCat === "all" || t.category === fCat) &&
      (!term || t.name.toLowerCase().includes(term) || bodyText(t).toLowerCase().includes(term)),
    )
  }, [templates, q, fStatus, fCat])

  function confirmDelete() {
    if (!toDelete) return
    return new Promise<void>((resolve) => {
      startT(async () => {
        const r = await deleteOfficialTemplate(toDelete)
        if (!r.ok) setFb({ ok: false, msg: r.error ?? "Falha ao excluir." })
        setSelected(null)
        resolve()
      })
    })
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Não foi possível carregar os templates: {error}
        </div>
      )}
      {fb && (
        <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${fb.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {fb.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
          <span>{fb.msg}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou conteúdo…"
            className={`${INPUT} pl-9`} />
        </div>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-9 px-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
          <option value="all">Todos os status</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="h-9 px-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
          <option value="all">Todas categorias</option>
          {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          <button onClick={() => setView("grid")} className={`size-7 inline-flex items-center justify-center rounded-md ${view === "grid" ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-600"}`} title="Grade"><LayoutGrid className="size-4" /></button>
          <button onClick={() => setView("list")} className={`size-7 inline-flex items-center justify-center rounded-md ${view === "list" ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-600"}`} title="Lista"><ListIcon className="size-4" /></button>
        </div>
        <button onClick={() => { setCreating(true); setFb(null) }}
          className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 transition-colors">
          <Plus className="size-3.5" /> Criar template
        </button>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title={templates.length === 0 ? "Nenhum template ainda" : "Nada encontrado"}
          description={templates.length === 0 ? "Crie seu primeiro modelo para iniciar conversas fora da janela de 24 horas." : "Ajuste a busca ou os filtros."}
          action={templates.length === 0 ? <button onClick={() => setCreating(true)} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5"><Plus className="size-3.5" /> Criar template</button> : undefined} />
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => {
            const st = STATUS[t.status] ?? { tone: "neutral" as Tone, label: t.status }
            const ql = QUALITY[t.quality_score?.score ?? "UNKNOWN"] ?? QUALITY.UNKNOWN
            return (
              <button key={`${t.name}-${t.language}`} onClick={() => setSelected(t)}
                className="text-left bg-white rounded-xl border border-slate-200 shadow-card hover:shadow-soft hover:border-slate-300 transition-shadow p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{CATEGORY[t.category] ?? t.category} · {t.language}</p>
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
              <button key={`${t.name}-${t.language}`} onClick={() => setSelected(t)} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{bodyText(t)}</p>
                </div>
                <span className="hidden sm:block text-[11px] text-slate-400 shrink-0 w-24">{CATEGORY[t.category] ?? t.category}</span>
                <span className="hidden md:flex shrink-0 w-20"><StatusDot tone={ql.tone} label={ql.label} size="sm" /></span>
                <span className="shrink-0 w-24"><StatusDot tone={st.tone} label={st.label} size="sm" /></span>
              </button>
            )
          })}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <DetailModal t={selected} onClose={() => setSelected(null)} onDelete={() => setToDelete(selected.name)} />
      )}

      {/* Create modal */}
      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onDone={(msg) => { setFb({ ok: true, msg }); setCreating(false) }}
        />
      )}

      <DangerConfirm
        open={!!toDelete}
        title="Excluir template?"
        body={<>O template <strong>{toDelete}</strong> será removido permanentemente. Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}

function DetailModal({ t, onClose, onDelete }: { t: MetaTemplate; onClose: () => void; onDelete: () => void }) {
  const st = STATUS[t.status] ?? { tone: "neutral" as Tone, label: t.status }
  const ql = QUALITY[t.quality_score?.score ?? "UNKNOWN"] ?? QUALITY.UNKNOWN
  const nVars = countVars(bodyText(t))
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft w-full max-w-lg max-h-[90vh] overflow-y-auto ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 truncate">{t.name}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{CATEGORY[t.category] ?? t.category} · {t.language}</p>
          </div>
          <button onClick={onClose} className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 shrink-0"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <TemplatePreview t={t} />

          <div className="grid grid-cols-2 gap-3 text-xs">
            <Info label="Status"><StatusDot tone={st.tone} label={st.label} size="sm" /></Info>
            <Info label="Qualidade"><StatusDot tone={ql.tone} label={ql.label} size="sm" /></Info>
            <Info label="Variáveis">{nVars}</Info>
            <Info label="Idioma">{t.language}</Info>
          </div>

          {t.status === "REJECTED" && t.rejected_reason && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              <strong>Motivo da reprovação:</strong> {t.rejected_reason}
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Analytics</p>
            <p className="text-xs text-slate-400">Métricas de envio/entrega/leitura/cliques chegam em breve (monitoramento por webhook de qualidade).</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 bg-slate-50 border-t border-slate-100">
          <button onClick={onDelete} className="h-9 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg inline-flex items-center gap-1.5 transition-colors">
            <Trash2 className="size-3.5" /> Excluir
          </button>
        </div>
      </div>
    </div>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <div className="mt-1 text-slate-800 font-medium">{children}</div>
    </div>
  )
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING")
  const [language, setLanguage] = useState("pt_BR")
  const [body, setBody] = useState("")
  const [samples, setSamples] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pending, startT] = useTransition()
  const nVars = countVars(body)

  function insertVar() { setBody((b) => `${b}{{${nVars + 1}}}`); setSamples((s) => [...s, ""]) }
  function submit() {
    setErr(null)
    startT(async () => {
      const r = await createOfficialTemplate({ name, category, language, body, samples })
      if (r.ok) onDone("Template enviado para análise!")
      else setErr(r.error ?? "Falha ao criar template.")
    })
  }

  const preview: MetaTemplate = { name: name || "preview", status: "PENDING", category, language, components: [{ type: "BODY", text: body }] }

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft w-full max-w-2xl max-h-[90vh] overflow-y-auto ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-sm font-bold text-slate-900">Novo template</h3>
          <button onClick={onClose} className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nome"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="boas_vindas" className={INPUT} /></Field>
              <Field label="Idioma">
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={INPUT.replace("px-3", "px-2")}>
                  <option value="pt_BR">Português (BR)</option><option value="en_US">English (US)</option><option value="es_ES">Español</option>
                </select>
              </Field>
            </div>
            <Field label="Categoria">
              <select value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")} className={INPUT.replace("px-3", "px-2")}>
                <option value="MARKETING">Marketing</option><option value="UTILITY">Utilidade</option>
              </select>
            </Field>
            <Field label="Corpo" hint="Use {{1}}, {{2}}… para campos dinâmicos.">
              <div className="flex justify-end mb-1"><button onClick={insertVar} className="text-[11px] font-semibold text-primary-700 hover:text-primary-800">+ inserir variável</button></div>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Olá {{1}}, tudo bem?"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
            </Field>
            {nVars > 0 && Array.from({ length: nVars }).map((_, i) => (
              <Field key={i} label={`Exemplo para {{${i + 1}}}`}>
                <input value={samples[i] ?? ""} onChange={(e) => setSamples((s) => { const n = [...s]; n[i] = e.target.value; return n })} placeholder={i === 0 ? "Bernardo" : ""} className={INPUT} />
              </Field>
            ))}
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Pré-visualização</p>
            <TemplatePreview t={preview} />
          </div>
        </div>
        {err && <div className="mx-5 mb-3 flex items-start gap-2 p-2.5 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800"><AlertCircle className="size-4 shrink-0 mt-0.5" /><span>{err}</span></div>}
        <div className="flex items-center justify-end gap-2 px-5 py-4 bg-slate-50 border-t border-slate-100 sticky bottom-0">
          <button onClick={onClose} className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-white">Cancelar</button>
          <button onClick={submit} disabled={pending || !name.trim() || !body.trim()}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Enviar para análise
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-semibold text-slate-600">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  )
}
