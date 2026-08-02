"use client"

import { useRef, useState, useTransition } from "react"
import { Check, AlertTriangle, Image as ImageIcon, X, Plus } from "lucide-react"
import { ConfigModal, type ConfigSection } from "./config-modal"
import { IgCommentPreview, type PreviewFocus } from "./ig-comment-preview"
import { RichComposer } from "./rich-composer"
import { PostPicker } from "@/components/integrations/instagram/post-picker"
import { dmHint, type IgCommentTriggerConfig } from "@/components/integrations/instagram/ig-comment-config"
import { freezeInstagramThumbs } from "@/lib/actions/instagram-media"

/**
 * Editor NOVO do gatilho de comentário — roda EM PARALELO ao painel lateral atual.
 * Desenho: docs/studio-config-modal-design.md
 *
 * 🔴 PARALELO, NÃO SUBSTITUIÇÃO (decisão do dono, 2026-07-31). O comment-to-DM está em
 *    produção e foi validado ponta a ponta; trocar o editor às cegas arriscaria um
 *    recurso que funciona. Aqui o painel atual segue sendo o caminho normal e este modal
 *    é **opt-in** por um botão discreto.
 *    Por que é seguro: os dois gravam o MESMO objeto (`IgCommentTriggerConfig`) e quem
 *    decide se o gatilho vai ao ar é `validateIgPublish` no SERVIDOR — nenhuma tela
 *    consegue publicar config inválida.
 *
 * 🔴 REUSA, NÃO REIMPLEMENTA: `PostPicker` e `dmHint` vêm do editor atual. Se a lógica
 *    fosse duplicada, os dois divergiriam e o paralelo deixaria de ser seguro — o cliente
 *    veria aviso diferente dependendo de onde abriu.
 *
 * ⚠️ PRAZO DE REMOÇÃO (ROADMAP): validado o gatilho ponta a ponta por aqui, o painel
 *    lateral sai. Código paralelo sem data de morte vira dívida permanente.
 */

const DM_MAX = 1000

