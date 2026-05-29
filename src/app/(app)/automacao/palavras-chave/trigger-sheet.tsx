"use client"

import { useState, useRef, useTransition } from "react"
import { Loader2, X } from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { SUPPORTED_VARIABLES } from "@/lib/automation/variables"
import {
  createKeywordTrigger, updateKeywordTrigger,
} from "@/lib/actions/keyword-triggers"
import type { TriggerRow, TagOption, MatchType } from "./client"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

const textareaCls =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none transition-colors"

interface Props {
  trigger:    TriggerRow | null
  tags:       TagOption[]
  onClose:    () => void
  onFeedback: (kind: "ok" | "error", text: string) => void
}

export function TriggerSheet({ trigger, tags, onClose, onFeedback }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [name, setName]                       = useState(trigger?.name ?? "")
  const [patterns, setPatterns]               = useState<string[]>(trigger?.patterns ?? [])
  const [patternInput, setPatternInput]       = useState("")
  const [matchType, setMatchType]             = useState<MatchType>(trigger?.match_type ?? "contains")
  const [caseSensitive, setCaseSensitive]     = useState(trigger?.case_sensitive ?? false)
  const [responseText, setResponseText]       = useState(trigger?.response_text ?? "")
  const [applyTagId, setApplyTagId]           = useState<string>(trigger?.apply_tag_id ?? "")
  const [cooldownMin, setCooldownMin]         = useState(trigger?.cooldown_min ?? 60)
  const [enabled, setEnabled]                 = useState(trigger?.enabled ?? true)
  const [pauseWhenAssigned, setPauseWhenAssigned] = useState(trigger?.pause_when_assigned ?? true)

  const [pending, startTransition]            = useTransition()
  const [error, setError]                     = useState<string | null>(null)

  function addPattern() {
    const trimmed = patternInput.trim()
    if (!trimmed) return
    if (patterns.includes(trimmed)) {
      setPatternInput("")
      return
    }
    setPatterns([...patterns, trimmed])
    setPatternInput("")
  }

  function removePattern(p: string) {
    setPatterns(patterns.filter((x) => x !== p))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addPattern()
    } else if (e.key === "Backspace" && !patternInput && patterns.length > 0) {
      setPatterns(patterns.slice(0, -1))
    }
  }

  function insertVariable(token: string) {
    const el = textareaRef.current
    if (!el) { setResponseText((m) => m + token); return }
    const start = el.selectionStart ?? responseText.length
    const end   = el.selectionEnd   ?? responseText.length
    const next  = responseText.slice(0, start) + token + responseText.slice(end)
    setResponseText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + token.length
    })
  }

  function handleSave() {
    setError(null)

    // Garante último pattern digitado (sem precisar de Enter)
    const finalPatterns = patternInput.trim()
      ? Array.from(new Set([...patterns, patternInput.trim()]))
      : patterns

    const payload = {
      name,
      patterns:            finalPatterns,
      match_type:          matchType,
      case_sensitive:      caseSensitive,
      response_text:       responseText,
      apply_tag_id:        applyTagId || null,
      cooldown_min:        cooldownMin,
      enabled,
      pause_when_assigned: pauseWhenAssigned,
    }

    startTransition(async () => {
      const result = trigger
        ? await updateKeywordTrigger(trigger.id, payload)
        : await createKeywordTrigger(payload)

      if ("error" in result && result.error) {
        setError(result.error)
        return
      }

      onFeedback("ok", trigger ? "Gatilho atualizado" : "Gatilho criado")
      onClose()
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={trigger ? "Editar gatilho" : "Novo gatilho"}
      description={trigger ? trigger.name : "Configure como o bot deve reagir a palavras específicas"}
      width="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            {trigger ? "Salvar" : "Criar gatilho"}
          </button>
        </>
      }
    >
      <div className="space-y-5">

        <FormRow label="Nome do gatilho" required hint="Só pra você se organizar — o contato não vê.">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Pergunta sobre preço"
            maxLength={80}
            autoFocus
            className={inputCls}
          />
        </FormRow>

        <FormRow
          label="Palavras-chave"
          required
          hint="Aperte Enter ou vírgula pra adicionar. Cada palavra é avaliada separadamente — se uma bater, o gatilho dispara."
        >
          <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-slate-200 bg-slate-50 min-h-[40px] focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40">
            {patterns.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 text-xs font-mono bg-white border border-slate-200 px-2 py-0.5 rounded"
              >
                {p}
                <button
                  type="button"
                  onClick={() => removePattern(p)}
                  className="text-slate-400 hover:text-danger"
                  aria-label={`Remover ${p}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={patternInput}
              onChange={(e) => setPatternInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={addPattern}
              placeholder={patterns.length === 0 ? "preço, valor, quanto custa…" : ""}
              className="flex-1 min-w-[120px] bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
            />
          </div>
        </FormRow>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormRow label="Tipo de match">
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as MatchType)}
              className={inputCls}
            >
              <option value="contains">Contém — a mensagem contém a palavra</option>
              <option value="exact">Idêntica — mensagem é exatamente a palavra</option>
              <option value="starts_with">Começa com — a mensagem começa com a palavra</option>
            </select>
          </FormRow>

          <FormRow label="Cooldown" hint="Mínimo de minutos entre disparos pro mesmo contato">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={1440}
                value={cooldownMin}
                onChange={(e) => setCooldownMin(Number(e.target.value))}
                className="w-24 h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-xs text-slate-500">minutos (0 = sem limite)</span>
            </div>
          </FormRow>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            className="size-4 rounded border-slate-300 text-primary focus:ring-primary/30"
          />
          <span className="text-xs text-slate-700">Distinguir maiúsculas/minúsculas</span>
        </label>

        {/* ── Ação 1: Responder ─────────────────────────────────── */}
        <div className="pt-4 border-t border-slate-100">
          <FormRow
            label="Resposta automática"
            hint="Deixe vazio se quiser só aplicar uma tag sem responder."
          >
            <textarea
              ref={textareaRef}
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows={4}
              placeholder="Olá {primeiro_nome}! Nossa tabela de preços…"
              className={textareaCls}
            />
          </FormRow>
          <div className="flex flex-wrap gap-1 mt-2">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1 self-center">
              Inserir variável:
            </span>
            {SUPPORTED_VARIABLES.map((v) => (
              <button
                key={v.token}
                type="button"
                onClick={() => insertVariable(v.token)}
                title={`${v.description} (ex: ${v.example})`}
                className="text-[10px] font-mono text-primary-700 bg-primary-50 hover:bg-primary-100 px-1.5 py-0.5 rounded transition-colors"
              >
                {v.token}
              </button>
            ))}
          </div>
        </div>

        {/* ── Ação 2: Aplicar tag ──────────────────────────────── */}
        <FormRow
          label="Aplicar tag no contato"
          hint="Útil pra segmentar quem perguntou sobre cada assunto."
        >
          <select
            value={applyTagId}
            onChange={(e) => setApplyTagId(e.target.value)}
            className={inputCls}
          >
            <option value="">— Não aplicar tag —</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {tags.length === 0 && (
            <p className="text-[11px] text-slate-400 mt-1">
              Nenhuma tag criada. Vá em <strong>Configurações → Tags</strong> pra criar.
            </p>
          )}
        </FormRow>

        {/* ── Comportamento ────────────────────────────────────── */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Comportamento</h3>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30"
            />
            <div>
              <p className="text-sm font-medium text-slate-700">Gatilho ativo</p>
              <p className="text-[11px] text-slate-400">Quando desligado, este gatilho não dispara.</p>
            </div>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={pauseWhenAssigned}
              onChange={(e) => setPauseWhenAssigned(e.target.checked)}
              className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30"
            />
            <div>
              <p className="text-sm font-medium text-slate-700">Pausar quando um atendente assumiu</p>
              <p className="text-[11px] text-slate-400">Se a conversa já tem agente atribuído, o gatilho não dispara — evita interrupção.</p>
            </div>
          </label>
        </div>

        {error && (
          <p className="text-xs text-danger bg-danger-bg border border-red-100 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  )
}

