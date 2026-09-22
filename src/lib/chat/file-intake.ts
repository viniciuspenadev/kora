import { validateMediaFile } from "./media-validation"

/** Read real files only; pasted HTML, remote image URLs and text stay ordinary text. */
export function transferredFiles(data: Pick<DataTransfer, "files" | "items">): File[] {
  if (data.files.length) return Array.from(data.files)
  return Array.from(data.items).filter(item => item.kind === "file")
    .map(item => item.getAsFile()).filter((file): file is File => file !== null)
}

export function attachmentBlockReason(state: {
  disabled?: boolean; windowClosed?: boolean; windowNoReopen?: boolean
  unavailableReason?: string; isPrivate?: boolean; isRecording?: boolean
}): string | null {
  if (state.disabled) return "Reabra o atendimento para anexar arquivos."
  if (state.windowClosed || state.windowNoReopen) return "A janela de atendimento está fechada. Não é possível anexar arquivos agora."
  if (state.unavailableReason) return state.unavailableReason
  if (state.isPrivate) return "Anexos são enviados ao cliente. Saia do chat interno antes de anexar."
  if (state.isRecording) return "Conclua ou cancele a gravação antes de anexar."
  return null
}

export function prepareAttachment(files: File[], blocked: string | null, hasAttachment: boolean): { file: File; error?: never } | { file?: never; error: string } {
  if (blocked) return { error: blocked }
  if (files.length !== 1) return { error: "Adicione um arquivo por vez. Nenhum novo arquivo foi anexado." }
  if (hasAttachment) return { error: "Já existe um anexo em preparação. Remova-o antes de adicionar outro." }
  const validation = validateMediaFile(files[0])
  if (!validation.ok) return { error: validation.error ?? "Arquivo inválido." }
  return { file: files[0] }
}
