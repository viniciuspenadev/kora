"use client"

import { useCallback, useEffect, useRef } from "react"

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""

/**
 * Widget Cloudflare Turnstile (render explícito) — compartilhado entre /signup
 * e o captcha escalonado do login (device trust F3b). O CSP do proxy precisa
 * liberar challenges.cloudflare.com na rota que o renderiza.
 */
export function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  /**
   * 🔴 CALLBACK ESTÁVEL DE VERDADE — via "latest ref".
   *
   *    Era `useCallback(onToken, [onToken])`: tautologia que devolve a própria função e
   *    **não estabiliza nada**. Hoje passa despercebido porque os dois consumidores
   *    (/signup e o captcha escalonado do login) passam setter de `useState`, que o React
   *    garante estável.
   *
   *    A armadilha aparece no dia em que alguém passar uma arrow inline: o efeito volta a
   *    rodar a cada render do pai, mas o guard `dataset.rendered` impede re-renderizar o
   *    widget — então o Turnstile fica chamando PARA SEMPRE o primeiro callback capturado.
   *    Token engolido por closure obsoleta, em caminho de autenticação, sem nenhum sinal.
   *
   *    Com o ref, `cb` é criado uma vez (deps `[]`) e sempre despacha pro `onToken` atual.
   */
  const onTokenRef = useRef(onToken)
  useEffect(() => { onTokenRef.current = onToken })
  const cb = useCallback((t: string) => onTokenRef.current(t), [])
  useEffect(() => {
    const SCRIPT_ID = "cf-turnstile"
    function render() {
      const w = (window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => void } }).turnstile
      const el = ref.current
      if (w && el && !el.dataset.rendered) {
        el.dataset.rendered = "1"
        w.render(el, { sitekey: TURNSTILE_SITE_KEY, callback: cb, "error-callback": () => cb(""), "expired-callback": () => cb("") })
      }
    }
    if (!document.getElementById(SCRIPT_ID)) {
      const s = document.createElement("script")
      s.id = SCRIPT_ID
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      s.async = true; s.defer = true; s.onload = render
      document.head.appendChild(s)
    } else { render() }
  }, [cb])
  return <div ref={ref} className="flex justify-center min-h-[65px] items-center" />
}
