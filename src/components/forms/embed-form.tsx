"use client"

// O formulário DENTRO do site do cliente (/embed/<public_id>, aberto pelo carregador f.js).
// Só o cartão do formulário, sem fundo e sem a moldura da página do link próprio. Conversa
// com o site por `postMessage`, SÓ para a página conferida no servidor (nunca "*"): a altura
// (o site ajusta a moldura, sem barra de rolagem) e "pedido enviado" (o site pode contar a
// conversão). Regras e nomes das mensagens: lib/forms/embed.ts.

import { useEffect, useRef } from "react"
import { PublicForm, PublicFormUnavailable } from "./public-form"
import { EMBED_MESSAGE, type EmbedMessage } from "@/lib/forms/embed"
import type { FormDefinition } from "@/lib/forms/definition"

type Props = {
  /** Página do site (conferida contra os sites autorizados). null = não fala com o site. */
  hostOrigin: string | null
  hostPage:   string | null
} & (
  | { state: "ok"; publicId: string; definition: FormDefinition; businessName: string; renderToken: string }
  | { state: "unavailable"; businessName: string }
)

export function EmbedForm(props: Props) {
  const box = useRef<HTMLDivElement>(null)
  const { hostOrigin } = props

  function post(msg: Omit<EmbedMessage, "kora">) {
    if (!hostOrigin || window.parent === window) return
    window.parent.postMessage({ kora: EMBED_MESSAGE, ...msg }, hostOrigin)
  }

  // A altura acompanha cada passo (pergunta, contato, tela final, mensagem de erro).
  useEffect(() => {
    const el = box.current
    if (!el || !hostOrigin || window.parent === window) return
    let last = 0
    const report = () => {
      const h = Math.ceil(el.getBoundingClientRect().height)
      if (h && h !== last) { last = h; window.parent.postMessage({ kora: EMBED_MESSAGE, type: "height", height: h }, hostOrigin) }
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hostOrigin])

  return (
    <div ref={box} className="w-full">
      {/* A página do site aparece por trás do cartão. */}
      <style>{"html,body{background:transparent!important;min-height:0!important}"}</style>
      {props.state === "ok"
        ? <PublicForm publicId={props.publicId} definition={props.definition} businessName={props.businessName}
            renderToken={props.renderToken} kind="embed" hostPage={props.hostPage} onSent={() => post({ type: "submitted" })} />
        : <PublicFormUnavailable businessName={props.businessName} />}
    </div>
  )
}
