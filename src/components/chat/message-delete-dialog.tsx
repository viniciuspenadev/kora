"use client"

import { useRef, useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { deleteSentMessage, getMessageDeleteStatus } from "@/lib/actions/chat-message-deletions"
import type { ChatMessage } from "@/types/chat"

export function MessageDeleteDialog({ message, onClose, onDeleted }: {
  message: ChatMessage; onClose: () => void
  onDeleted: (patch: Pick<ChatMessage, "id" | "content" | "content_type" | "deleted_at">) => void
}) {
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const operation = useRef<string | null>(null)
  async function submit() {
    if (running.current) return
    running.current = true; setBusy(true); setError(null)
    operation.current ??= crypto.randomUUID()
    try {
      const result = uncertain ? await getMessageDeleteStatus(message.id, operation.current)
        : await deleteSentMessage({ messageId: message.id, operationId: operation.current,
          previousContent: message.content, previousEditedAt: message.edited_at })
      if ("message" in result) { onDeleted(result.message); onClose(); return }
      setError(result.error); setUncertain(!!result.uncertain)
      if (result.operationId) operation.current = result.operationId
      if (!result.uncertain) operation.current = null
    } catch {
      setUncertain(true); setError("A conexão foi interrompida. Verifique a confirmação antes de tentar novamente.")
    } finally { running.current = false; setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !running.current) onClose() }}>
    <DialogContent showCloseButton={false}>
      <div className="flex size-10 items-center justify-center rounded-xl bg-red-50 text-red-600"><Trash2 className="size-5" /></div>
      <DialogTitle>Apagar mensagem para todos?</DialogTitle>
      <DialogDescription>A mensagem será apagada nesta conversa e no WhatsApp do cliente. Ele pode já ter visto ou salvo o conteúdo. Esta ação não pode ser desfeita.</DialogDescription>
      <div className="max-h-28 overflow-auto break-words rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {message.content || "Mensagem com anexo"}
      </div>
      {error && <p role="alert" className="text-sm text-amber-700">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{uncertain ? "Fechar" : "Cancelar"}</Button>
        <Button variant={uncertain ? "default" : "destructive"} disabled={busy} onClick={submit}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {uncertain ? "Verificar confirmação" : busy ? "Apagando…" : "Apagar para todos"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
