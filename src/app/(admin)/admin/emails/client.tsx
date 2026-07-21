"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Mail, Eye, Zap, Code2, Sparkles, ExternalLink, Inbox, Send, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { adminSendDailyReportTest, adminSendTemplateTest, type TenantOption } from "@/lib/actions/admin-emails"

export interface TemplateMeta {
  slug:        string
  name:        string
  description: string
  trigger:     string
  subject:     string
  variables:   Array<{ key: string; description: string; example: string }>
}

interface Props {
  templates:       TemplateMeta[]
  tenants:         TenantOption[]
  defaultTestEmail: string
}

export function EmailsClient({ templates, tenants, defaultTestEmail }: Props) {
  const [activeSlug, setActiveSlug] = useState<string>(templates[0]?.slug ?? "")
  const active = templates.find((t) => t.slug === activeSlug) ?? templates[0]
  const [testOpen, setTestOpen] = useState(false)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Emails do sistema</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Templates transacionais disparados pelo Kora. Preview ao vivo + metadata.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/emails/log"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-primary-300 hover:text-primary-700 transition-colors"
            >
              <Inbox className="size-3.5" />
              Ver log de envios
            </Link>
            <div className="text-xs text-slate-500 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200">
              <Sparkles className="size-3.5 text-primary-600" />
              Provedor: <span className="font-semibold text-slate-900">Resend</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Lista de templates */}
          <div className="space-y-2">
            {templates.map((t) => {
              const isActive = t.slug === activeSlug
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => setActiveSlug(t.slug)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    isActive
                      ? "bg-white border-primary shadow-sm"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive ? "bg-primary-50 text-primary-600" : "bg-slate-50 text-slate-500"
                    }`}>
                      <Mail className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold truncate ${
                        isActive ? "text-primary-700" : "text-slate-900"
                      }`}>{t.name}</p>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">{t.description}</p>
                    </div>
                  </div>
                </button>
              )
            })}
            {templates.length === 0 && (
              <div className="text-center py-8 px-4 bg-white rounded-xl border border-slate-200">
                <Mail className="size-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">Nenhum template cadastrado.</p>
              </div>
            )}
          </div>

          {/* Preview + metadata */}
          {active && (
            <div className="space-y-4">
              {/* Metadata */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-slate-900">{active.name}</h2>
                    <p className="text-xs text-slate-500 mt-0.5">{active.description}</p>
                  </div>
                  {(active.slug === "daily_report" || active.slug === "novidades") && (
                    <button
                      type="button"
                      onClick={() => setTestOpen(true)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-700 transition-colors"
                    >
                      <Send className="size-3.5" /> Enviar teste
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-xs">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 inline-flex items-center gap-1">
                      <Zap className="size-3" />Quando dispara
                    </p>
                    <p className="text-slate-700 leading-relaxed">{active.trigger}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 inline-flex items-center gap-1">
                      <Mail className="size-3" />Assunto
                    </p>
                    <p className="text-slate-700 font-mono">{active.subject}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 inline-flex items-center gap-1">
                      <Code2 className="size-3" />Variáveis ({active.variables.length})
                    </p>
                    <div className="space-y-1.5">
                      {active.variables.map((v) => (
                        <div key={v.key} className="flex items-start gap-2 text-[11px]">
                          <code className="font-mono bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded shrink-0">{`{${v.key}}`}</code>
                          <span className="text-slate-600 flex-1">{v.description}</span>
                          <span className="text-slate-400 font-mono">ex: {v.example}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview iframe */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div className="inline-flex items-center gap-2">
                    <Eye className="size-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-900">Preview</span>
                    <span className="text-[10px] text-slate-400">renderizado com dados de exemplo</span>
                  </div>
                  <a
                    href={`/api/dev/email-preview?type=${active.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
                  >
                    Abrir em nova aba <ExternalLink className="size-3" />
                  </a>
                </div>
                <iframe
                  key={active.slug}
                  src={`/api/dev/email-preview?type=${active.slug}`}
                  title={`Preview do email ${active.name}`}
                  className="w-full h-[720px] bg-slate-50"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {testOpen && active?.slug === "daily_report" && (
        <SendTestModal
          tenants={tenants}
          onClose={() => setTestOpen(false)}
        />
      )}

      {testOpen && active?.slug === "novidades" && (
        <SendMarketingTestModal
          slug={active.slug}
          defaultEmail={defaultTestEmail}
          onClose={() => setTestOpen(false)}
        />
      )}
    </div>
  )
}

function SendMarketingTestModal({ slug, defaultEmail, onClose }: { slug: string; defaultEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState(defaultEmail)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSend() {
    setFeedback(null)
    startTransition(async () => {
      const r = await adminSendTemplateTest({ slug, toEmail: email })
      if (r.ok) setFeedback({ kind: "ok", msg: `Enviado pra ${email}. Confira a caixa (e o spam).` })
      else if (r.configured === false) setFeedback({ kind: "err", msg: "Resend não configurado (RESEND_API_KEY / EMAIL_FROM)." })
      else setFeedback({ kind: "err", msg: r.error ?? "Falha ao enviar" })
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
              <Send className="size-4 text-primary" />
              Enviar teste — Novidades
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Envia pra UM email só. Não é disparo em massa.</p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="size-4 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email destinatário</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white"
            />
            <p className="text-[11px] text-slate-500 mt-1">Renderiza com dados de exemplo (nome "Bernardo").</p>
          </div>

          {feedback && (
            <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
              feedback.kind === "ok"
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}>
              {feedback.kind === "ok" ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
              <span>{feedback.msg}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={handleSend} disabled={pending || !email} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar teste
          </button>
        </div>
      </div>
    </div>
  )
}

function SendTestModal({ tenants, onClose }: { tenants: TenantOption[]; onClose: () => void }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "")
  const [useOverride, setUseOverride] = useState(true)
  const [overrideEmail, setOverrideEmail] = useState("")
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSend() {
    setFeedback(null)
    if (!tenantId) {
      setFeedback({ kind: "err", msg: "Escolha um tenant" })
      return
    }
    const emails = useOverride
      ? overrideEmail.split(",").map((e) => e.trim()).filter(Boolean)
      : undefined
    if (useOverride && (!emails || emails.length === 0)) {
      setFeedback({ kind: "err", msg: "Informe ao menos um email destinatário" })
      return
    }

    startTransition(async () => {
      const r = await adminSendDailyReportTest({ tenantId, overrideEmails: emails })
      if (r.ok) {
        setFeedback({ kind: "ok", msg: `Enviado pra ${r.recipients} destinatário(s) (${r.tenantName})` })
      } else {
        setFeedback({ kind: "err", msg: r.reason ?? `Falha — status: ${r.status}` })
      }
    })
  }

  const selectedTenant = tenants.find((t) => t.id === tenantId)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
              <Send className="size-4 text-primary" />
              Testar relatório diário
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Envia agora com KPIs reais do tenant.</p>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <X className="size-4 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tenant</label>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
              ))}
            </select>
            {tenants.length === 0 && (
              <p className="text-xs text-red-600 mt-1">Nenhum tenant ativo.</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useOverride}
                onChange={(e) => setUseOverride(e.target.checked)}
                className="mt-0.5"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-700">Sobrescrever destinatário</span>
                <p className="text-slate-500 mt-0.5">
                  {useOverride
                    ? "Enviar pra emails específicos (separados por vírgula)"
                    : `Usar destinatários configurados no ${selectedTenant?.name ?? "tenant"} (owners/admins ou lista custom)`}
                </p>
              </div>
            </label>
            {useOverride && (
              <input
                type="text"
                value={overrideEmail}
                onChange={(e) => setOverrideEmail(e.target.value)}
                placeholder="seuemail@exemplo.com, outro@exemplo.com"
                className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white"
              />
            )}
          </div>

          <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800 leading-relaxed">
            <strong>⚠ Ignora idempotência</strong> e <strong>toggle desabilitado</strong> do tenant. KPIs reais (computados agora). Não atualiza o ciclo normal do cron.
          </div>

          {feedback && (
            <div className={`flex items-start gap-2 p-2.5 rounded-lg text-xs ${
              feedback.kind === "ok"
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-red-50 border border-red-200 text-red-800"
            }`}>
              {feedback.kind === "ok" ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
              <span>{feedback.msg}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={pending || !tenantId}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar agora
          </button>
        </div>
      </div>
    </div>
  )
}
