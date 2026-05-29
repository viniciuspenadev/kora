"use client"

import { useState, useRef } from "react"
import { Send, Paperclip, Lock, Smile, X, Image as ImageIcon, FileText, Music, AlertCircle, Mic } from "lucide-react"
import { EmojiPicker } from "./emoji-picker"
import { VoiceRecorder } from "./voice-recorder"
import { validateMediaFile, ACCEPT_ATTR } from "@/lib/chat/media-validation"
import type { ChatQuickReply } from "@/types/chat"

interface Props {
  conversationId: string
  quickReplies:   ChatQuickReply[]
  disabled?:      boolean
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

export function MessageInput({ conversationId, quickReplies, disabled, onSendText, onSendMedia, onSendVoice }: Props) {
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

  return (
    <div className="border-t border-slate-200 bg-white relative">

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