export function IgCommentModal({ open, value, username, onChange, onClose }: {
  open:      boolean
  value:     IgCommentTriggerConfig
  username?: string | null
  onChange:  (v: IgCommentTriggerConfig) => void
  onClose:   () => void
}) {
  // Rascunho local: o modal só devolve no Salvar. Cancelar tem que descartar de verdade —
  // editar ao vivo e "cancelar" sem desfazer é a mentira clássica de modal.
  const [draft, setDraft] = useState<IgCommentTriggerConfig>(value)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [kw, setKw] = useState("")
  const [, startFreeze] = useTransition()
  /** 🔴 A prévia segue o CAMPO EM FOCO, não a rolagem. Rolagem trocava a prévia sem a
   *  pessoa pedir; foco troca no momento em que ela clica no campo — que é exatamente
   *  quando ela quer ver aquele resultado. (Ajuste pedido pelo dono, 2026-07-31.) */
  const [focus, setFocus] = useState<PreviewFocus>("post")
  const triedRef = useRef<Set<string>>(new Set())

  const set  = (patch: Partial<IgCommentTriggerConfig>) => setDraft((d) => ({ ...d, ...patch }))

  /** Fluxo antigo tem só `dm` (string). Abrir aqui promove pro formato rico SEM perder o
   *  texto — e sem gravar nada até a pessoa salvar. */
  const rich = draft.dmRich ?? { text: draft.dm }

  /**
   * Modo de captura — estado de TELA, não coluna nova.
   *
   * No dado, "qualquer comentário" é `keywords: []`. Só que isso não distingue "escolhi
   * qualquer" de "escolhi Contém e ainda não digitei" — e sem essa distinção o campo de
   * palavra sumiria no meio da digitação. Daí o estado local, semeado pelo que está salvo.
   */
  const [kwMode, setKwMode] = useState<"any" | "contains" | "exact">(
    value.keywords.length ? (value.keywordMatch === "exact" ? "exact" : "contains") : "any",
  )
  function pickMatch(m: "any" | "contains" | "exact") {
    setKwMode(m)
    // "Qualquer" limpa as palavras (é o que o runtime entende). Os outros dois só trocam a
    // régua de comparação — trocar de Contém pra Exata não pode apagar o que foi digitado.
    if (m === "any") set({ keywords: [] })
    else set({ keywordMatch: m })
  }
  const hint = dmHint(draft.dm)

  /**
   * 🔴 CONGELA A MINIATURA — sem isto o post escolhido aqui guardaria a URL de CDN da
   *    Meta, que **expira em ~1-2 dias**, e o card do fluxo quebraria. O painel atual já
   *    fazia isso; o modal novo precisa fazer igual, senão o editor novo reintroduz um
   *    bug que o antigo não tem (é justamente o risco de rodar dois editores em paralelo).
   *    Best-effort: falhando, fica a URL do CDN e a próxima abertura tenta de novo.
   */
  function freezeThumbs(ids: string[]) {
    const todo = ids.filter((id) => id && !triedRef.current.has(id))
    if (!todo.length) return
    todo.forEach((id) => triedRef.current.add(id))
    startFreeze(async () => {
      const res = await freezeInstagramThumbs(todo)
      if ("error" in res) return
      setDraft((d) => ({ ...d, posts: d.posts.map((p) => (res.urls[p.id] ? { ...p, thumbUrl: res.urls[p.id] } : p)) }))
    })
  }

  function addKeyword() {
    const v = kw.trim()
    if (!v || draft.keywords.includes(v)) { setKw(""); return }
    set({ keywords: [...draft.keywords, v] }); setKw("")
  }

  const sections: ConfigSection[] = [
    {
      id: "post", title: "Em qual publicação?",
      body: (
        <div>
          <p className="text-[13px] text-slate-500">
            Só comentários nesses posts entram no fluxo. Até 3.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {draft.posts.map((p) => (
              <div key={p.id} className="relative size-24 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                {p.thumbUrl
                  ? /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.thumbUrl} alt={p.caption ?? "Post"} className="size-full object-cover" />
                  : <div className="size-full grid place-items-center"><ImageIcon className="size-5 text-slate-300" /></div>}
                <button type="button" aria-label="Remover post"
                  onClick={() => set({ posts: draft.posts.filter((x) => x.id !== p.id) })}
                  className="absolute top-1 right-1 size-5 grid place-items-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900">
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {draft.posts.length < 3 && (
              <button type="button" onClick={() => { setFocus("post"); setPickerOpen(true) }}
                className="size-24 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-primary-200 hover:text-primary-600 transition-colors grid place-items-center">
                <Plus className="size-5" />
              </button>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "keyword", title: "O que aciona o direct?",
      body: (
        <div>
          {/* 🔴 TRÊS CARTÕES, UMA DECISÃO (pedido do dono, 2026-08-01). O painel lateral
              antigo separava isto em dois blocos grandes + um seletor "Contém/Exata" à
              parte — mas as três são a MESMA escolha, mutuamente exclusivas. Junto, dá pra
              ver as três de uma vez em vez de descobrir a terceira depois de escolher.
              Mesmo desenho do seletor de formato do passo 3. */}
          <div className="grid grid-cols-3 gap-2">
            {([
              ["any",      "Qualquer comentário", "todo mundo que comentar"],
              ["contains", "Contém",              "em qualquer parte"],
              ["exact",    "Palavra exata",       "a palavra inteira"],
            ] as const).map(([key, title, desc]) => (
              <button key={key} type="button" onClick={() => pickMatch(key)}
                className={`text-left p-2.5 rounded-lg border transition-colors ${
                  kwMode === key ? "border-primary/30 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <p className="text-xs font-semibold text-slate-800">{title}</p>
                <p className="text-[10.5px] text-slate-500">{desc}</p>
              </button>
            ))}
          </div>

          {/* A escolha decide o que aparece — mesma regra do compositor: sem "qualquer
              comentário" selecionado, o campo de palavra nem existe. */}
          {kwMode !== "any" && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 p-2.5">
                {draft.keywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg bg-primary/10 text-primary-700 text-xs font-semibold">
                    {k}
                    <span role="button" tabIndex={0} aria-label={`Remover ${k}`}
                      onClick={() => set({ keywords: draft.keywords.filter((x) => x !== k) })}
                      onKeyDown={(e) => { if (e.key === "Enter") set({ keywords: draft.keywords.filter((x) => x !== k) }) }}
                      className="grid place-items-center size-4 rounded hover:bg-primary/20 cursor-pointer">
                      <X className="size-3" />
                    </span>
                  </span>
                ))}
                <input value={kw} onFocus={() => setFocus("post")} onChange={(e) => setKw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword() } }}
                  onBlur={addKeyword} placeholder="+ palavra"
                  className="h-7 min-w-24 flex-1 px-2 text-xs border border-dashed border-slate-300 rounded-lg focus:outline-none focus:border-primary-300" />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">Ignora acento e maiúscula (olá = ola).</p>

              {/* ⚠️ Sem palavra, a escolha vira "qualquer comentário" na prática — e aí a
                  bala única é gasta em "lindo 😍". Avisar aqui, não no publicar. */}
              {!draft.keywords.length && (
                <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                  Escreva ao menos uma palavra. Sem nenhuma, <strong>todo</strong> comentário recebe
                  direct — inclusive “lindo 😍”, e a chance daquele comentário se perde.
                </p>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      // Separado da resposta pública de propósito: cada seção comanda a SUA prévia
      // (esta acende o direct; a de baixo sobe a folha de comentários).
      id: "dm", title: "O que a pessoa recebe no direct?",
      body: (
        <div>
          {/* 🔴 O compositor é COMPARTILHADO (rich-composer.tsx) — o mesmo componente vai
              servir o nó `message` do fluxo. Um editor rico só aqui deixaria o direct de
              abertura mais capaz que o fluxo inteiro depois dele. */}
          <RichComposer
            value={rich}
            channel="instagram"
            onFocusPart={() => setFocus("direct")}
            onChange={(v) => set({ dmRich: v, dm: (v.text ?? "").slice(0, DM_MAX) })}
          />
          {/* Verificador VIVO — mesma função do painel atual (dmHint), não uma cópia. */}
          {hint.tone !== "none" && (
            <p className={`mt-2 flex items-start gap-1.5 text-[11px] ${hint.tone === "ok" ? "text-emerald-600" : "text-amber-600"}`}>
              {hint.tone === "ok" ? <Check className="size-3.5 shrink-0 mt-px" /> : <AlertTriangle className="size-3.5 shrink-0 mt-px" />}
              {hint.msg}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "public", title: "E no comentário?",
      body: (
        <div>
          <p className="text-[13px] text-slate-500">
            Avisa quem não segue a conta — pra essa pessoa o direct cai em Solicitações.
            Com várias variações, a Kora alterna entre elas.
          </p>
          <div className="mt-4 space-y-1.5">
            {draft.publicReplies.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={r} onFocus={() => setFocus("comments")}
                  onChange={(e) => set({ publicReplies: draft.publicReplies.map((x, j) => j === i ? e.target.value : x) })}
                  placeholder="Te chamei no direct!"
                  className="flex-1 h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <button type="button" aria-label="Remover resposta"
                  onClick={() => set({ publicReplies: draft.publicReplies.filter((_, j) => j !== i) })}
                  className="size-9 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => { setFocus("comments"); set({ publicReplies: [...draft.publicReplies, ""] }) }}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-primary-600 hover:bg-primary/5 rounded-lg transition-colors">
              <Plus className="size-3.5" /> nova variação
            </button>
          </div>
        </div>
      ),
    },
  ]


  return (
    <>
      <ConfigModal
        open={open}
        sections={sections}
        preview={(
          <IgCommentPreview
            focus={focus}
            data={{
              thumbUrl:    draft.posts[0]?.thumbUrl ?? null,
              keyword:     draft.keywords[0] ?? null,
              dm:          draft.dm,
              publicReply: draft.publicReplies.find((r) => r.trim()) ?? null,
              dmImage:  rich.media?.name ?? null,
              dmButtons: (rich.buttons ?? []).map((b) => b.label),
              username,
            }} />
        )}
        onSave={() => {
          // Limpa variação vazia no salvar: linha em branco viraria resposta pública vazia.
          onChange({ ...draft, publicReplies: draft.publicReplies.filter((r) => r.trim()) })
          onClose()
        }}
        onClose={onClose}
      />

      <PostPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        username={username}
        selected={draft.posts.map((p) => p.id)}
        multiple
        onPick={(items) => {
          // Mapeamento EXPLÍCITO (o picker devolve `IgMediaItem`, não `IgPostRef`) — sem
          // ele, campo novo do picker entraria calado no `trigger` salvo.
          const posts = items.slice(0, 3).map((m) => ({
            id: m.id, permalink: m.permalink, caption: m.caption,
            isReel: m.isReel, timestamp: m.timestamp, thumbUrl: m.thumbUrl,
          }))
          set({ posts })
          freezeThumbs(posts.map((p) => p.id))
          setPickerOpen(false)
        }}
      />
    </>
  )
}
