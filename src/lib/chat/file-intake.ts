/** Read real files only; pasted HTML, remote image URLs and text stay ordinary text. */
export function transferredFiles(data: Pick<DataTransfer, "files" | "items">): File[] {
  if (data.files.length) return Array.from(data.files)
  return Array.from(data.items).filter(item => item.kind === "file")
    .map(item => item.getAsFile()).filter((file): file is File => file !== null)
}

/** O arrasto/colagem traz ARQUIVO (e não texto, link ou um cartão do próprio Kora)? */
export const carriesFiles = (data: Pick<DataTransfer, "types"> | null | undefined): boolean =>
  !!data && Array.from(data.types).includes("Files")

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
