"use client"

import { useState, useTransition } from "react"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { updateAIConfig } from "@/lib/actions/ai/config"
import type { AIConfig, AITone } from "@/types/ai"

interface Props {
  config: AIConfig | null
}

const INPUT_CLASS =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
const TEXTAREA_CLASS =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y"

const TONES: { value: AITone; label: string }[] = [
  { value: "amigavel", label: "Amigável" },
  { value: "casual",   label: "Casual" },
  { value: "formal",   label: "Formal" },
  { value: "tecnico",  label: "Técnico" },
]

export function PersonaClient({ config }: Props) {
  const [name, setName]       = useState(config?.ai_name ?? "")
  const [tone, setTone]       = useState<AITone>((config?.ai_tone as AITone) ?? "amigavel")
  const [language, setLang]   = useState(config?.ai_language ?? "pt-BR")
  const [identity, setIdent]  = useState(config?.identity_text ?? "")
  const [style, setStyle]     = useState(config?.communication_style_text ?? "")
  const [anti, setAnti]       = useState(config?.anti_patterns_text ?? "")

  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback]    = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function handleSave() {
    setFeedback(null)
    startTransition(async () => {
      const result = await updateAIConfig({
        ai_enabled:               config?.ai_enabled ?? false,
        ai_name:                  name,
        ai_tone:                  tone,
        ai_language:              language,
        identity_text:            identity,
        communication_style_text: style,
        anti_patterns_text:       anti,
      })
      if (result?.error) setFeedback({ kind: "error", text: result.error })
      else setFeedback({ kind: "ok", text: "Persona salva" })
    })
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <SectionCard title="Identidade" description="Como ela se apresenta nas conversas">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormRow label="Nome" hint="Aparece quando ela se apresenta">
              <input
                className={INPUT_CLASS}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Amanda"
              />
            </FormRow>
            <FormRow label="Tom de voz">
              <select className={INPUT_CLASS} value={tone} onChange={(e) => setTone(e.target.value as AITone)}>
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </FormRow>
          </div>

          <FormRow label="Quem ela é" hint="1-2 frases sobre o papel dela e o negócio que representa">
            <textarea
              className={TEXTAREA_CLASS}
              rows={3}
              value={identity}
              onChange={(e) => setIdent(e.target.value)}
              placeholder="Ex: Você é a Amanda, atendente da Clínica Vida. Recebe pacientes no WhatsApp com acolhimento e agiliza o atendimento."
            />
          </FormRow>
        </div>
      </SectionCard>

      <SectionCard title="Estilo de comunicação" description="Como ela escreve">
        <div className="space-y-4">
          <FormRow label="Como ela fala" hint="Regras de estilo: tamanho de mensagem, uso de emoji, formalidade…">
            <textarea
              className={TEXTAREA_CLASS}
              rows={4}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="Ex: Mensagens curtas e diretas. Chama pelo primeiro nome. Evita textão. Usa no máximo 1 emoji."
            />
          </FormRow>

          <FormRow label="O que ela NÃO deve fazer" hint="Anti-padrões: o que evitar a todo custo">
            <textarea
              className={TEXTAREA_CLASS}
              rows={4}
              value={anti}
              onChange={(e) => setAnti(e.target.value)}
              placeholder="Ex: Nunca promete prazos. Não inventa preços. Não se reapresenta a cada mensagem. Não usa clichês de robô ('Como posso ajudar?')."
            />
          </FormRow>
        </div>
      </SectionCard>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Salvar persona
        </button>
        {feedback && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${feedback.kind === "ok" ? "text-success" : "text-danger"}`}>
            {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {feedback.text}
          </span>
        )}
      </div>
    </div>
  )
}
