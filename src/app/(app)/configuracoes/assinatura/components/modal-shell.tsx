"use client"

import { useEffect } from "react"
import { X } from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ═══════════════════════════════════════════════════════════════
// ModalShell — casca única dos modais de assinatura
// ═══════════════════════════════════════════════════════════════
// DECISÃO: mesma anatomia dos modais da ficha do negócio (header com ícone +
// título + subtítulo, corpo, rodapé slate-50 com as ações à direita). Modal de
// cobrança que parece diferente do resto do produto lê como pop-up de terceiro
// — exatamente a desconfiança que não se pode ter na hora de pagar.
//
// ⚠️ O CHECKOUT DE CARTÃO MORA AQUI TAMBÉM (07/08). Ele pediu quatro coisas que os outros
//    modais não precisavam — herói no cabeçalho, rodapé de CTA, tela cheia no celular e a
//    possibilidade de TRANCAR a saída. Cada uma virou um `prop` opcional com o padrão
//    igual ao de hoje, em vez de uma segunda casca: duas cascas de modal de cobrança
//    envelheceriam em direções diferentes, e a de dinheiro é a que não pode divergir.

export function ModalShell({
  title, desc, icon: Icon, accent = "bg-primary-50 text-primary-600",
  onClose, footer, children, size = "md",
  dismissable = true, closeButton = false,
  footerVariant = "actions", mobileFullscreen = false, flush = false,
}: {
  title:    string
  desc?:    string
  icon:     LucideIcon
  /** Classes do quadradinho do ícone — carrega o tom do assunto. */
  accent?:  string
  onClose:  () => void
  footer?:  React.ReactNode
  children: React.ReactNode
  /** `checkout` é mais largo que `md` (validade+CVV lado a lado) e mais estreito que uma tela. */
  size?:    "md" | "lg" | "checkout"
  /**
   * `false` tranca ESC, clique-fora e o X.
   *
   * 🔴 Existe pro instante em que o cartão está sendo validado no banco. Fechar no meio da
   *    tokenização deixa a pessoa sem saber se foi cobrada — e o palpite dela vai ser
   *    "não foi", o que produz uma segunda tentativa em cima de um pagamento que passou.
   */
  dismissable?: boolean
  /** X no canto. Fica opt-in pra não mudar os modais que já resolvem a saída no rodapé. */
  closeButton?: boolean
  // ⚠️ `headerRight` e `onBack` FORAM REMOVIDOS antes de nascerem (revisão 07/08). Eu os
  //    criei pro herói do checkout e pra navegação em passos, e nenhum dos dois chegou a
  //    ter consumidor: o herói precisa ROLAR junto do formulário (então mora dentro dele) e
  //    o modal de cartão não tem passos. Prop sem consumidor é contrato mentindo — quem lê
  //    acha que tem duas variantes pra manter, e uma delas envelhece sem ninguém notar.
  /** `cta` = rodapé branco com o botão ocupando a largura toda (fecho do documento). */
  footerVariant?: "actions" | "cta"
  /** Tela cheia abaixo de `sm`. Formulário longo em modal flutuante no celular é armadilha. */
  mobileFullscreen?: boolean
  /** Corpo sem padding — quem manda no respiro é o filho. */
  flush?: boolean
}) {
  // Esc fecha — no document, não no wrapper: o foco pode estar num input interno.
  useEffect(() => {
    if (!dismissable) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, dismissable])

  const largura =
    size === "checkout" ? "max-w-[34rem]" :
    size === "lg"       ? "max-w-lg"      : "max-w-md"

  const caixa = mobileFullscreen
    ? `w-full h-[100dvh] rounded-none sm:h-auto sm:max-h-[90dvh] sm:rounded-xl ${largura}`
    : `w-full max-h-[90dvh] rounded-xl ${largura}`

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm ${mobileFullscreen ? "p-0 sm:p-4" : "p-4"}`}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        className={`bg-white shadow-xl overflow-hidden flex flex-col ${caixa}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 shrink-0">
          <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${accent}`}>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {desc && <p className="text-[11px] text-slate-400 truncate">{desc}</p>}
          </div>
          {closeButton && dismissable && (
            <button type="button" onClick={onClose} aria-label="Fechar"
              className="ml-auto size-7 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 inline-flex items-center justify-center transition-colors">
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto ${flush ? "" : "p-5"}`}>{children}</div>

        {footer && (
          footerVariant === "cta"
            // ⚠️ Rodapé BRANCO e sem `justify-end`: aqui ele é o fecho do documento (um CTA
            //    de largura cheia), não uma barra de ferramentas com ações secundárias.
            //    `env(safe-area-inset-bottom)` é o que impede o botão de morar embaixo da
            //    barra de gestos do iPhone quando o modal está em tela cheia.
            ? <div className="px-5 py-3.5 sm:py-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-white shrink-0">
                {footer}
              </div>
            : <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 shrink-0">
                {footer}
              </div>
        )}
      </div>
    </div>
  )
}

/** Botões dos modais — mesma régua do resto do app (h-9, text-xs, semibold). */
export const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
export const BTN_WHITE   = "inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors disabled:opacity-50"
export const BTN_GHOST   = "inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
