"use client"

import { useState, useCallback } from "react"
import { DangerConfirm } from "./danger-confirm"

export interface ConfirmOptions {
  title:         string
  body?:         React.ReactNode
  confirmLabel?: string
  cancelLabel?:  string
  /** `danger` (vermelho, padrão — exclusões) ou `primary` (azul — confirmações neutras). */
  tone?:         "danger" | "primary"
}

/**
 * Confirmação padrão do design system (substitui o `confirm()` nativo do browser).
 * Renderiza o MESMO `DangerConfirm` usado de forma declarativa em todo o app —
 * uma única fonte visual: mudou o danger-confirm.tsx, muda em todo lugar.
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   async function handleDelete() {
 *     if (!(await confirm({ title: "Excluir?", body: "...", confirmLabel: "Excluir" }))) return
 *     // ... ação
 *   }
 *   return (<>{...} {confirmDialog}</>)
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [resolver, setResolver] = useState<{ resolve: (v: boolean) => void } | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => setResolver({ resolve }))
  }, [])

  const settle = useCallback((v: boolean) => {
    resolver?.resolve(v)
    setOpts(null)
    setResolver(null)
  }, [resolver])

  const confirmDialog = (
    <DangerConfirm
      open={!!opts}
      title={opts?.title ?? ""}
      body={opts?.body ?? null}
      tone={opts?.tone}
      confirmLabel={opts?.confirmLabel}
      cancelLabel={opts?.cancelLabel}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}
