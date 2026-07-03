"use client"

import { useState, useTransition, useRef } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { UploadCloud, ClipboardPaste, Loader2, CheckCircle2, ArrowLeft, History, ChevronRight } from "lucide-react"
import { previewImport, commitImport, type ImportRow, type ImportPreview, type ImportRecord } from "@/lib/actions/import-contacts"

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })

function parseInput(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ","
  const cells = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, "")))
  const header = cells[0].map((c) => c.toLowerCase())
  const hasHeader = header.some((h) => /nome|name|telefone|phone|celular|whats|email|e-mail|contato|fone|n[uú]mero/.test(h))
  const body = hasHeader ? cells.slice(1) : cells
  let nameCol = -1, phoneCol = -1, emailCol = -1
  if (hasHeader) header.forEach((h, i) => {
    if (phoneCol < 0 && /telefone|phone|celular|whats|fone|n[uú]mero/.test(h)) phoneCol = i
    if (emailCol < 0 && /email|e-mail/.test(h)) emailCol = i
    if (nameCol  < 0 && /nome|name|contato|cliente/.test(h)) nameCol = i
  })
  if (phoneCol < 0 || emailCol < 0 || nameCol < 0) {
    const sample = body[0] ?? []
    sample.forEach((c, i) => {
      if (phoneCol < 0 && c.replace(/\D/g, "").length >= 10) phoneCol = i
      if (emailCol < 0 && c.includes("@")) emailCol = i
    })
    if (nameCol < 0) { const used = new Set([phoneCol, emailCol]); for (let i = 0; i < (body[0]?.length ?? 0); i++) if (!used.has(i)) { nameCol = i; break } }
  }
  return body.map((row) => ({
    name:  nameCol  >= 0 ? row[nameCol]  : undefined,
    phone: phoneCol >= 0 ? row[phoneCol] : (row.length === 1 ? row[0] : undefined),
    email: emailCol >= 0 ? row[emailCol] : undefined,
  }))
}

const STATUS = {
  new:      { label: "novo",      cls: "bg-emerald-50 text-emerald-700" },
  existing: { label: "já existe", cls: "bg-primary-50 text-primary-700" },
  invalid:  { label: "inválido",  cls: "bg-red-50 text-red-600" },
} as const

