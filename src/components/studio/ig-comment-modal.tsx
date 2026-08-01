"use client"

import { useRef, useState, useTransition } from "react"
import { Check, AlertTriangle, Image as ImageIcon, X, Plus } from "lucide-react"
import { ConfigModal, type ConfigSection } from "./config-modal"
import { IgCommentPreview, type PreviewFocus } from "./ig-comment-preview"
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
  const triedRef = useRef<Set<string>>(new Set())

  const set  = (patch: Partial<IgCommentTriggerConfig>) => setDraft((d) => ({ ...d, ...patch }))
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
      id: "post", label: "Publicação",
      valid: draft.posts.length > 0,
      body: (
        <div>
          <h3 className="text-lg font-bold text-slate-900">Em qual publicação?</h3>
          <p className="mt-1 text-[13px] text-slate-500">
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
              <button type="button" onClick={() => setPickerOpen(true)}
                className="size-24 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-primary-200 hover:text-primary-600 transition-colors grid place-items-center">
                <Plus className="size-5" />
              </button>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "keyword", label: "Palavra-chave",
      valid: true,   // "qualquer comentário" é escolha válida — não é seção pendente
      body: (
        <div>
          <h3 className="text-lg font-bold text-slate-900">O que aciona o direct?</h3>
          <div className="mt-4 space-y-2.5">
            <button type="button" onClick={() => { if (!draft.keywords.length) setKw("") }}
              className={`w-full text-left rounded-xl border-2 p-4 transition-colors ${
                draft.keywords.length ? "border-primary bg-white" : "border-slate-200 bg-white hover:border-slate-300"}`}>
              <p className="text-[15px] font-semibold text-slate-900">Palavra específica</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {draft.keywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg bg-primary/10 text-primary-700 text-xs font-semibold">
                    {k}
                    <span role="button" tabIndex={0} aria-label={`Remover ${k}`}
                      onClick={(e) => { e.stopPropagation(); set({ keywords: draft.keywords.filter((x) => x !== k) }) }}
                      onKeyDown={(e) => { if (e.key === "Enter") set({ keywords: draft.keywords.filter((x) => x !== k) }) }}
                      className="grid place-items-center size-4 rounded hover:bg-primary/20 cursor-pointer">
                      <X className="size-3" />
                    </span>
                  </span>
                ))}
                <input value={kw} onChange={(e) => setKw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword() } }}
                  onBlur={addKeyword} placeholder="+ palavra"
                  className="h-7 min-w-24 flex-1 px-2 text-xs border border-dashed border-slate-300 rounded-lg focus:outline-none focus:border-primary-300" />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Ignora acento e maiúscula (olá = ola).</p>
            </button>

            <button type="button" onClick={() => set({ keywords: [] })}
              className={`w-full text-left rounded-xl border-2 p-4 transition-colors ${
                draft.keywords.length ? "border-slate-200 bg-white hover:border-slate-300" : "border-primary bg-white"}`}>
              <p className="text-[15px] font-semibold text-slate-900">Qualquer comentário</p>
              <p className="mt-0.5 text-[12px] text-slate-500">Todo mundo que comentar recebe o direct.</p>
            </button>
          </div>
        </div>
      ),
    },
    {
      // Separado da resposta pública de propósito: cada seção comanda a SUA prévia
      // (esta acende o direct; a de baixo sobe a folha de comentários).
      id: "dm", label: "Mensagem no direct",
      valid: !!draft.dm.trim(),
      body: (
        <div>
          <h3 className="text-lg font-bold text-slate-900">O que a pessoa recebe no direct?</h3>
          <p className="mt-1 text-[13px] text-slate-500">Uma mensagem por comentário. É a única chance.</p>
          <textarea value={draft.dm} onChange={(e) => set({ dm: e.target.value.slice(0, DM_MAX) })} rows={4}
            placeholder="Oi! Vi que você comentou no nosso post…"
            className="mt-4 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200 resize-y" />
          <div className="mt-1 flex items-start justify-between gap-3">
            {/* Verificador VIVO — mesma função do painel atual (dmHint), não uma cópia. */}
            {hint.tone !== "none" ? (
              <p className={`flex items-start gap-1.5 text-[11px] ${hint.tone === "ok" ? "text-emerald-600" : "text-amber-600"}`}>
                {hint.tone === "ok" ? <Check className="size-3.5 shrink-0 mt-px" /> : <AlertTriangle className="size-3.5 shrink-0 mt-px" />}
                {hint.msg}
              </p>
            ) : <span />}
            <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{draft.dm.length}/{DM_MAX}</span>
          </div>
        </div>
      ),
    },
    {
      id: "public", label: "Resposta no comentário",
      valid: draft.publicReplies.some((r) => r.trim()),
      body: (
        <div>
          <h3 className="text-lg font-bold text-slate-900">E no comentário?</h3>
          <p className="mt-1 text-[13px] text-slate-500">
            Avisa quem não segue a conta — pra essa pessoa o direct cai em Solicitações.
            Com várias variações, a Kora alterna entre elas.
          </p>
          <div className="mt-4 space-y-1.5">
            {draft.publicReplies.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input value={r}
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
            <button type="button" onClick={() => set({ publicReplies: [...draft.publicReplies, ""] })}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-primary-600 hover:bg-primary/5 rounded-lg transition-colors">
              <Plus className="size-3.5" /> nova variação
            </button>
          </div>
        </div>
      ),
    },
  ]

  /** Seção ativa → o que a prévia mostra. É o que faz ela SEGUIR a rolagem. */
  const focusOf: Record<string, PreviewFocus> = {
    post: "post", keyword: "post", dm: "direct", public: "comments",
  }

  return (
    <>
      <ConfigModal
        open={open}
        title="Configurar gatilho"
        sections={sections}
        preview={(activeId) => (
          <IgCommentPreview
            focus={focusOf[activeId] ?? "post"}
            data={{
              thumbUrl:    draft.posts[0]?.thumbUrl ?? null,
              keyword:     draft.keywords[0] ?? null,
              dm:          draft.dm,
              publicReply: draft.publicReplies.find((r) => r.trim()) ?? null,
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
