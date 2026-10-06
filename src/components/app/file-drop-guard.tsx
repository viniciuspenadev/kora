"use client"

import { useEffect } from "react"
import { carriesFiles } from "@/lib/chat/file-intake"

/**
 * Arquivo solto FORA de uma área que o recebe não pode tirar a pessoa do Kora.
 *
 * Sem isto, o navegador ABRE o arquivo no lugar da página (um PDF solto dois dedos ao lado da
 * conversa troca o Kora pelo PDF — e o que estava digitado se perde).
 *
 * Só age no que ninguém tratou: quem recebe arquivo (a conversa) chama `preventDefault` no
 * próprio elemento, e o evento chega aqui já marcado. Arrasto que não é de arquivo (cartão do
 * funil, etapa) e o campo nativo de arquivo passam direto.
 */
export function FileDropGuard() {
  useEffect(() => {
    const untouched = (e: DragEvent) => !e.defaultPrevented && carriesFiles(e.dataTransfer)
      && !(e.target instanceof HTMLInputElement && e.target.type === "file")
    const over = (e: DragEvent) => { if (untouched(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "none" } }
    const drop = (e: DragEvent) => { if (untouched(e)) e.preventDefault() }
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop) }
  }, [])
  return null
}
