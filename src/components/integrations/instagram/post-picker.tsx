"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Search, Loader2, ImageOff, Play, Layers, MessageCircle, Link2, AlertCircle } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { getInstagramMedia } from "@/lib/actions/instagram-media"
import type { IgMediaItem } from "@/lib/instagram/api"

/**
 * Seletor visual de post do Instagram — o coração da automação de comentário.
 *
 * Decisões de UX (docs/instagram-studio-node-design.md §8.2):
 *  • 1 clique no tile ESCOLHE E FECHA. Sem confirmar — é reversível (o painel mostra o
 *    escolhido + "Trocar"). Confirmação aqui só adiciona passo.
 *  • A **contagem de comentários** é o dado-herói do tile: é o que faz o dono escolher o
 *    post certo (o que já engaja), não a legenda.
 *  • Multi-seleção opcional: mesma campanha em 2-3 reels cobre quase todo o desejo de
 *    "qualquer post" sem o risco de queimar a bala única num "lindo 😍".
 *
 * ⚠️ A API da Meta **não busca por legenda**. A busca aqui é client-side sobre o que já
 * foi carregado; pro arquivo antigo existe o campo "colar link" no rodapé.
 * ⚠️ `thumbUrl` é URL de CDN e EXPIRA — serve pra esta grade (efêmera). O post ESCOLHIDO
 * precisa ter a thumbnail congelada por quem consome este componente.
 */

export interface PostPickerProps {
  open:      boolean
  onClose:   () => void
  /** @handle da conta conectada — dá contexto de "qual perfil estou olhando". */
  username?: string | null
  /** Ids já escolhidos (marca os tiles). */
  selected?: string[]
  /** Devolve os posts escolhidos. 1 item no modo simples; N no modo múltiplo. */
  onPick:    (items: IgMediaItem[]) => void
  multiple?: boolean
}

type TypeFilter = "all" | "reels" | "images" | "carousel"

const FILTERS: Array<{ key: TypeFilter; label: string }> = [
  { key: "all",      label: "Tudo" },
  { key: "reels",    label: "Reels" },
  { key: "images",   label: "Fotos" },
  { key: "carousel", label: "Carrossel" },
]

/** Extrai o shortcode de um permalink (…/p/ABC123/ ou …/reel/ABC123/). */
function shortcodeFromUrl(url: string): string | null {
  const m = url.trim().match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
  return m?.[1] ?? null
}

function fmtDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

/**
 * Imagem do tile. A URL do CDN aqui é FRESCA (acabou de vir da Graph), mas se a Meta
 * recusar o carregamento o tile não pode virar um ícone quebrado sem texto: cai no
 * mesmo placeholder do "post sem thumb", e o `alt` descreve o post.
 */
function TileImage({ item }: { item: IgMediaItem }) {
  const [broken, setBroken] = useState(false)
  const cap = item.caption?.trim()
  const kind = item.isReel ? "Reel" : "Post"
  const label = cap ? `${kind}: ${cap.slice(0, 80)}` : `${kind} sem legenda`

  if (!item.thumbUrl || broken) {
    return (
      <div title={label} className="size-full bg-slate-100 flex items-center justify-center">
        <ImageOff className="size-5 text-slate-300" />
      </div>
    )
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={item.thumbUrl} alt={label} onError={() => setBroken(true)} className="size-full object-cover" />
  )
}

