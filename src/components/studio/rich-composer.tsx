"use client"

import { useRef, useState, useTransition } from "react"
import { Image as ImageIcon, X, Plus, Loader2, Link2, MessageSquare, AlertCircle } from "lucide-react"
import { uploadCardImage, removeCardImage } from "@/lib/actions/studio/card-image"
import { getChannelCompose } from "@/lib/channels/policy"
import { richFormat, richFormatCaveat, richFormatMissing,
         RICH_FORMAT_FIELDS, RICH_FORMAT_OPTIONS } from "@/lib/messaging/rich-format"
import type { RichMessage, RichButton } from "@/lib/ai-v2/flow/types"

/**
 * Compositor de UMA mensagem — texto · imagem · botões.
 * Desenho: docs/message-composer-design.md
 *
 * 🔴 **BOTÃO É O CENTRO, NÃO O "AVANÇADO".** No direct de abertura a Meta dá uma mensagem
 *    só, e a conversa só continua se a PESSOA responder. Toque em botão conta como
 *    resposta dela → abre a janela de 24h sem ela digitar (verificado ao vivo 2026-08-01).
 *    É a maior alavanca de conversão do funil; esconder atrás de um "mais opções" seria
 *    enterrar o que faz o recurso funcionar.
 *
 * 🔴 **LIMITE APARECE COMO CONSEQUÊNCIA.** Não existe "máximo 3 botões" escrito: no 3º o
 *    botão de adicionar some. Os tetos vêm do registry de canal (`policy.ts`), nunca de
 *    constante na tela — canal novo não pode virar caça ao `if`.
 *
 * ⚠️ **Uma mensagem, nunca uma sequência.** Sem "adicionar bloco", sem atraso: sequência é
 *    o canvas (nós `wait`/`collect`). Copiar a lista de blocos do ManyChat daria dois
 *    jeitos de fazer a mesma coisa.
 */

export type ComposerPart = "text" | "image" | "buttons"

const NEW_ID = () => `b${Math.random().toString(36).slice(2, 8)}`

