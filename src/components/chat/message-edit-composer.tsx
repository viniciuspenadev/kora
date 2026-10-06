"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Pencil } from "lucide-react"
import { editSentMessage, getMessageEditStatus } from "@/lib/actions/chat-message-edits"
import { editTextProblem, MESSAGE_EDIT_MAX_LENGTH } from "@/lib/chat/message-edit"
import type { ChatMessage } from "@/types/chat"
import { signatureBody, signatureStamp } from "@/lib/atendimento/agent-signature"

export function MessageEditComposer({ message, blockedReason, onCancel, onSaved }: {
  message: ChatMessage
  blockedReason?: string | null
  onCancel: () => void
  onSaved: (patch: Pick<ChatMessage, "id" | "content" | "edited_at">) => void
}) {
  const originalBody = signatureBody(message.content ?? "", message.metadata)
  const stamp = signatureStamp(message.metadata)
  const [text, setText] = useState(originalBody)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const operation = useRef<string | null>(null)
  const running = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])

  async function submit() {
    if (running.current || (!uncertain && (blockedReason || editTextProblem(text, originalBody)))) return
    running.current = true; setBusy(true); setError(null)
    operation.current ??= crypto.randomUUID()
    try {
      const result = uncertain
        ? await getMessageEditStatus(message.id, operation.current)
        : await editSentMessage({ messageId: message.id, operationId: operation.current,
            previousContent: message.content ?? "", previousEditedAt: message.edited_at, text })
      if ("message" in result) { onSaved(result.message); return }
      setError(result.error); setUncertain(!!result.uncertain)
      if (result.operationId) operation.current = result.operationId
      if (!result.uncertain) operation.current = null
    } catch {
      setUncertain(true); setError("A conexão foi interrompida. Confira o status antes de tentar novamente.")
    } finally { running.current = false; setBusy(false) }
  }

  return <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4 pb-[max(12px,env(safe-area-inset-bottom))]">
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
      <Pencil className="size-3.5" /> Editando mensagem
    </div>
    {stamp && <p className="mb-2 text-xs text-slate-500">Assinatura preservada: {stamp.name}</p>}
    <textarea ref={input} aria-label="Editar mensagem" value={text} disabled={busy || uncertain}
      maxLength={MESSAGE_EDIT_MAX_LENGTH - (stamp?.prefix.length ?? 0)} rows={3}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === "Escape" && !busy) { e.preventDefault(); onCancel() } }}
      className="block min-h-20 max-h-48 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 disabled:opacity-60" />
    {(error || blockedReason) && <p role="status" className="mt-2 text-xs leading-relaxed text-amber-700">{error || blockedReason}</p>}
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={onCancel} disabled={busy}
        className="min-h-9 rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{uncertain ? "Fechar" : "Cancelar"}</button>
      <button type="button" onClick={() => void submit()}
        disabled={busy || (!uncertain && (!!blockedReason || !!editTextProblem(text, originalBody)))}
        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50">
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        {busy ? "Aguarde…" : uncertain ? "Verificar confirmação" : "Salvar alteração"}
      </button>
    </div>
  </div>
}
