"use client"

import { Fragment, useState, type Ref } from "react"

// Código de verificação de 6 dígitos (login e cadastro) — UMA peça para as duas telas.
// Por baixo é UM campo só, transparente, por cima das 6 caixas desenhadas. É o que faz
// funcionar: sugestão automática do iPhone/Android (`one-time-code`), colar o código inteiro
// (inclusive "123 456" ou "123-456") e leitor de tela lendo um campo, não seis.
// `onComplete` dispara quando o 6º dígito chega (digitado, colado ou sugerido) — a tela decide
// o que fazer (login e cadastro confirmam na hora).

const LENGTH = 6

const TONES = {
  primary: { active: "border-primary ring-2 ring-primary/20", caret: "bg-primary" },
  // Auth público (login/convite) usa o índigo da área pública — mesma cor dos campos ao lado.
  indigo: { active: "border-indigo-500 ring-2 ring-indigo-500/20", caret: "bg-indigo-600" },
} as const

export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid = false,
  busy = false,
  tone = "primary",
  id = "code",
  inputRef,
  describedBy,
  autoFocus = true,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  /** Código recusado: caixas em vermelho até a próxima digitação. */
  invalid?: boolean
  /** Conferindo: trava a digitação SEM tirar o foco (erro devolve o cursor no lugar). */
  busy?: boolean
  tone?: keyof typeof TONES
  id?: string
  inputRef?: Ref<HTMLInputElement>
  describedBy?: string
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const t = TONES[tone]
  const activeIndex = Math.min(value.length, LENGTH - 1)

  function accept(raw: string) {
    const next = raw.replace(/\D/g, "").slice(0, LENGTH)
    if (next === value) return
    onChange(next)
    if (next.length === LENGTH) onComplete?.(next)
  }

  // Cursor sempre no fim: as caixas mostram posição por índice, então editar no meio confundiria.
  function keepCaretAtEnd(el: HTMLInputElement) {
    const end = el.value.length
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end)
  }

  return (
    <div className="relative mx-auto w-full max-w-[21.5rem]">
      <div className="flex items-center gap-1.5 sm:gap-2" aria-hidden>
        {Array.from({ length: LENGTH }, (_, i) => {
          const digit = value[i]
          const active = focused && !busy && i === activeIndex
          const state = invalid
            ? "border-red-300 bg-red-50 text-red-700"
            : active ? `${t.active} bg-white text-slate-900`
            : digit ? "border-slate-300 bg-white text-slate-900"
            : "border-slate-200 bg-white text-slate-900"
          return (
            <Fragment key={i}>
              {/* Dois grupos de 3: mais fácil de ler e de conferir com o e-mail. */}
              {i === LENGTH / 2 && <span className="w-1 shrink-0 sm:w-1.5" />}
              <div className={`flex aspect-square min-w-0 flex-1 items-center justify-center rounded-lg border text-lg font-bold tabular-nums transition-[border-color,box-shadow,background-color] sm:text-xl ${state} ${busy ? "opacity-60" : ""}`}>
                {digit ?? (active && value.length < LENGTH ? <span className={`kora-caret h-5 w-px ${t.caret}`} /> : null)}
              </div>
            </Fragment>
          )
        })}
      </div>
      <input
        ref={inputRef}
        id={id}
        name="code"
        value={value}
        onChange={(e) => accept(e.target.value)}
        onFocus={(e) => { setFocused(true); keepCaretAtEnd(e.currentTarget) }}
        onBlur={() => setFocused(false)}
        onSelect={(e) => keepCaretAtEnd(e.currentTarget)}
        readOnly={busy}
        autoFocus={autoFocus}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // Gerenciadores de senha não desenham ícone por cima das caixas.
        data-1p-ignore=""
        data-lpignore="true"
        data-form-type="other"
        // 16px: abaixo disso o iPhone dá zoom ao focar. Texto e cursor transparentes — quem aparece são as caixas.
        className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent text-[16px] text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </div>
  )
}
