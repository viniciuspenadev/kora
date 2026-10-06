// ═══════════════════════════════════════════════════════════════
// Bandeja de anexos — o que entra, o que fica de fora e o envio em ordem
// ═══════════════════════════════════════════════════════════════
// Parte SEM tela da bandeja (components/chat/attachment-tray.tsx). A decisão "este arquivo pode
// ir, e como?" não mora aqui: é `classifyAttachment` (lib/chat/attachments.ts), a mesma regra
// que o servidor repete.

import { classifyAttachment, MAX_ATTACHMENTS_PER_SEND, type AttachmentPlan } from "./attachments"

/** Opções de um envio de arquivo (bandeja → inbox). */
export interface MediaSendOptions {
  /** Conversa em que o arquivo foi preparado: se a conversa aberta for outra, não envia. */
  conversationId?: string
  /** A pessoa escolheu mandar como documento (vídeo acima do limite, por exemplo). */
  asDocument?: boolean
  /** 0 a 1 — quanto do arquivo já subiu. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** NADA foi enviado, com certeza (recusa antes do envio, conversa trocada, envio cancelado):
 *  o arquivo continua pronto na bandeja. Qualquer outro erro = resultado incerto. */
export class MediaSendBlockedError extends Error {}

export type TraySendStatus = "ready" | "sending" | "sent" | "uncertain"

export interface TrayItem {
  id: string
  /** Como chegou — "Restaurar original" volta para ele. */
  original: File
  /** O que será enviado (pode ter sido recortado/girado). */
  file: File
  caption: string
  asDocument: boolean
  status: TraySendStatus
  /** 0 a 1, enquanto `sending`. */
  progress: number
}

export const trayItemPlan = (item: Pick<TrayItem, "file" | "asDocument">): AttachmentPlan =>
  classifyAttachment(item.file, { asDocument: item.asDocument })

export interface LeftOut { name: string; reason: string }

/**
 * Separa o que entra na bandeja do que fica de fora. Aceita o que dá e NOMEIA o resto com o
 * motivo — nunca descarta em silêncio, nunca recusa o lote inteiro por causa de um arquivo.
 * Arquivo que só cabe como documento ENTRA: a bandeja oferece a troca com um clique.
 */
export function planAdditions(incoming: File[], current: number): { accepted: File[]; leftOut: LeftOut[] } {
  const accepted: File[] = []
  const leftOut: LeftOut[] = []
  for (const file of incoming) {
    const plan = classifyAttachment(file)
    if (!plan.ok && !plan.offerDocument) leftOut.push({ name: file.name || "arquivo", reason: plan.error })
    else if (current + accepted.length >= MAX_ATTACHMENTS_PER_SEND) leftOut.push({ name: file.name || "arquivo", reason: `Cabem até ${MAX_ATTACHMENTS_PER_SEND} arquivos por envio.` })
    else accepted.push(file)
  }
  return { accepted, leftOut }
}

/** Em ordem, um por vez: preserva a sequência e para no primeiro resultado que não é "enviado". */
export async function sendTrayBatch(
  items: TrayItem[],
  send: (item: TrayItem) => Promise<void>,
  blockReason: () => string | null,
  update: (id: string, status: TraySendStatus) => void,
): Promise<string | null> {
  for (const item of items) {
    if (item.status !== "ready") continue
    const blocked = blockReason()
    if (blocked) return blocked
    update(item.id, "sending")
    try { await send(item) }
    catch (error) {
      update(item.id, error instanceof MediaSendBlockedError ? "ready" : "uncertain")
      return error instanceof Error ? error.message : "Não foi possível confirmar o envio."
    }
    update(item.id, "sent")
  }
  return null
}
