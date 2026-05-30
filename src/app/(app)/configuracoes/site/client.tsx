"use client"

import { useState, useTransition, useEffect } from "react"
import {
  Save, Loader2, AlertCircle, CheckCircle2, Code2, Eye, EyeOff,
  Plus, Trash2, GripVertical, Copy, Check, Globe,
  Sparkles, Settings as SettingsIcon, Palette, ShieldCheck, FileText, X, Download,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { updateWidgetConfig, generatePrivacyPolicy, type WidgetConfig, type WidgetQuestion } from "@/lib/actions/site-widget"
import { Switch } from "@/components/ui/switch"

interface Props {
  initial:     WidgetConfig
  tenantSlug:  string
  departments: Array<{ id: string; name: string; color: string }>
  tags:        Array<{ id: string; name: string; color: string }>
  appUrl:      string
}

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

const COLOR_PRESETS = [
  "#004add", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#6366F1", "#0f172a",
]

export function SiteWidgetClient({ initial, tenantSlug, departments, tags, appUrl }: Props) {
  const [cfg, setCfg] = useState<WidgetConfig>(initial)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [policyOpen, setPolicyOpen] = useState(false)

  function handleSave() {
    setFeedback(null)
    startTransition(async () => {
      const result = await updateWidgetConfig(cfg)
      if (result.error) setFeedback({ kind: "error", text: result.error })
      else setFeedback({ kind: "ok", text: "Configuração salva" })
    })
  }

  function patch(p: Partial<WidgetConfig>) {
    setCfg((c) => ({ ...c, ...p }))
  }

  function updateQuestion(idx: number, q: Partial<WidgetQuestion>) {
    setCfg((c) => ({
      ...c,
      questions: c.questions.map((qq, i) => i === idx ? { ...qq, ...q } : qq),
    }))
  }

  function addQuestion() {
    if (cfg.questions.length >= 5) return
    const newQ: WidgetQuestion = {
      id:       `q${Date.now().toString(36).slice(-4)}`,
      label:    "Nova pergunta",
      type:     "text",
      required: false,
    }
    setCfg((c) => ({ ...c, questions: [...c.questions, newQ] }))
  }

  function removeQuestion(idx: number) {
    setCfg((c) => ({ ...c, questions: c.questions.filter((_, i) => i !== idx) }))
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const next = idx + dir
    if (next < 0 || next >= cfg.questions.length) return
    setCfg((c) => {
      const arr = [...c.questions]
      const [moved] = arr.splice(idx, 1)
      arr.splice(next, 0, moved)
      return { ...c, questions: arr }
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">

      {/* ── Coluna principal: config ─────────────────── */}
      <div className="space-y-6 min-w-0">

        {/* Master toggle */}
        <SectionCard>
          <div className="flex items-start gap-3">
            <Switch
              size="lg"
              checked={cfg.enabled}
              onChange={(next) => patch({ enabled: next })}
            />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary-600" />
                Widget ativo no site
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Quando desligado, o widget some do site dos seus clientes — mas
                código embutido continua funcionando assim que você reativar.
              </p>
            </div>
          </div>
        </SectionCard>

        <div className={cfg.enabled ? "" : "opacity-50 pointer-events-none"}>

          {/* Modo do widget */}
          <SectionCard icon={Sparkles} title="Modo do widget" description="Como o visitante interage" className="mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => patch({ mode: "form" })}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  cfg.mode !== "chat"
                    ? "border-primary-300 bg-primary-50/50 ring-1 ring-primary-200"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">Formulário (captura)</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Faz as perguntas configuradas e vira um lead no inbox. O time continua no WhatsApp.
                </p>
              </button>
              <button
                type="button"
                onClick={() => patch({ mode: "chat" })}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  cfg.mode === "chat"
                    ? "border-primary-300 bg-primary-50/50 ring-1 ring-primary-200"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  Chat ao vivo
                  <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded uppercase tracking-wide">IA</span>
                </p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Conversa em tempo real com a Kora IA ali no widget. As perguntas abaixo não se aplicam.
                </p>
              </button>
            </div>
          </SectionCard>

          {/* Branding */}
          <SectionCard icon={Palette} title="Marca e identidade">
            <div className="space-y-4">

              <FormRow
                label="Logo da empresa (URL)"
                hint="URL da imagem (PNG, JPG ou SVG). Recomendado: 200×200px ou maior, com fundo transparente."
              >
                <div className="flex items-center gap-3">
                  {cfg.logo_url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={cfg.logo_url}
                      alt="Preview do logo"
                      className="size-10 rounded-full object-cover border border-slate-200 shrink-0 bg-white"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                    />
                  )}
                  <input
                    type="url"
                    value={cfg.logo_url ?? ""}
                    onChange={(e) => patch({ logo_url: e.target.value || null })}
                    placeholder="https://exemplo.com/logo.png"
                    className={inputCls}
                  />
                </div>
              </FormRow>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Nome de exibição" hint="Aparece no topo do chat. Vazio = nome do tenant.">
                  <input
                    type="text"
                    value={cfg.brand_name ?? ""}
                    onChange={(e) => patch({ brand_name: e.target.value || null })}
                    placeholder="Sua Empresa"
                    maxLength={40}
                    className={inputCls}
                  />
                </FormRow>

                <FormRow label="Subtítulo" hint="Linha menor abaixo do nome. Comunica disponibilidade.">
                  <input
                    type="text"
                    value={cfg.subtitle ?? ""}
                    onChange={(e) => patch({ subtitle: e.target.value || null })}
                    placeholder="Respondemos em alguns minutos"
                    maxLength={60}
                    className={inputCls}
                  />
                </FormRow>
              </div>
            </div>
          </SectionCard>

          {/* Aparência */}
          <div className="mt-6">
            <SectionCard icon={Palette} title="Aparência">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormRow label="Texto do botão" hint="Aparece quando o visitante passa o mouse">
                    <input
                      type="text"
                      value={cfg.button_label}
                      onChange={(e) => patch({ button_label: e.target.value })}
                      maxLength={40}
                      className={inputCls}
                    />
                  </FormRow>
                  <FormRow label="Posição">
                    <select
                      value={cfg.button_position}
                      onChange={(e) => patch({ button_position: e.target.value as WidgetConfig["button_position"] })}
                      className={inputCls}
                    >
                      <option value="bottom-right">Inferior direita</option>
                      <option value="bottom-left">Inferior esquerda</option>
                    </select>
                  </FormRow>
                </div>

                <FormRow label="Cor primária" hint="Botão flutuante, cabeçalho e mensagens do visitante">
                  <div className="flex flex-wrap items-center gap-2">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => patch({ button_color: c })}
                        className="size-8 rounded-lg transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          boxShadow: cfg.button_color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
                        }}
                        aria-label={`Cor ${c}`}
                      />
                    ))}
                    <input
                      type="text"
                      value={cfg.button_color}
                      onChange={(e) => patch({ button_color: e.target.value })}
                      maxLength={7}
                      className={`${inputCls} w-24 font-mono`}
                      placeholder="#000000"
                    />
                  </div>
                </FormRow>

                <FormRow label="Saudação inicial" hint="Primeira mensagem do chat — aparece antes da 1ª pergunta">
                  <input
                    type="text"
                    value={cfg.greeting}
                    onChange={(e) => patch({ greeting: e.target.value })}
                    maxLength={120}
                    className={inputCls}
                  />
                </FormRow>

                <FormRow label="Mensagem de sucesso" hint="Mostrada após o visitante completar o form">
                  <textarea
                    value={cfg.success_message}
                    onChange={(e) => patch({ success_message: e.target.value })}
                    rows={2}
                    maxLength={200}
                    className={`${inputCls} h-auto py-2 resize-none`}
                  />
                </FormRow>
              </div>
            </SectionCard>
          </div>

          {/* Perguntas */}
          <div className="mt-6">
            <SectionCard
              icon={SettingsIcon}
              title="Perguntas do formulário"
              description={`Até 5 perguntas. ${cfg.questions.length}/5 configuradas. Arraste pra reordenar.`}
              actions={
                cfg.questions.length < 5 ? (
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-lg transition-colors"
                  >
                    <Plus className="size-3.5" /> Pergunta
                  </button>
                ) : null
              }
            >
              <div className="space-y-2">
                {cfg.questions.map((q, idx) => (
                  <QuestionRow
                    key={q.id + idx}
                    question={q}
                    canUp={idx > 0}
                    canDown={idx < cfg.questions.length - 1}
                    onChange={(p) => updateQuestion(idx, p)}
                    onRemove={() => removeQuestion(idx)}
                    onMoveUp={() => moveQuestion(idx, -1)}
                    onMoveDown={() => moveQuestion(idx, +1)}
                  />
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Routing default */}
          <div className="mt-6">
            <SectionCard title="Roteamento padrão" description="Aplicado automaticamente nos leads que entrarem por aqui">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormRow label="Departamento (futuro routing)">
                  <select
                    value={cfg.default_department_id ?? ""}
                    onChange={(e) => patch({ default_department_id: e.target.value || null })}
                    className={inputCls}
                  >
                    <option value="">— Sem departamento padrão —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </FormRow>

                <FormRow label="Tag aplicada automaticamente">
                  <select
                    value={cfg.default_tag_id ?? ""}
                    onChange={(e) => patch({ default_tag_id: e.target.value || null })}
                    className={inputCls}
                  >
                    <option value="">— Sem tag automática —</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </FormRow>
              </div>
            </SectionCard>
          </div>

          {/* Comportamento */}
          <div className="mt-6">
            <SectionCard title="Comportamento">
              <div className="space-y-4">
                <FormRow label="Aparecer após X segundos" hint="0 = aparece imediatamente. 5 = espera 5s antes do botão renderizar">
                  <input
                    type="number"
                    min={0}
                    max={120}
                    value={cfg.show_after_seconds}
                    onChange={(e) => patch({ show_after_seconds: Number(e.target.value) || 0 })}
                    className={`${inputCls} w-32 tabular-nums`}
                  />
                </FormRow>

                <FormRow
                  label="Esconder nestas URLs"
                  hint="Uma por linha. Suporta * (glob). Ex: /admin/*, /login"
                >
                  <textarea
                    value={cfg.hide_url_patterns.join("\n")}
                    onChange={(e) => patch({ hide_url_patterns: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                    rows={3}
                    className={`${inputCls} h-auto py-2 resize-none font-mono`}
                    placeholder="/admin/*&#10;/checkout"
                  />
                </FormRow>
              </div>
            </SectionCard>
          </div>

          {/* ── LGPD — Consentimento + transparência ─────────────── */}
          <div className="mt-6">
            <SectionCard
              icon={ShieldCheck}
              title="LGPD — Consentimento e privacidade"
              description="Obrigatório pra coletar dados pessoais legalmente no Brasil (Lei 13.709/18)"
            >
              <div className="space-y-4">
                <FormRow
                  label="URL da política de privacidade"
                  hint="Publique a política em uma página do seu site (ex: /politica-privacidade). Vira link clicável no widget."
                >
                  <input
                    type="url"
                    value={cfg.privacy_policy_url ?? ""}
                    onChange={(e) => patch({ privacy_policy_url: e.target.value || null })}
                    placeholder="https://seusite.com.br/politica-privacidade"
                    maxLength={500}
                    className={inputCls}
                  />
                </FormRow>

                <FormRow
                  label="Texto do consentimento"
                  hint="Use o token {politica_privacidade} pra colocar o link. Se a URL acima estiver vazia, o checkbox de consent não aparece (recomendado preencher)."
                >
                  <textarea
                    value={cfg.consent_text ?? ""}
                    onChange={(e) => patch({ consent_text: e.target.value || null })}
                    rows={2}
                    maxLength={400}
                    placeholder="Concordo com a {politica_privacidade} e com o tratamento dos meus dados para contato."
                    className={`${inputCls} h-auto py-2 resize-none`}
                  />
                </FormRow>

                <FormRow
                  label="Email do encarregado de dados (DPO)"
                  hint="LGPD Art. 41 — exige nome/contato do encarregado. Aparece no rodapé do widget."
                >
                  <input
                    type="email"
                    value={cfg.dpo_email ?? ""}
                    onChange={(e) => patch({ dpo_email: e.target.value || null })}
                    placeholder="dpo@seusite.com.br"
                    maxLength={254}
                    className={inputCls}
                  />
                </FormRow>

                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-900 leading-relaxed">
                    <strong>Compliance check:</strong> sem URL da política preenchida o widget
                    coleta dados sem consentimento explícito — risco de multa LGPD. Recomendamos
                    fortemente preencher antes de subir o widget em produção.
                  </div>
                </div>

                {/* Template gerado */}
                <div className="pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setPolicyOpen(true)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 rounded-lg transition-colors"
                  >
                    <FileText className="size-3.5" />
                    Gerar política de privacidade padrão
                  </button>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                    Não tem política ainda? Geramos um <strong>template em markdown LGPD-compliant</strong> personalizado
                    com seus dados. Você copia, edita os pontos <code className="bg-slate-100 px-1 rounded">[EDITAR]</code> e publica
                    no seu site. <strong>Importante:</strong> revise com seu advogado antes de publicar.
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>

        {/* Save bar */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 flex items-center gap-3 sticky bottom-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Salvar
          </button>
          {feedback && (
            <span className={`inline-flex items-center gap-1.5 text-xs ${feedback.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>
              {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
              {feedback.text}
            </span>
          )}
        </div>
      </div>

      {/* ── Coluna direita: instalação + preview ─────── */}
      <div className="space-y-6 lg:sticky lg:top-4">
        <InstallSnippet slug={tenantSlug} appUrl={appUrl} />
        <WidgetPreview cfg={cfg} />
      </div>

      {/* Modal: política de privacidade gerada */}
      {policyOpen && (
        <PrivacyPolicyModal onClose={() => setPolicyOpen(false)} />
      )}
    </div>
  )
}

// ── Modal de política de privacidade ──────────────────────

function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading]     = useState(true)
  const [markdown, setMarkdown]   = useState("")
  const [copied, setCopied]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Gera ao abrir (server action)
  useEffect(() => {
    generatePrivacyPolicy()
      .then((r) => { setMarkdown(r.markdown); setLoading(false) })
      .catch((e) => { setError((e as Error).message); setLoading(false) })
  }, [])

  function handleCopy() {
    navigator.clipboard.writeText(markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function handleDownload() {
    const blob = new Blob([markdown], { type: "text/markdown" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href     = url
    a.download = `politica-privacidade-${new Date().toISOString().slice(0,10)}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 supports-backdrop-filter:backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-soft w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="size-9 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
            <FileText className="size-4 text-primary-600" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Política de privacidade gerada</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Template LGPD em markdown. Edite os pontos <code className="bg-slate-100 px-1 rounded">[EDITAR]</code>,
              publique no seu site e cole a URL no campo acima.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 text-slate-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-xs text-red-600 p-3 rounded-lg bg-red-50 border border-red-100">
              {error}
            </div>
          ) : (
            <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-slate-700 bg-slate-50 rounded-lg p-4 border border-slate-200">
{markdown}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <p className="text-[10px] text-slate-500 leading-relaxed flex-1 min-w-0">
            ⚠️ Template — <strong>revise com seu advogado</strong> antes de publicar. Atualize endereço,
            CNPJ, prazos de retenção e foro conforme sua operação.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              disabled={loading || !!error}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <Download className="size-3.5" />
              Baixar .md
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={loading || !!error}
              className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 ${
                copied
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                  : "bg-primary hover:bg-primary-700 text-white"
              }`}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copiado!" : "Copiar markdown"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pergunta editável ──────────────────────────────────────

function QuestionRow({
  question, canUp, canDown, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  question:    WidgetQuestion
  canUp:       boolean
  canDown:     boolean
  onChange:    (p: Partial<WidgetQuestion>) => void
  onRemove:    () => void
  onMoveUp:    () => void
  onMoveDown:  () => void
}) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-0.5 mt-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canUp}
          aria-label="Subir"
          className="size-5 inline-flex items-center justify-center text-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ↑
        </button>
        <GripVertical className="size-3.5 text-slate-300" />
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canDown}
          aria-label="Descer"
          className="size-5 inline-flex items-center justify-center text-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ↓
        </button>
      </div>

      <div className="flex-1 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2">
          <input
            type="text"
            value={question.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Pergunta visível no chat"
            maxLength={120}
            className="h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <select
            value={question.type}
            onChange={(e) => {
              const next = e.target.value as WidgetQuestion["type"]
              onChange({
                type:    next,
                options: next === "select" ? (question.options ?? []) : undefined,
              })
            }}
            className="h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="text">Texto curto</option>
            <option value="longtext">Texto longo</option>
            <option value="email">Email</option>
            <option value="phone">Telefone</option>
            <option value="select">Opções (chips)</option>
          </select>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(e) => onChange({ required: e.target.checked })}
                className="size-3.5 rounded border-slate-300 text-primary focus:ring-primary/30"
              />
              Obrigatório
            </label>
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remover"
              className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {question.type === "select" && (
          <ChipsEditor
            value={question.options ?? []}
            onChange={(opts) => onChange({ options: opts })}
          />
        )}
      </div>
    </div>
  )
}

// ── Editor de opções (chips) ───────────────────────────────

function ChipsEditor({
  value, onChange,
}: {
  value:    string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const v = draft.trim()
    if (!v) return
    if (value.includes(v)) { setDraft(""); return }
    onChange([...value, v].slice(0, 8))
    setDraft("")
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <div className="pl-1 pr-1 py-2 bg-slate-50 rounded-lg border border-dashed border-slate-300">
      <div className="flex items-center gap-1.5 mb-2 px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Opções (até 8) — visitante toca pra responder
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 px-2">
        {value.map((opt, i) => (
          <span
            key={`${opt}-${i}`}
            className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 bg-white border border-slate-200 rounded-full text-xs text-slate-700"
          >
            {opt}
            <button
              type="button"
              onClick={() => remove(i)}
              className="size-5 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50"
              aria-label={`Remover ${opt}`}
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        ))}
        {value.length < 8 && (
          <div className="inline-flex items-center gap-1">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
              placeholder="Ex: Comprar"
              maxLength={32}
              className="h-7 px-2 text-xs border border-slate-200 rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 w-32"
            />
            <button
              type="button"
              onClick={add}
              disabled={!draft.trim()}
              className="h-7 px-2 text-xs font-semibold bg-primary-50 hover:bg-primary-100 disabled:opacity-40 text-primary-700 rounded-full inline-flex items-center gap-1"
            >
              <Plus className="size-3" /> Adicionar
            </button>
          </div>
        )}
      </div>
      {value.length === 0 && (
        <p className="text-[10px] text-slate-400 mt-2 px-2 italic">
          Sem opções configuradas — a pergunta vai cair em input aberto.
        </p>
      )}
    </div>
  )
}

// ── Snippet de instalação ──────────────────────────────────

function InstallSnippet({ slug, appUrl }: { slug: string; appUrl: string }) {
  const [copied, setCopied] = useState(false)
  const baseUrl = appUrl || (typeof window !== "undefined" ? window.location.origin : "")
  // data-cfasync="false" evita o Cloudflare Rocket Loader reescrever o script
  // (causa #1 de widget não aparecer em sites atrás de Cloudflare)
  const snippet = `<!-- Kora — chat widget -->
<script src="${baseUrl}/w/${slug}" async defer data-cfasync="false"></script>`

  function handleCopy() {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <SectionCard icon={Code2} title="Como instalar">
      <p className="text-xs text-slate-500 mb-3">
        Cole esta linha antes do <code className="bg-slate-100 px-1 rounded">&lt;/body&gt;</code> do seu site:
      </p>
      <div className="relative">
        <pre className="text-[11px] font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto leading-relaxed">
          {snippet}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copiar"
          className={`absolute top-2 right-2 size-7 inline-flex items-center justify-center rounded-md transition-colors ${
            copied ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 hover:bg-white/20 text-slate-300"
          }`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
        Funciona em qualquer site (HTML, WordPress, Webflow, Shopify, etc).
        Sem dependências. ~5KB.
      </p>
    </SectionCard>
  )
}

// ── Preview live ───────────────────────────────────────────

function WidgetPreview({ cfg }: { cfg: WidgetConfig }) {
  const [open, setOpen] = useState(true)

  const color = cfg.button_color || "#004add"
  const isLeft = cfg.button_position === "bottom-left"
  const brand = (cfg.brand_name?.trim() || cfg.button_label || "Atendimento").trim()
  const initial = (brand || "K").charAt(0).toUpperCase()
  const subtitle = (cfg.subtitle?.trim() || "Online agora").trim()
  const firstQ = cfg.questions[0]
  const isFirstSelect = firstQ?.type === "select" && (firstQ?.options?.length ?? 0) > 0

  // Saudação contextual prevista
  const hour = new Date().getHours()
  const greetPrefix = hour < 12 ? "Bom dia! ☀️ " : hour < 18 ? "Boa tarde! 👋 " : "Boa noite! 🌙 "
  const fullGreet = greetPrefix + (cfg.greeting || "Oi! Como posso te ajudar?")

  // Avatar mini (AI orb wrapper)
  function MiniAvatar() {
    return (
      <div className="relative size-5 shrink-0">
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "conic-gradient(from 0deg, #60a5fa, #c084fc, #f472b6, #60a5fa)", animation: "kwspin 5s linear infinite" }}
        />
        <div className="absolute inset-[1.5px] rounded-full bg-white flex items-center justify-center overflow-hidden text-[7px] font-bold text-slate-500">
          {cfg.logo_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={cfg.logo_url} alt="" className="size-full object-cover" />
          ) : initial}
        </div>
      </div>
    )
  }

  return (
    <SectionCard icon={Globe} title="Pré-visualização" description="Réplica fiel do widget no site">
      {/* Keyframes locais — só pro preview */}
      <style>{`
        @keyframes kwspin { to { transform: rotate(360deg); } }
        @keyframes kwflow { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
      `}</style>

      <div className="relative h-[460px] bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg overflow-hidden border border-slate-200">
        {/* Fake página de fundo */}
        <div className="absolute inset-0 p-4">
          <div className="h-2.5 w-1/2 bg-slate-300/70 rounded mb-3" />
          <div className="h-1.5 w-full bg-slate-300/50 rounded mb-1.5" />
          <div className="h-1.5 w-5/6 bg-slate-300/50 rounded mb-1.5" />
          <div className="h-1.5 w-4/6 bg-slate-300/50 rounded mb-4" />
          <div className="h-1.5 w-full bg-slate-300/50 rounded mb-1.5" />
          <div className="h-1.5 w-3/4 bg-slate-300/50 rounded" />
        </div>

        {/* Widget janela */}
        {open && (
          <div
            className={`absolute ${isLeft ? "left-3" : "right-3"} bottom-16 w-[270px] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col`}
            style={{ height: 360 }}
          >
            {/* Header com AI orb */}
            <div
              className="relative px-3 py-2.5 flex items-center gap-2.5 text-white shrink-0"
              style={{ backgroundColor: color }}
            >
              <div className="relative size-9 shrink-0">
                <div
                  className="absolute -inset-0.5 rounded-full"
                  style={{ background: "conic-gradient(from 0deg, #60a5fa, #c084fc, #f472b6, #60a5fa)", animation: "kwspin 4.5s linear infinite" }}
                />
                <div className="absolute inset-0 rounded-full bg-white/22" />
                <div className="absolute inset-[3px] rounded-full bg-white/16 flex items-center justify-center overflow-hidden text-[12px] font-bold">
                  {cfg.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={cfg.logo_url}
                      alt=""
                      className="size-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                    />
                  ) : (
                    initial
                  )}
                </div>
                <span className="absolute bottom-0 right-0 size-2 rounded-full bg-emerald-500 ring-[1.5px] ring-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold leading-tight truncate">{brand}</p>
                <p className="text-[10px] leading-tight opacity-90 truncate flex items-center gap-1 mt-0.5">
                  <span className="size-1 rounded-full bg-emerald-300 inline-block" />
                  {subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="bg-white/20 hover:bg-white/30 rounded-md size-5 inline-flex items-center justify-center transition-colors shrink-0"
                aria-label="Fechar"
              >
                <span className="text-[9px] leading-none">✕</span>
              </button>

              {/* Progress bar */}
              <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-white/20">
                <div
                  className="h-full w-1/3"
                  style={{ background: "linear-gradient(90deg, #60a5fa, #c084fc, #f472b6)" }}
                />
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 px-2.5 py-3 bg-slate-50 overflow-hidden flex flex-col gap-1.5">
              {/* Greeting (com prefix de horário) */}
              <div className="flex items-end gap-1.5">
                <MiniAvatar />
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-2.5 py-1.5 text-[10px] leading-snug text-slate-800 max-w-[80%]">
                  {fullGreet}
                </div>
              </div>

              {/* First question */}
              {firstQ && (
                <div className="flex items-end gap-1.5">
                  <MiniAvatar />
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-2.5 py-1.5 text-[10px] leading-snug text-slate-800 max-w-[80%]">
                    {firstQ.label}
                  </div>
                </div>
              )}

              {/* AI typing pill */}
              <div className="flex items-end gap-1.5">
                <MiniAvatar />
                <div
                  className="h-4 w-12 rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #60a5fa, #c084fc, #f472b6, #c084fc, #60a5fa)",
                    backgroundSize: "300% 100%",
                    animation: "kwflow 1.6s ease-in-out infinite",
                  }}
                />
              </div>
            </div>

            {/* Form area: chips OU input */}
            {isFirstSelect ? (
              <div className="p-2 bg-white border-t border-slate-200 shrink-0 flex flex-wrap gap-1">
                {(firstQ.options ?? []).slice(0, 5).map((opt) => (
                  <span
                    key={opt}
                    className="px-2 py-1 text-[9px] font-semibold rounded-full border bg-white"
                    style={{ borderColor: color, color }}
                  >
                    {opt}
                  </span>
                ))}
              </div>
            ) : (
              <div className="p-2 bg-white border-t border-slate-200 shrink-0">
                <div className="h-6 bg-slate-50 border border-slate-300 rounded-lg px-2 flex items-center text-[9px] text-slate-400">
                  Digite sua resposta...
                </div>
                <div
                  className="mt-1.5 h-6 rounded-lg text-[9px] font-semibold text-white flex items-center justify-center"
                  style={{ backgroundColor: color }}
                >
                  Continuar
                </div>
              </div>
            )}

            {/* Powered by */}
            <div className="px-2 py-1 text-center text-[8px] text-slate-400 bg-slate-50 border-t border-slate-200 shrink-0">
              Powered by Kora
            </div>
          </div>
        )}

        {/* FAB */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`absolute ${isLeft ? "left-3" : "right-3"} bottom-3 size-11 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-110 active:scale-95`}
          style={{ backgroundColor: color }}
          aria-label="Toggle preview"
        >
          {open ? (
            <EyeOff className="size-4" />
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="size-5 relative z-10" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.06L2 22l5.06-1.37C8.55 21.5 10.22 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm4.52 14c-.2.56-1.18 1.08-1.65 1.15-.42.06-.95.09-1.54-.1-.36-.11-.82-.26-1.4-.51-2.46-1.06-4.06-3.52-4.18-3.69-.12-.16-1-1.33-1-2.53s.63-1.79.86-2.04c.23-.25.5-.31.66-.31.16 0 .33 0 .47.01.14 0 .35-.07.55.41.21.49.7 1.69.76 1.82.06.13.1.28.02.43-.08.16-.12.26-.25.41-.13.14-.27.32-.38.43-.13.13-.25.27-.11.51.14.25.64 1.06 1.38 1.72.95.84 1.75 1.1 2 1.23.25.13.39.11.53-.06.14-.17.61-.71.77-.96.16-.25.32-.21.55-.13.23.09 1.42.67 1.67.8.25.13.41.19.47.3.07.11.07.6-.14 1.16z"/>
              </svg>
              <span
                className="absolute inset-0 rounded-full animate-ping opacity-40"
                style={{ backgroundColor: color }}
              />
            </>
          )}
        </button>
      </div>

      <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
        ✨ Avatar com orb de IA · barra de progresso · saudação por horário · chips em perguntas com opções · confetti no fim · acena após 30s parado. Janela real: 380×580px.
      </p>
    </SectionCard>
  )
}