export function RichComposer({ value, onChange, channel = "instagram", onFocusPart, vars = [] }: {
  value:    RichMessage
  onChange: (v: RichMessage) => void
  channel?: string
  /** Avisa qual parte está em foco — é o que faz a prévia acompanhar. */
  onFocusPart?: (p: ComposerPart) => void
  /** Variáveis ofertadas como chips sob o texto. Vazio = sem chips. */
  vars?: { token: string; label: string }[]
}) {
  const limits = getChannelCompose(channel)
  const [busy, startUpload] = useTransition()
  const [err, setErr]       = useState<string | null>(null)
  const fileRef             = useRef<HTMLInputElement>(null)
  const textRef             = useRef<HTMLTextAreaElement>(null)

  /** Insere `{{token}}` no cursor (não no fim) — quem escreve está no meio da frase. */
  function insertVar(token: string) {
    const el = textRef.current
    const cur = value.text ?? ""
    const chip = `{{${token}}}`
    if (!el) { onChange({ ...value, text: (cur + chip).slice(0, limits.textMax) }); return }
    const a = el.selectionStart ?? cur.length
    const b = el.selectionEnd ?? cur.length
    const next = (cur.slice(0, a) + chip + cur.slice(b)).slice(0, limits.textMax)
    onChange({ ...value, text: next })
    // Cursor depois do chip, no próximo tick (o React ainda vai re-renderizar).
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + chip.length, a + chip.length) })
  }

  const buttons = value.buttons ?? []
  const set = (patch: Partial<RichMessage>) => onChange({ ...value, ...patch })

  // 🔴 O formato é ESCOLHIDO (decisão do dono). `richFormat` devolve a escolha; só cai na
  //    derivação quando o dado é antigo e não tem o campo.
  //    ⚠️ É a MESMA função que o envio usa (lib/messaging/rich-format.ts) — tela e Meta não
  //    podem discordar sobre o que vai sair, porque a bala é única.
  const fmt     = richFormat(value)
  const show    = RICH_FORMAT_FIELDS[fmt === "empty" ? "text" : fmt]
  const caveat  = richFormatCaveat(fmt, value)
  const missing = richFormatMissing(value)

  /** Trocar de formato NÃO apaga o que já foi escrito — só muda o que aparece. Quem volta
   *  pro cartão reencontra a imagem, em vez de ter que subir de novo. */
  const pickFormat = (f: Exclude<typeof fmt, "empty">) => onChange({ ...value, format: f })

  function pickFile(f: File | null) {
    if (!f) return
    setErr(null)
    startUpload(async () => {
      const fd = new FormData()
      fd.append("file", f)
      const res = await uploadCardImage(fd)
      if ("error" in res) { setErr(res.error); return }
      set({ media: { kind: "image", path: res.path, name: res.url } })
      onFocusPart?.("image")
    })
  }

  /**
   * 🔴 NÃO APAGA O ARQUIVO AQUI (correção do QA, 2026-08-01). A versão anterior chamava
   *    `removeCardImage` no clique — antes de salvar. Quem abrisse um fluxo PUBLICADO,
   *    clicasse no X pra ver outra imagem e fechasse sem salvar destruía a foto de todos
   *    os cards já enviados (a Meta re-busca a imagem na renderização) e do fluxo no ar.
   *    Irreversível, sem confirmação.
   *
   *    Agora só some da composição. O arquivo fica no bucket — vira órfão se ninguém
   *    salvar, e órfão é problema da faxina; imagem de cliente destruída é problema do
   *    cliente.
   */
  function dropImage() {
    set({ media: undefined })
  }

  function patchButton(i: number, patch: Partial<RichButton>) {
    set({ buttons: buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) })
  }

  return (
    <div className="space-y-4">
      {/* 🔴 SELETOR DE FORMATO — a pessoa ESCOLHE (decisão do dono, 2026-08-01).
          Mesmo desenho de cartões do seletor "Contém / Palavra exata" do painel lateral,
          reusado de propósito: a tela nova não pode inventar linguagem visual própria.
          A escolha decide QUAIS CAMPOS APARECEM abaixo — é isso que impede escolher
          "cartão" e deixar a imagem vazia, sem precisar validar depois. */}
      <div className="grid grid-cols-2 gap-2">
        {RICH_FORMAT_OPTIONS.map(({ key, title, desc }) => (
          <button key={key} type="button" onClick={() => pickFormat(key)}
            className={`text-left p-2.5 rounded-lg border transition-colors ${
              fmt === key ? "border-primary/30 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
            <p className="text-xs font-semibold text-slate-800">{title}</p>
            <p className="text-[10.5px] text-slate-500">{desc}</p>
          </button>
        ))}
      </div>

      {caveat && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
          {caveat}
        </p>
      )}

      {/* ── Texto ── */}
      {show.text && (
      <div>
        <textarea
          ref={textRef}
          value={value.text ?? ""}
          onFocus={() => onFocusPart?.("text")}
          onChange={(e) => set({ text: e.target.value.slice(0, limits.textMax) })}
          rows={4}
          placeholder="Oi! Vi que você comentou 😊"
          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300"
        />
        {/* Chips que inserem no cursor — o cliente NUNCA digita chaves (mesmo padrão do
            editor de fluxo e do de templates; linguagem visual não se reinventa). */}
        {vars.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            <span className="text-[10px] text-slate-400">Inserir:</span>
            {vars.map((v) => (
              <button key={v.token} type="button" title={v.label} onClick={() => insertVar(v.token)}
                className="px-1.5 py-0.5 text-[10px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded transition-colors">
                {`{{${v.token}}}`}
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className="text-slate-400">Uma mensagem por comentário. É a única chance.</span>
          <span className={(value.text?.length ?? 0) > limits.textMax - 60 ? "text-amber-600 font-medium" : "text-slate-300"}>
            {value.text?.length ?? 0}/{limits.textMax}
          </span>
        </div>
      </div>
      )}

      {/* ── Imagem ── */}
      {show.media && (
      <div>
        {value.media ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value.media.name ?? ""} alt="" className="size-14 rounded-lg object-cover bg-slate-100" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-slate-700">Imagem no cartão</p>
              <p className="text-[11px] text-slate-400">Some do cartão se você remover — inclusive dos já enviados.</p>
            </div>
            <button type="button" onClick={dropImage}
              className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-dashed border-slate-200 text-[13px] font-medium text-slate-500 hover:border-primary-200 hover:text-primary-600 transition-colors disabled:opacity-60">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            {busy ? "Processando…" : "Adicionar imagem"}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
          onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = "" }} />
        {err && <p className="mt-1.5 text-[12px] text-red-600">{err}</p>}
      </div>
      )}

      {/* ── Botões ── */}
      {show.buttons && (
      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] font-semibold text-slate-700">Botões</p>
          <p className="text-[11px] text-slate-400">o toque abre a conversa</p>
        </div>

        <div className="mt-2 space-y-2">
          {buttons.map((b, i) => (
            <div key={b.id} className="rounded-xl border border-slate-200 p-2.5">
              <div className="flex items-center gap-2">
                <input value={b.label}
                  onFocus={() => onFocusPart?.("buttons")}
                  onChange={(e) => patchButton(i, { label: e.target.value.slice(0, limits.buttonLabelMax) })}
                  placeholder="Quero os valores"
                  className="flex-1 h-8 px-2.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:border-primary-300" />
                <button type="button" aria-label="Remover botão"
                  onClick={() => set({ buttons: buttons.filter((_, j) => j !== i) })}
                  className="size-8 shrink-0 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-2 flex items-center gap-1">
                {([["reply", "Continua a conversa", MessageSquare], ["url", "Abre um link", Link2]] as const).map(([k, label, Icon]) => (
                  <button key={k} type="button" onClick={() => patchButton(i, { kind: k })}
                    className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
                      b.kind === k ? "bg-primary/10 text-primary-700" : "text-slate-500 hover:bg-slate-100"}`}>
                    <Icon className="size-3" /> {label}
                  </button>
                ))}
              </div>

              {b.kind === "url" && (
                <input value={b.url ?? ""} onChange={(e) => patchButton(i, { url: e.target.value })}
                  placeholder="https://..."
                  className="mt-2 w-full h-8 px-2.5 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:border-primary-300" />
              )}
              {b.kind === "reply" && (
                /* Por que dizer isto aqui: é a diferença entre o funil converter e morrer. */
                <p className="mt-1.5 text-[11px] text-slate-400">
                  O toque conta como resposta da pessoa — é o que libera a Kora a continuar falando.
                </p>
              )}
            </div>
          ))}

          {/* O limite não é avisado: o botão simplesmente deixa de existir. */}
          {buttons.length < limits.maxButtons && (
            <button type="button"
              onClick={() => { onFocusPart?.("buttons"); set({ buttons: [...buttons, { id: NEW_ID(), label: "", kind: "reply" }] }) }}
              className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border-2 border-dashed border-slate-200 text-[12px] font-medium text-slate-500 hover:border-primary-200 hover:text-primary-600 transition-colors">
              <Plus className="size-3.5" /> Adicionar botão
            </button>
          )}
        </div>
      </div>
      )}

      {/* O que falta pro formato ESCOLHIDO poder ir ao ar. Aparece aqui ao vivo e é a MESMA
          checagem que o servidor usa pra recusar a publicação — a pessoa não descobre no
          "Publicar" o que já dava pra ver enquanto montava. */}
      {missing && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertCircle className="size-3.5 shrink-0 mt-px" /> {missing}
        </p>
      )}
    </div>
  )
}
