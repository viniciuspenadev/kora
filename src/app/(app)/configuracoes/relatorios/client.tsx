"use client"

import { useState, useTransition, useMemo } from "react"
import { SectionCard } from "@/components/ui/section-card"
import { Switch } from "@/components/ui/switch"
import { CheckCircle2, AlertCircle, Mail } from "lucide-react"
import { updateDailyReportConfig, type DailyReportConfig } from "@/lib/actions/daily-reports"

const ROLE_LABEL: Record<string, { label: string; cls: string }> = {
  owner: { label: "Owner",     cls: "bg-violet-50 text-violet-700" },
  admin: { label: "Admin",     cls: "bg-primary-50 text-primary-700" },
  agent: { label: "Atendente", cls: "bg-slate-100 text-slate-600" },
}

export function RelatoriosClient({ config: initialConfig }: { config: DailyReportConfig }) {
  const [enabled, setEnabled] = useState(initialConfig.enabled)
  const [emails, setEmails]   = useState<string[]>(initialConfig.emails)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)
  const [, startTransition] = useTransition()

  const emailSet = useMemo(() => new Set(emails.map((e) => e.toLowerCase())), [emails])

  function showFeedback(kind: "ok" | "err", msg: string) {
    setFeedback({ kind, msg })
    setTimeout(() => setFeedback(null), 4000)
  }

  function saveConfig(payload: { enabled?: boolean; emails?: string[] }) {
    startTransition(async () => {
      const r = await updateDailyReportConfig(payload)
      if ("error" in r) showFeedback("err", r.error)
      else              showFeedback("ok", "Salvo")
    })
  }

  function handleToggle(v: boolean) {
    setEnabled(v)
    saveConfig({ enabled: v })
  }

  function toggleRecipient(email: string) {
    const lower = email.toLowerCase()
    const next = emailSet.has(lower)
      ? emails.filter((e) => e.toLowerCase() !== lower)
      : [...emails, email]
    setEmails(next)
    saveConfig({ emails: next })
  }

  const totalSelected = emails.length
  const usingFallback = totalSelected === 0
  const fallbackCount = initialConfig.members.filter((m) => m.role === "owner" || m.role === "admin").length

  return (
    <div className="space-y-4">
      {/* Toggle principal */}
      <SectionCard
        title="Relatório diário"
        description="Email enviado todo dia às 18h (horário de Brasília) com resumo de KPIs."
        icon={Mail}
      >
        <div className="flex items-center justify-between gap-4">
          <Switch
            size="lg"
            checked={enabled}
            onChange={handleToggle}
            label={enabled ? "Ativado" : "Desativado"}
            description={
              enabled
                ? "Resumo será enviado todos os dias se houver atividade."
                : "Nenhum email automático será enviado."
            }
          />
          {initialConfig.lastSentAt && (
            <div className="text-right shrink-0">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">Último envio</p>
              <p className="text-xs text-slate-700 tabular-nums">
                {new Date(initialConfig.lastSentAt).toLocaleString("pt-BR", {
                  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
                })}
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Destinatários */}
      <SectionCard
        title="Quem recebe"
        description="Selecione os usuários do tenant que devem receber o resumo diário."
      >
        {usingFallback && (
          <div className="mb-4 p-3 rounded-lg bg-primary-50 border border-primary-100 text-xs text-primary-800">
            <strong>Sem ninguém selecionado.</strong> Nesse caso, o resumo é enviado automaticamente para os <strong>{fallbackCount} owner{fallbackCount !== 1 ? "s" : ""} e admin{fallbackCount !== 1 ? "s" : ""}</strong> do tenant (comportamento padrão).
          </div>
        )}
        {!usingFallback && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-100 text-xs text-green-800">
            <strong>{totalSelected} pessoa{totalSelected !== 1 ? "s" : ""} selecionada{totalSelected !== 1 ? "s" : ""}</strong> para receber o resumo.
          </div>
        )}

        {initialConfig.members.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            Nenhum usuário ativo no tenant ainda. Convide pessoas em <strong>Configurações → Equipe</strong>.
          </div>
        ) : (
          <div className="space-y-1.5">
            {initialConfig.members.map((m) => {
              const selected = emailSet.has(m.email.toLowerCase())
              const role = ROLE_LABEL[m.role] ?? ROLE_LABEL.agent
              return (
                <label
                  key={m.email}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected
                      ? "bg-primary-50/50 border-primary-200"
                      : "bg-white border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleRecipient(m.email)}
                    className="size-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                  />
                  <div className="size-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-slate-600">
                      {(m.name ?? m.email)[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{m.name ?? m.email}</p>
                    {m.name && <p className="text-[11px] text-slate-400 truncate">{m.email}</p>}
                  </div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${role.cls}`}>
                    {role.label}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Feedback flutuante */}
      {feedback && (
        <div className={`fixed bottom-6 right-6 max-w-sm flex items-start gap-2.5 p-3 rounded-xl shadow-lg border z-50 ${
          feedback.kind === "ok"
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {feedback.kind === "ok" ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
          <span className="text-sm">{feedback.msg}</span>
        </div>
      )}
    </div>
  )
}
