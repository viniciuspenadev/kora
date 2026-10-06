"use client"

// ═══════════════════════════════════════════════════════════════
// Nó Mensagem — os BALÕES (de 1 a 4 mensagens em sequência)
// ═══════════════════════════════════════════════════════════════
//
// Ideia do dono (2026-08-17), e ela SUBSTITUIU a divisão automática que eu havia proposto:
// quem decide onde o texto quebra é quem escreve, não a máquina. Ver `message-balloons.ts`
// (a leitura) e MAX_BALOES (o teto, derivado do orçamento de respiro).
//
// ⚠️ O compositor de cada balão é o MESMO `RichComposer` do direct de abertura. Um editor
//    diferente aqui faria a mesma mensagem ter duas caras dependendo de onde é escrita.

import { useState } from "react"
import { Plus, X, GripVertical, ChevronUp, ChevronDown, ChevronRight, Clock, Image as ImageIcon, MousePointerClick } from "lucide-react"
import { RichComposer } from "@/components/studio/rich-composer"
import { baloesDe, MAX_BALOES } from "@/lib/ai-v2/flow/message-balloons"
import type { RichMessage, MessageNodeConfig } from "@/lib/ai-v2/flow/types"

export function MessageBalloons({
  cfg, set, channel, vars,
}: {
  cfg:     Record<string, unknown>
  set:     (patch: Record<string, unknown>) => void
  channel: string
  vars:    { token: string; label: string }[]
}) {
  const conf = cfg as unknown as MessageNodeConfig
  // Nó legado (só `text`) entra como UM balão com aquele texto — sem isso a pessoa
  // abriria um nó antigo e veria o campo vazio.
  const lidos = baloesDe(conf)
  const baloes: RichMessage[] = lidos.length ? lidos : [{ text: String(conf.text ?? "") }]
  const [aberto, setAberto] = useState(0)

  /**
   * 🔴 GRAVA OS TRÊS FORMATOS, e não é redundância.
   *    • `messages` — a verdade nova.
   *    • `rich`     — o que a versão ANTERIOR do app lê durante o deploy (que não é atômico).
   *    • `text`     — o campo legado, mesma razão, uma camada abaixo.
   *    Os dois de compatibilidade recebem o PRIMEIRO balão: é o que a versão antiga
   *    conseguiria entregar, e entregar o começo é melhor que entregar nada.
   */
  const gravar = (lista: RichMessage[]) => {
    const limpa = lista.slice(0, MAX_BALOES)
    set({ messages: limpa, rich: limpa[0], text: limpa[0]?.text ?? "" })
  }

  const patch = (i: number, v: RichMessage) => gravar(baloes.map((b, j) => (j === i ? v : b)))
  const add   = () => { gravar([...baloes, { text: "" }]); setAberto(baloes.length) }
  const drop  = (i: number) => {
    const resto = baloes.filter((_, j) => j !== i)
    gravar(resto.length ? resto : [{ text: "" }])
    setAberto((a) => Math.max(0, Math.min(a, resto.length - 1)))
  }
  const mover = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= baloes.length) return
    const copia = [...baloes]
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
    gravar(copia)
    setAberto(j)
  }

  /** Respiro: orçamento de 10s por turno, teto de 3,5s por mensagem (outbound.ts). */
  const ritmo = baloes.length >= 4
    ? "O 4º balão chega junto do 3º — o respiro de um turno tem 10 segundos e acaba antes dele."
    : baloes.length > 1
      ? `Os ${baloes.length} balões chegam com respiro entre eles, no ritmo de alguém digitando.`
      : null

  return (
    <div className="space-y-2">
      {baloes.map((b, i) => {
        const ultimo  = i === baloes.length - 1
        const nBotoes = (b.buttons ?? []).length
        const resumo  = (b.text ?? "").trim().split("\n")[0].slice(0, 42)
        return (
          <div key={i} className="rounded-xl border border-slate-300 bg-white overflow-hidden">
            {/* ⚠️ A LINHA INTEIRA abre e fecha (achado do owner na 1ª versão: o alvo era só o
                rótulo, então parecia que o balão "só recolhia clicando em outro"). O chevron
                mostra o estado — sem ele, clicar num cabeçalho é aposta. */}
            <div className="flex items-center gap-1.5 px-2.5 h-9 bg-slate-50 border-b border-slate-300">
              <GripVertical className="size-3.5 text-slate-300 shrink-0" />
              <button type="button" onClick={() => setAberto(aberto === i ? -1 : i)}
                aria-expanded={aberto === i}
                className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
                <ChevronRight className={`size-3.5 shrink-0 text-slate-400 transition-transform ${aberto === i ? "rotate-90" : ""}`} />
                <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                  {baloes.length > 1 ? `Balão ${i + 1}` : "Mensagem"}
                </span>
                {aberto !== i && (
                  <span className="min-w-0 flex items-center gap-1.5">
                    {resumo && <span className="text-[11px] text-slate-400 truncate">{resumo}</span>}
                    {b.media && <ImageIcon className="size-3 shrink-0 text-slate-300" />}
                    {nBotoes > 0 && <MousePointerClick className="size-3 shrink-0 text-slate-300" />}
                  </span>
                )}
              </button>
              {baloes.length > 1 && (
                <>
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0}
                    title="Subir"
                    className="size-6 grid place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30">
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={ultimo}
                    title="Descer"
                    className="size-6 grid place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30">
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => drop(i)} title="Remover balão"
                    className="size-6 grid place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <X className="size-3.5" />
                  </button>
                </>
              )}
            </div>

            {aberto === i && (
              <div className="p-2.5">
                <RichComposer
                  variant="compact"
                  value={b}
                  channel={channel}
                  vars={vars}
                  onChange={(v) => patch(i, v)}
                />
                {/* 🔴 Botão só no ÚLTIMO balão — botão no meio seria parar antes de
                    terminar de falar, e em dois balões seriam duas saídas concorrentes
                    no mesmo nó. A publicação recusa; aqui a pessoa descobre antes. */}
                {!ultimo && nBotoes > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                    Só o <b>último</b> balão pode ter botão — ele é quem faz o nó esperar a
                    resposta. Mova este botão pro último balão ou mova este balão pro fim.
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}

      {baloes.length < MAX_BALOES && (
        <button type="button" onClick={add}
          className="w-full h-10 flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 text-[13px] font-medium text-slate-500 hover:border-primary-200 hover:text-primary-600 transition-colors">
          <Plus className="size-3.5" /> Adicionar balão
        </button>
      )}

      {ritmo && (
        <div className="rounded-xl bg-white border border-slate-300 px-3 py-2.5 space-y-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <Clock className="size-3.5" /> Ritmo
          </p>
          <p className="text-[11.5px] leading-relaxed text-slate-500">{ritmo}</p>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Botão de resposta faz o nó <b>esperar</b> e cria uma saída pra cada um, mais a
        saída <b>&ldquo;escreveu&rdquo;</b>. Só texto (ou só botão de link) envia e segue direto.
      </p>
    </div>
  )
}