export function ImportarClient({ tags, imports }: { tags: { id: string; name: string; color: string | null }[]; imports: ImportRecord[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [step, setStep]   = useState<"input" | "preview" | "done">("input")
  const [text, setText]   = useState("")
  const [source, setSource] = useState<"paste" | "csv">("paste")
  const [rows, setRows]   = useState<ImportRow[]>([])
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [tagId, setTagId] = useState("")
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<{ importId: string; criados: number; atualizados: number; invalidos: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setSource("csv")
    const reader = new FileReader(); reader.onload = () => setText(String(reader.result ?? "")); reader.readAsText(f)
  }
  function analyze() {
    setError(null)
    const parsed = parseInput(text)
    if (!parsed.length) { setError("Cole alguns contatos ou suba um CSV."); return }
    setRows(parsed)
    start(async () => { const r = await previewImport(parsed); if ("error" in r) { setError(r.error); return } setPreview(r); setStep("preview") })
  }
  function confirm() {
    setError(null)
    start(async () => { const r = await commitImport({ rows, tagId: tagId || null, consent, source }); if ("error" in r) { setError(r.error); return } setReport(r); setStep("done") })
  }

  // ── Relatório ──
  if (step === "done" && report) return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <CheckCircle2 className="size-10 text-emerald-500 mx-auto" />
        <p className="text-lg font-bold text-slate-900 mt-2">Importação concluída</p>
        <div className="flex items-center justify-center gap-8 mt-4">
          <Num n={report.criados} label="criados" c="text-emerald-600" />
          <Num n={report.atualizados} label="atualizados" c="text-primary-600" />
          <Num n={report.invalidos} label="inválidos" c="text-slate-400" />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Os "atualizados" já existiam — <strong>nada foi duplicado</strong>.</p>
        <div className="flex items-center justify-center gap-3 mt-5">
          {report.importId && <Link href={`/contatos/importar/${report.importId}`} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg">Ver os {report.criados + report.atualizados} contatos</Link>}
          <Link href="/contatos" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="size-4" /> Contatos</Link>
        </div>
      </div>
    </div>
  )

  // ── Prévia (grade + painel) ──
  if (step === "preview" && preview) {
    const s = preview.summary
    return (
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 h-11 flex items-center border-b border-slate-100"><p className="text-sm font-semibold text-slate-900">{s.total} linhas</p></div>
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50/90 backdrop-blur"><tr className="text-[11px] text-slate-500">
                <th className="text-left font-medium py-2 px-3">Nome</th><th className="text-left font-medium py-2 px-3">Telefone</th>
                <th className="text-left font-medium py-2 px-3 hidden sm:table-cell">Email</th><th className="text-right font-medium py-2 px-3">Status</th>
              </tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-50">
                    <td className="py-1.5 px-3 text-slate-700 truncate max-w-[160px]">{r.name || "—"}</td>
                    <td className="py-1.5 px-3 text-slate-500 tabular-nums">{r.phone || <span className="text-red-400">{r.reason}</span>}</td>
                    <td className="py-1.5 px-3 text-slate-400 truncate max-w-[160px] hidden sm:table-cell">{r.email || "—"}</td>
                    <td className="py-1.5 px-3 text-right"><span className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-1 lg:sticky lg:top-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid grid-cols-3 gap-2">
              <Num n={s.novos} label="novos" c="text-emerald-600" sm /><Num n={s.existentes} label="atualiza" c="text-primary-600" sm /><Num n={s.invalidos} label="inválidos" c="text-slate-400" sm />
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Quem já existe é <strong>atualizado, não duplicado</strong>.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            {tags.length > 0 && (
              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Etiqueta no lote <span className="font-normal text-slate-400">· opcional</span></span>
                <SimpleSelect value={tagId} onChange={setTagId} placeholder="Nenhuma"
                  options={[{ value: "", label: "Nenhuma" }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
              </label>
            )}
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="size-4 rounded border-slate-300 text-primary focus:ring-primary/20 mt-0.5" />
              <span>Tenho <strong>permissão</strong> de contatar esses números (LGPD).</span>
            </label>
            {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
            <button type="button" onClick={confirm} disabled={pending || !consent || s.novos + s.existentes === 0}
              className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Importar {s.novos + s.existentes} contatos
            </button>
            <button type="button" onClick={() => { setStep("input"); setPreview(null) }} className="w-full h-8 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Voltar</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Entrada + histórico ──
  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><ClipboardPaste className="size-4 text-slate-400" /> Cole sua lista ou suba um CSV</p>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg"><UploadCloud className="size-3.5" /> Subir CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" />
          </div>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setSource("paste") }} rows={12}
            placeholder={"Maria Silva, 11999998888\nJoão Souza, 21988887777\n\nOu só os números, um por linha."}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono resize-none" />
          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
          <button type="button" onClick={analyze} disabled={pending || !text.trim()} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {pending && <Loader2 className="size-3.5 animate-spin" />} Analisar
          </button>
        </div>
        <div className="lg:col-span-1 rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-500 leading-relaxed space-y-2">
          <p className="font-semibold text-slate-700">Como funciona</p>
          <p>1. Reconhecemos <strong>nome · telefone · email</strong> automaticamente (com ou sem cabeçalho).</p>
          <p>2. Mostramos o que é <strong className="text-emerald-600">novo</strong> · <strong className="text-primary-600">já existe</strong> · <strong className="text-red-500">inválido</strong> antes de importar.</p>
          <p>3. <strong>Nunca duplica</strong> — quem já existe é atualizado.</p>
          <p className="text-slate-400">Exterior: use +DDI (ex: +1…). Até 500 por vez.</p>
        </div>
      </div>

      {imports.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 h-11 flex items-center gap-2 border-b border-slate-100"><History className="size-4 text-slate-400" /><p className="text-sm font-semibold text-slate-900">Histórico de importações</p></div>
          <ul>
            {imports.map((imp) => (
              <li key={imp.id}>
                <Link href={`/contatos/importar/${imp.id}`} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800"><span className="font-semibold text-emerald-600 tabular-nums">{imp.created}</span> criados · <span className="font-semibold text-primary-600 tabular-nums">{imp.updated}</span> atualizados{imp.invalid > 0 && <span className="text-slate-400"> · {imp.invalid} inválidos</span>}</p>
                    <p className="text-[11px] text-slate-400">{fmtDateTime(imp.created_at)}{imp.by_name ? ` · ${imp.by_name}` : ""}{imp.tag_name ? ` · tag ${imp.tag_name}` : ""}{imp.consent ? " · LGPD ✓" : ""}</p>
                  </div>
                  <ChevronRight className="size-4 text-slate-300 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Num({ n, label, c, sm }: { n: number; label: string; c: string; sm?: boolean }) {
  return (
    <div className={sm ? "rounded-lg border border-slate-200 px-2 py-1.5 text-center" : "text-center"}>
      <p className={`font-bold tabular-nums ${c} ${sm ? "text-xl" : "text-2xl"}`}>{n}</p>
      <p className="text-[10px] text-slate-400 leading-tight">{label}</p>
    </div>
  )
}
