"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Image as ImageIcon, Play, Loader2, AlertTriangle, X, RefreshCw, Heart, Lock } from "lucide-react"
import { ConfigModal, type ConfigSection } from "./config-modal"
import { IgStoryPreview, type StoryPreviewFocus } from "./ig-story-preview"
import { getInstagramStories } from "@/lib/actions/instagram-media"
import type { IgStoryItem } from "@/lib/instagram/api"
import type { IgStoryTrigger } from "@/lib/ai-v2/flow/types"

/**
 * Editor do gatilho **"respondeu seu story"**, no MESMO modal do gatilho de comentário.
 * Desenho: docs/studio-config-modal-design.md
 *
 * 🔴 Mesma casca (`ConfigModal`), mesma linguagem de cartões, mesma regra de prévia seguindo
 *    o campo em foco. Dois editores de gatilho com aparências diferentes ensinariam a pessoa
 *    duas vezes — e divergiriam.
 *
 * ⚠️ O que MUDA em relação ao comentário, e está dito na tela: aqui **não existe bala
 *    única**. A resposta ao story já abre a janela de 24h, então não há compositor de
 *    primeira mensagem — quem fala é o fluxo.
 */

export function IgStoryModal({ open, value, username, pro, onChange, onClose }: {
  open:      boolean
  value:     IgStoryTrigger
  username?: string | null
  /** Tenant tem o nível PRO do módulo? Decide o ❤️ automático. */
  pro:       boolean
  onChange:  (v: IgStoryTrigger) => void
  onClose:   () => void
}) {
  const [draft, setDraft] = useState<IgStoryTrigger>(value)
  const [mode, setMode]   = useState<"all" | "specific">(value.storyIds.length ? "specific" : "all")
  const [kwMode, setKwMode] = useState<"any" | "contains" | "exact">(
    value.keywords.length ? (value.keywordMatch === "exact" ? "exact" : "contains") : "any",
  )
  const [kw, setKw]           = useState("")
  const [stories, setStories] = useState<IgStoryItem[] | null>(null)
  const [err, setErr]         = useState<string | null>(null)
  const [loading, startLoad]  = useTransition()
  const [focus, setFocus]     = useState<StoryPreviewFocus>("story")
  const loadedRef             = useRef(false)

  const set = (patch: Partial<IgStoryTrigger>) => setDraft((d) => ({ ...d, ...patch }))

  function load() {
    startLoad(async () => {
      setErr(null)
      const res = await getInstagramStories()
      if ("error" in res) { setErr(res.error); setStories([]); return }
      setStories(res.items)
    })
  }

  // Só busca quando entra no modo "específico" — quem usa o padrão não paga a chamada.
  useEffect(() => {
    if (mode === "specific" && !loadedRef.current) { loadedRef.current = true; load() }
  }, [mode])

  function pickMode(m: "all" | "specific") {
    setMode(m); setFocus("story")
    if (m === "all") set({ storyIds: [] })
  }
  function pickKwMode(m: "any" | "contains" | "exact") {
    setKwMode(m); setFocus("story")
    if (m === "any") set({ keywords: [] })
    else set({ keywordMatch: m })
  }
  function addKeyword() {
    const v = kw.trim()
    if (!v || draft.keywords.includes(v)) { setKw(""); return }
    set({ keywords: [...draft.keywords, v] }); setKw("")
  }

  const sections: ConfigSection[] = [
    {
      id: "story", title: "A pessoa responde qual story?",
      body: (
        <div>
          <div className="grid grid-cols-2 gap-2">
            {([["all", "Todos os stories", "vale pra qualquer um"],
               ["specific", "Story específico", "só os que você escolher"]] as const).map(([k, title, desc]) => (
              <button key={k} type="button" onClick={() => pickMode(k)}
                className={`text-left p-2.5 rounded-lg border transition-colors ${
                  mode === k ? "border-primary/30 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <p className="text-xs font-semibold text-slate-800">{title}</p>
                <p className="text-[10.5px] text-slate-500">{desc}</p>
              </button>
            ))}
          </div>

          {mode === "specific" && (
            <div className="mt-3">
              {/* 🔴 O AVISO QUE O MANYCHAT NÃO DÁ: story morre em 24h, então "específico" é
                  automação com prazo de validade — e ela morre CALADA. */}
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                <span>
                  Story dura <strong>24 horas</strong>. Quando esse expirar, o gatilho para de
                  funcionar e você precisa apontar pro novo. Pra automação que fica no ar, use{" "}
                  <strong>Todos os stories</strong>.
                </span>
              </p>

              <div className="mt-2.5 flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  {loading ? "carregando…" : `${stories?.length ?? 0} no ar agora`}
                </p>
                <button type="button" onClick={load} disabled={loading}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-primary-700 disabled:opacity-50">
                  {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} atualizar
                </button>
              </div>
              {err && <p className="mt-1.5 text-[11px] text-red-600">{err}</p>}

              {stories !== null && !stories.length && !loading && !err && (
                <p className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[11px] text-slate-400">
                  Nenhum story no ar. Publique um e clique em atualizar.
                </p>
              )}

              {!!stories?.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {stories.map((st) => {
                    const on = draft.storyIds.includes(st.id)
                    return (
                      <button key={st.id} type="button"
                        onClick={() => set({ storyIds: on ? draft.storyIds.filter((x) => x !== st.id) : [...draft.storyIds, st.id] })}
                        className={`relative h-28 w-20 rounded-xl overflow-hidden border-2 transition-colors ${
                          on ? "border-primary" : "border-slate-200 hover:border-slate-300"}`}>
                        {st.thumbUrl
                          ? /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={st.thumbUrl} alt="" className="size-full object-cover" />
                          : <div className="size-full grid place-items-center bg-slate-50"><ImageIcon className="size-4 text-slate-300" /></div>}
                        {st.mediaType === "VIDEO" && (
                          <span className="absolute bottom-1 left-1 rounded bg-black/50 p-0.5">
                            <Play className="size-2.5 text-white" />
                          </span>
                        )}
                        {on && <span className="absolute inset-0 bg-primary/15" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "keyword", title: "O que a resposta precisa ter?",
      body: (
        <div>
          <div className="grid grid-cols-3 gap-2">
            {([["any", "Qualquer coisa", "inclusive só um emoji"],
               ["contains", "Contém", "em qualquer parte"],
               ["exact", "Palavra exata", "a palavra inteira"]] as const).map(([k, title, desc]) => (
              <button key={k} type="button" onClick={() => pickKwMode(k)}
                className={`text-left p-2.5 rounded-lg border transition-colors ${
                  kwMode === k ? "border-primary/30 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                <p className="text-xs font-semibold text-slate-800">{title}</p>
                <p className="text-[10.5px] text-slate-500">{desc}</p>
              </button>
            ))}
          </div>

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
                <input value={kw} onFocus={() => setFocus("story")} onChange={(e) => setKw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword() } }}
                  onBlur={addKeyword} placeholder="+ palavra"
                  className="h-7 min-w-24 flex-1 px-2 text-xs border border-dashed border-slate-300 rounded-lg focus:outline-none focus:border-primary-300" />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">Ignora acento e maiúscula (olá = ola).</p>
              {!draft.keywords.length && (
                <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] text-amber-800">
                  Escreva ao menos uma palavra — sem nenhuma, vale pra qualquer resposta.
                </p>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "react", title: "Curtir a resposta automaticamente",
      body: (
        <div>
          {/* 🔴 VISÍVEL E DESABILITADO quando não há PRO — esconder recurso não vende
              upgrade: quem não vê não pede. E o gate REAL é `hasModulePro` no envio, não
              este `disabled`. */}
          <button type="button" disabled={!pro}
            onClick={() => { setFocus("story"); set({ autoReact: !draft.autoReact }) }}
            className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
              !pro ? "border-slate-200 bg-slate-50/60 cursor-not-allowed"
                   : draft.autoReact ? "border-primary/30 bg-primary-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${
              draft.autoReact && pro ? "bg-red-50" : "bg-slate-100"}`}>
              <Heart className={`size-4 ${draft.autoReact && pro ? "fill-red-500 text-red-500" : "text-slate-400"}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                Responder com um ❤️
                {!pro && (
                  <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <Lock className="size-2.5" /> PRO
                  </span>
                )}
              </p>
              <p className="text-[11px] text-slate-500">
                {pro ? "A Kora curte a resposta no momento em que ela chega."
                     : "Disponível no plano PRO. Fale com o suporte pra liberar."}
              </p>
            </div>
            <span className={`h-5 w-9 shrink-0 rounded-full transition-colors relative ${
              draft.autoReact && pro ? "bg-primary" : "bg-slate-300"}`}>
              <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
                draft.autoReact && pro ? "translate-x-4" : "translate-x-0.5"}`} />
            </span>
          </button>
        </div>
      ),
    },
  ]

  return (
    <ConfigModal
      open={open}
      sections={sections}
      preview={(
        <IgStoryPreview
          focus={focus}
          data={{
            thumbUrl:  stories?.find((s) => draft.storyIds.includes(s.id))?.thumbUrl ?? null,
            keyword:   draft.keywords[0] ?? null,
            autoReact: !!draft.autoReact && pro,
            username,
          }} />
      )}
      onSave={() => { onChange(draft); onClose() }}
      onClose={onClose}
    />
  )
}
