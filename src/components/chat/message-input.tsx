"use client"

import { useState, useRef, useEffect, useTransition } from "react"
import { Send, Paperclip, Lock, Smile, X, Image as ImageIcon, FileText, Music, AlertCircle, Mic, Loader2 } from "lucide-react"
import { EmojiPicker } from "./emoji-picker"
import { VoiceRecorder } from "./voice-recorder"
import { validateMediaFile, ACCEPT_ATTR } from "@/lib/chat/media-validation"
import { getInboxTemplates, type InboxTemplate } from "@/lib/actions/whatsapp-official"
import { sendOfficialTemplate } from "@/lib/actions/chat"
import { nameVarKey, type TemplateVar } from "@/lib/whatsapp/template-vars"
import type { ChatQuickReply } from "@/types/chat"

interface Props {
  conversationId: string
  quickReplies:   ChatQuickReply[]
  disabled?:      boolean
  /** Janela de 24h fechada (WhatsApp Oficial) → bloqueia texto livre, exige template. */
  windowClosed?:  boolean
  /** Conversa nova/oficial que nunca teve inbound (janela nunca abriu) — copy diferente. */
  windowNeverOpened?: boolean
  /** Primeiro nome do contato — pré-preenche {{1}} no picker de template. */
  contactFirstName?:  string
  /** Orquestrado em InboxClient: insere msg otimista, chama server action, faz swap do id. */
  onSendText:     (content: string, isPrivate: boolean) => Promise<void>
  onSendMedia:    (file: File, caption: string) => Promise<void>
  /** Voice note (PTT). Cliente vê como nota de voz nativa do WhatsApp. */
  onSendVoice:    (file: File) => Promise<void>
}

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon
  if (mime.startsWith("audio/")) return Music
  return FileText
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export function MessageInput({ conversationId, quickReplies, disabled, windowClosed, windowNeverOpened, contactFirstName, onSendText, onSendMedia, onSendVoice }: Props) {
  void conversationId  // mantido na API por clareza; envio é orquestrado no parent
  const [text, setText]                = useState("")
  const [isPrivate, setIsPrivate]      = useState(false)
  const [showQuickReplies, setShowQR]  = useState(false)
  const [filteredReplies, setFiltered] = useState<ChatQuickReply[]>([])
  const [showEmoji, setShowEmoji]      = useState(false)
  const [attachedFile, setFile]        = useState<File | null>(null)
  const [filePreview, setFilePreview]  = useState<string | null>(null)
  const [sendError, setSendError]      = useState<string | null>(null)
  const [isRecording, setIsRecording]  = useState(false)
  // Sem useTransition / isPending: envio é optimistic — UI libera na hora.
  // Erros voltam via callback (onSendText/onSendMedia rejeitam).
  const inputRef                       = useRef<HTMLTextAreaElement>(null)
  const fileInputRef                   = useRef<HTMLInputElement>(null)

  function handleInput(value: string) {
    setText(value)
    if (value.startsWith("/") && value.length > 1) {
      const search = value.toLowerCase()
      const matches = quickReplies.filter(
        (qr) => qr.shortcut.toLowerCase().includes(search) || qr.title.toLowerCase().includes(search.slice(1))
      )
      setFiltered(matches)
      setShowQR(matches.length > 0)
    } else {
      setShowQR(false)
    }
  }

  function selectQuickReply(qr: ChatQuickReply) {
    setText(qr.content)
    setShowQR(false)
    inputRef.current?.focus()
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    setSendError(null)
    const f = e.target.files?.[0]
    if (!f) return

    const result = validateMediaFile(f)
    if (!result.ok) {
      setSendError(result.error ?? "Arquivo inválido.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }

    setFile(f)
    if (f.type.startsWith("image/")) {
      const reader = new FileReader()
      reader.onload = () => setFilePreview(reader.result as string)
      reader.readAsDataURL(f)
    } else {
      setFilePreview(null)
    }
  }

  function clearFile() {
    setFile(null)
    setFilePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function insertEmoji(emoji: string) {
    const el = inputRef.current
    if (!el) {
      setText((t) => t + emoji)
      return
    }
    const start = el.selectionStart ?? text.length
    const end   = el.selectionEnd ?? text.length
    const newText = text.slice(0, start) + emoji + text.slice(end)
    setText(newText)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + emoji.length
    })
  }

  function handleSubmit() {
    setSendError(null)

    if (attachedFile) {
      // Re-valida no momento do envio (caso o arquivo tenha mudado).
      const result = validateMediaFile(attachedFile)
      if (!result.ok) {
        setSendError(result.error ?? "Arquivo inválido.")
        return
      }

      const fileToSend = attachedFile
      const captionToSend = text.trim()
      // Limpa UI na hora — msg otimista já aparece no chat.
      clearFile()
      setText("")
      onSendMedia(fileToSend, captionToSend).catch((err) => {
        const msg = (err as Error).message ?? "Erro ao enviar mídia"
        setSendError(
          msg === "Failed to fetch"
            ? "Falha de rede ou arquivo grande demais. Tente novamente ou use arquivo menor."
            : msg
        )
      })
      return
    }

    const trimmed = text.trim()
    if (!trimmed) return

    const privateNow = isPrivate
    setText("")
    setIsPrivate(false)
    onSendText(trimmed, privateNow).catch((err) => {
      setSendError((err as Error).message ?? "Erro ao enviar")
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleVoiceSend(blob: Blob, mimeType: string) {
    // Extensão correta pro browser + provider entenderem
    const ext = mimeType.includes("ogg") ? "ogg"
              : mimeType.includes("mp4") ? "m4a"
              : "webm"
    const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType })
    try {
      await onSendVoice(file)
      setIsRecording(false)
    } catch (err) {
      setSendError((err as Error).message ?? "Erro ao enviar áudio")
      // Mantém o recorder aberto pro usuário tentar de novo
      throw err
    }
  }

  const hasContent = !!attachedFile || text.trim().length > 0

  // Janela de 24h fechada (Oficial): só template aprovado reabre a conversa.
  if (windowClosed) {
    return <ClosedWindowComposer conversationId={conversationId} neverOpened={windowNeverOpened ?? false} contactFirstName={contactFirstName ?? ""} />
  }

  return (
    <div className="border-t border-slate-200 bg-white relative pb-[env(safe-area-inset-bottom)]">

      {showQuickReplies && (
        <div className="border-b border-slate-100 max-h-40 overflow-y-auto">
          {filteredReplies.map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => selectQuickReply(qr)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 text-left transition-colors"
            >
              <span className="text-xs font-mono font-medium text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
                {qr.shortcut}
              </span>
              <span className="text-sm text-slate-700 truncate">{qr.title}</span>
            </button>
          ))}
        </div>
      )}

      {isPrivate && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-100">
          <Lock className="size-3 text-amber-600" />
          <span className="text-xs font-medium text-amber-700">
            Nota privada — não será enviada ao cliente
          </span>
        </div>
      )}

      {sendError && (
        <div className="flex items-start gap-2 px-4 py-2 bg-danger-bg border-b border-red-100">
          <AlertCircle className="size-3.5 text-danger shrink-0 mt-0.5" />
          <span className="text-xs text-red-700 flex-1">{sendError}</span>
          <button
            type="button"
            onClick={() => setSendError(null)}
            aria-label="Fechar aviso"
            className="size-5 inline-flex items-center justify-center rounded text-red-500 hover:bg-red-100"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {attachedFile && (
        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200">
            {filePreview ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={filePreview} alt="" className="size-12 rounded object-cover" />
            ) : (
              <div className="size-12 rounded bg-primary-50 flex items-center justify-center text-primary-600">
                {(() => {
                  const Icon = fileIcon(attachedFile.type)
                  return <Icon className="size-5" />
                })()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{attachedFile.name}</p>
              <p className="text-[11px] text-slate-400">{formatBytes(attachedFile.size)}</p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="size-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {showEmoji && (
        <div className="absolute bottom-full mb-2 left-3 z-30">
          <EmojiPicker
            onSelect={insertEmoji}
            onClose={() => setShowEmoji(false)}
          />
        </div>
      )}

      {isRecording ? (
        <VoiceRecorder
          onSend={handleVoiceSend}
          onCancel={() => setIsRecording(false)}
        />
      ) : (
        <div className="flex items-center gap-2 p-3">
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsPrivate(!isPrivate)}
              disabled={!!attachedFile}
              title={attachedFile ? "Mídia sempre vai ao cliente" : (isPrivate ? "Voltar para mensagem normal" : "Nota privada")}
              className={`size-10 flex items-center justify-center rounded-lg transition-colors ${
                isPrivate
                  ? "bg-amber-100 text-amber-700"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              } disabled:opacity-30 disabled:cursor-not-allowed`}
            >
              <Lock className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPrivate}
              title="Anexar arquivo"
              className="size-10 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              onChange={handleFileSelected}
              className="sr-only"
            />

            <button
              type="button"
              onClick={() => setShowEmoji((v) => !v)}
              title="Emoji"
              className={`size-10 flex items-center justify-center rounded-lg transition-colors ${
                showEmoji ? "bg-slate-100 text-slate-700" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Smile className="size-4" />
            </button>
          </div>

          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                attachedFile ? "Legenda (opcional)..." :
                isPrivate ? "Escreva uma nota interna..." :
                "Digite uma mensagem... (/ para atalhos)"
              }
              disabled={disabled}
              rows={1}
              className={`w-full resize-none rounded-xl border px-4 py-2 text-sm leading-6 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all max-h-32 ${
                isPrivate
                  ? "border-amber-200 bg-amber-50/50 focus:ring-amber-300"
                  : "border-slate-200 bg-slate-50 focus:ring-primary/40"
              } disabled:opacity-50`}
              style={{ minHeight: "40px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = "auto"
                target.style.height = `${Math.min(target.scrollHeight, 128)}px`
              }}
            />
          </div>

          {hasContent ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={disabled}
              className={`size-10 flex items-center justify-center rounded-xl shrink-0 transition-all ${
                isPrivate
                  ? "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                  : "bg-primary hover:bg-primary-700 text-white shadow-sm shadow-primary/30"
              } disabled:opacity-50`}
            >
              <Send className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setSendError(null); setIsRecording(true) }}
              disabled={disabled || isPrivate}
              title={isPrivate ? "Áudio sempre vai ao cliente — desligue nota privada" : "Gravar áudio"}
              className="size-10 flex items-center justify-center rounded-xl shrink-0 bg-primary hover:bg-primary-700 text-white shadow-sm shadow-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Mic className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Composer quando a janela de 24h fechou (WhatsApp Oficial) ──────────────
// Bloqueia texto livre e força o envio de um template aprovado pra reabrir.

const TPL_INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

/** Substitui {{key}} (número ou nome) pelo valor preenchido. */
function renderTemplate(body: string, params: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => params[k]?.trim() || `{{${k}}}`)
}

function ClosedWindowComposer({ conversationId, neverOpened, contactFirstName }: { conversationId: string; neverOpened: boolean; contactFirstName: string }) {
  const [templates, setTemplates] = useState<InboxTemplate[] | null>(null)
  const [selected, setSelected]   = useState("")
  const [params, setParams]       = useState<Record<string, string>>({})
  const [error, setError]         = useState<string | null>(null)
  const [ok, setOk]               = useState(false)
  const [pending, startSend]      = useTransition()

  /** Inicializa os params: pré-preenche a variável de NOME (nomeada ou {{1}}) com o 1º nome. */
  function initParams(vars: TemplateVar[]): Record<string, string> {
    const p: Record<string, string> = {}
    for (const v of vars) p[v.key] = ""
    const nameKey = nameVarKey(vars)
    if (nameKey && contactFirstName) p[nameKey] = contactFirstName
    return p
  }

  useEffect(() => {
    let cancelled = false
    getInboxTemplates().then((t) => {
      if (cancelled) return
      setTemplates(t)
      if (t[0]) { setSelected(t[0].name); setParams(initParams(t[0].vars)) }
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tpl     = templates?.find((t) => t.name === selected) ?? null
  const nameKey = tpl ? nameVarKey(tpl.vars) : null

  function pick(name: string) {
    setSelected(name)
    const t = templates?.find((x) => x.name === name)
    setParams(initParams(t?.vars ?? []))
    setError(null); setOk(false)
  }

  function send() {
    if (!tpl) return
    if (tpl.vars.some((v) => !(params[v.key] ?? "").trim())) { setError("Preencha as variáveis do template."); return }
    setError(null); setOk(false)
    const displayText = renderTemplate(tpl.body, params)
    // Monta os params na ORDEM das variáveis; nomeadas levam parameter_name.
    const bodyParams = tpl.vars.map((v) => ({ paramName: v.named ? v.key : undefined, text: (params[v.key] ?? "").trim() }))
    startSend(async () => {
      try {
        await sendOfficialTemplate(conversationId, tpl.name, tpl.language, bodyParams, displayText)
        setOk(true)
        setParams(initParams(tpl.vars))
      } catch (e) {
        setError((e as Error).message ?? "Falha ao enviar template.")
      }
    })
  }

  return (
    <div className="border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-start gap-2 mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
        <Lock className="size-4 shrink-0 mt-0.5" />
        <span>
          {neverOpened
            ? <>Conversa nova no número oficial. Inicie com um <strong>template aprovado</strong> — o texto livre libera quando o cliente responder.</>
            : <>Janela de 24h fechada. Pra reabrir a conversa, envie um <strong>template aprovado</strong>. O texto livre volta assim que o cliente responder.</>}
        </span>
      </div>

      {templates === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 className="size-3.5 animate-spin" /> Carregando templates…</div>
      ) : templates.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">Nenhum template aprovado ainda. Crie um na área <strong>Templates</strong> pra conseguir reabrir conversas fora da janela.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Template</label>
            <select value={selected} onChange={(e) => pick(e.target.value)} className={TPL_INPUT.replace("px-3", "px-2")}>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.language})</option>)}
            </select>
          </div>

          {tpl && tpl.vars.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tpl.vars.map((v) => {
                const isName = v.key === nameKey
                return (
                  <div key={v.key}>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                      {`{{${v.key}}}`}
                      {isName && <span className="ml-1 text-slate-400 font-normal">← nome do cliente</span>}
                    </label>
                    <input
                      value={params[v.key] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [v.key]: e.target.value }))}
                      placeholder={isName ? (contactFirstName || "Primeiro nome") : (v.named ? v.key : "Valor")}
                      className={TPL_INPUT}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {tpl && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Prévia</span>
              <p className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">{renderTemplate(tpl.body, params)}</p>
            </div>
          )}

          {error && <div className="flex items-center gap-1.5 text-xs text-red-700"><AlertCircle className="size-4 shrink-0" />{error}</div>}
          {ok && <div className="flex items-center gap-1.5 text-xs text-emerald-700"><Send className="size-3.5 shrink-0" />Template enviado.</div>}

          <div className="flex justify-end">
            <button
              onClick={send}
              disabled={pending || !tpl}
              className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Enviar template
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