export function PostPicker({ open, onClose, username, selected = [], onPick, multiple = false }: PostPickerProps) {
  const [items,   setItems]   = useState<IgMediaItem[]>([])
  const [cursor,  setCursor]  = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [query,   setQuery]   = useState("")
  const [filter,  setFilter]  = useState<TypeFilter>("all")
  const [multi,   setMulti]   = useState(multiple)
  const [marked,  setMarked]  = useState<string[]>(selected)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkErr, setLinkErr] = useState<string | null>(null)
  const loadedOnce = useRef(false)

  const load = useCallback(async (after: string | null) => {
    setLoading(true); setError(null)
    const res = await getInstagramMedia({ cursor: after })
    setLoading(false)
    if ("error" in res) { setError(res.error); return }
    setItems((prev) => (after ? [...prev, ...res.items] : res.items))
    setCursor(res.nextCursor)
  }, [])

  // Carrega na 1ª abertura. Reabrir não refaz a chamada (a grade é cara e muda pouco).
  useEffect(() => {
    if (!open || loadedOnce.current) return
    loadedOnce.current = true
    void load(null)
  }, [open, load])

  // Reset da marcação ao ABRIR — ajuste de estado durante o render (padrão recomendado
  // do React pra derivar de prop), não `useEffect`: efeito aqui causaria render em cascata.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setMarked(selected)
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((m) => {
      if (filter === "reels"    && !m.isReel) return false
      if (filter === "images"   && (m.isReel || m.mediaType === "CAROUSEL_ALBUM")) return false
      if (filter === "carousel" && m.mediaType !== "CAROUSEL_ALBUM") return false
      if (q && !(m.caption ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [items, query, filter])

  function choose(item: IgMediaItem) {
    if (!multi) { onPick([item]); onClose(); return }
    setMarked((prev) => prev.includes(item.id) ? prev.filter((i) => i !== item.id) : [...prev, item.id])
  }

  function confirmMulti() {
    const picked = items.filter((m) => marked.includes(m.id))
    if (picked.length) { onPick(picked); onClose() }
  }

  function useLink() {
    setLinkErr(null)
    const code = shortcodeFromUrl(linkUrl)
    if (!code) { setLinkErr("Esse link não parece de um post do Instagram. Copie pelo app em ⋯ → Copiar link."); return }
    const found = items.find((m) => m.permalink?.includes(`/${code}`))
    if (!found) { setLinkErr("Esse post não está entre os carregados. Role a lista pra carregar mais e tente de novo."); return }
    choose(found)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      {/* Largura: escolher post é tarefa VISUAL — quanto mais miniatura cabe de uma vez,
          menos rolagem e menos erro de escolher o post errado. `max-w-3xl` (768px) dava 4
          colunas apertadas; `max-w-5xl` (1024px) com 5 colunas no desktop mostra ~2 semanas
          de posts sem rolar. `w-[92vw]` segura em tela menor sem estourar. */}
      <DialogContent className="w-[92vw] max-w-5xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-slate-100">
          <DialogTitle className="text-base font-bold text-slate-900">Escolher post do Instagram</DialogTitle>
          <p className="text-xs text-slate-500">
            {username ? `@${username} · ` : ""}Só comentários neste post entram no fluxo.
          </p>
        </DialogHeader>

        {/* Busca + filtros */}
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar na legenda…"
              className="w-full h-9 pl-8 pr-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
            />
          </div>
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`h-8 px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                  filter === f.key
                    ? "border-primary/30 bg-primary-50 text-primary-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="rounded border-slate-300" />
            Vários posts
          </label>
        </div>

        {/* Grade */}
        <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: "58vh" }}>
          {error ? (
            <div className="rounded-lg border border-red-100 bg-red-50/60 p-3 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="size-4 shrink-0 mt-px" /> <span>{error}</span>
            </div>
          ) : loading && !items.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i}>
                  <div className="aspect-square rounded-lg bg-slate-100 animate-pulse" />
                  <div className="h-2 w-10 mt-1.5 rounded bg-slate-100 animate-pulse" />
                  <div className="h-2 w-full mt-1 rounded bg-slate-100 animate-pulse" />
                </div>
              ))}
            </div>
          ) : !items.length ? (
            <EmptyState
              icon={ImageOff}
              title="Nenhuma publicação ainda"
              description="Publique uma foto ou reel no Instagram e volte aqui pra escolher."
            />
          ) : !visible.length ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-500">Nenhum post com esse texto entre os carregados.</p>
              <button type="button" onClick={() => { setQuery(""); setFilter("all") }}
                className="mt-2 text-xs font-semibold text-primary hover:underline">Limpar busca</button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {visible.map((m) => {
                  const isMarked = marked.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => choose(m)}
                      className="group text-left"
                    >
                      <div className={`relative aspect-square rounded-lg overflow-hidden ring-1 transition-all ${
                        isMarked ? "ring-2 ring-primary" : "ring-slate-200 group-hover:ring-2 group-hover:ring-primary/60"
                      }`}>
                        <TileImage item={m} />

                        {(m.isReel || m.mediaType === "CAROUSEL_ALBUM") && (
                          <span className="absolute top-1.5 right-1.5 rounded bg-slate-900/50 backdrop-blur-sm p-1">
                            {m.isReel ? <Play className="size-3 text-white" /> : <Layers className="size-3 text-white" />}
                          </span>
                        )}

                        {/* Dado-herói: quantos já comentaram nesse post. */}
                        {m.commentsCount !== null && (
                          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/70 to-transparent px-2 pt-4 pb-1.5 flex items-center gap-1">
                            <MessageCircle className="size-3 text-white" />
                            <span className="text-[11px] font-bold text-white tabular-nums">{m.commentsCount}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1.5">{fmtDate(m.timestamp)}</p>
                      <p className="text-[11px] text-slate-600 truncate">{m.caption ?? "Sem legenda"}</p>
                    </button>
                  )
                })}
              </div>

              {cursor && (
                <div className="flex justify-center mt-4">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void load(cursor)}
                    className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Carregar mais
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé: colar link (escape pro arquivo antigo) + confirmar múltiplos */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 space-y-2">
          <div className="flex items-center gap-2">
            <Link2 className="size-3.5 text-slate-400 shrink-0" />
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Post antigo? Cole o link aqui…"
              className="flex-1 h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button type="button" onClick={useLink} disabled={!linkUrl.trim()}
              className="h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Usar
            </button>
            {multi && (
              <button type="button" onClick={confirmMulti} disabled={!marked.length}
                className="h-8 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50">
                Usar {marked.length || ""} {marked.length === 1 ? "post" : "posts"}
              </button>
            )}
          </div>
          {linkErr && <p className="text-[11px] text-red-600 pl-5">{linkErr}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
