"use client"

import { useState } from "react"
import { Image as ImageIcon, Play, Plus, Trash2, ChevronDown, ExternalLink } from "lucide-react"
import { PostPicker } from "./post-picker"
import type { IgMediaItem } from "@/lib/instagram/api"

/**
 * Configuração do gatilho "Comentário no Instagram".
 *
 * Vive no painel do nó de Início quando `trigger.type === "ig_comment"` — não é um nó
 * solto no canvas. Motivo (docs/instagram-studio-node-design.md §8.3): a private reply
 * acontece ANTES de existir conversa, e depois dela a Meta não deixa enviar mais nada até
 * a pessoa responder. Um passo no meio do fluxo quebraria no nó seguinte.
 *
 * Ordem dos campos = a ordem em que as coisas acontecem: onde → quando → o que importa →
 * o que faz funcionar.
 */

/** Snapshot do post CONGELADO na config — a URL do CDN da Meta expira. */
export interface IgPostRef {
  id:        string
  permalink: string | null
  caption:   string | null
  isReel:    boolean
  timestamp: string | null
  thumbUrl:  string | null
}

export interface IgCommentTriggerConfig {
  posts:        IgPostRef[]
  keywords:     string[]
  keywordMatch: "contains" | "exact"
  dm:           string
  publicReplies: string[]
}

const DM_MAX = 1000

/** Verificador vivo: o texto pede resposta? É a defesa contra queimar a bala única. */
function dmHint(text: string): { tone: "ok" | "warn" | "none"; msg: string } {
  const t = text.trim()
  if (!t) return { tone: "none", msg: "" }
  if (t.length < 25) {
    return { tone: "warn", msg: "Muito curto. Diga quem você é e o que a pessoa ganha respondendo." }
  }
  const asks = /\?|\b(responde|responda|manda|mande|me diz|diga|digita|digite|escreve|escreva|comenta|comente|chama|chame)\b/i
  return asks.test(t)
    ? { tone: "ok",   msg: "Pede resposta — bom assim." }
    : { tone: "warn", msg: "Não pede resposta. A pessoa pode só ler e sair — e você não tem segunda chance." }
}

export function IgCommentConfig({ value, onChange, username }: {
  value:     IgCommentTriggerConfig
  onChange:  (v: IgCommentTriggerConfig) => void
  username?: string | null
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showRules, setShowRules]   = useState(false)

  const set = (patch: Partial<IgCommentTriggerConfig>) => onChange({ ...value, ...patch })
  const hint = dmHint(value.dm)

  function onPick(items: IgMediaItem[]) {
    set({
      posts: items.map((m) => ({
        id: m.id, permalink: m.permalink, caption: m.caption,
        isReel: m.isReel, timestamp: m.timestamp, thumbUrl: m.thumbUrl,
      })),
    })
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500 leading-relaxed">
        Quem comentar no seu post recebe um direct. Quem responder o direct entra neste fluxo.
      </p>

      {/* 1 · POST */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Post do Instagram</label>
          {value.posts.length > 0 && (
            <button type="button" onClick={() => setPickerOpen(true)}
              className="text-[11px] font-semibold text-primary hover:underline">Trocar</button>
          )}
        </div>

        {value.posts.length === 0 ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full h-20 rounded-xl border border-dashed border-slate-300 bg-white hover:border-primary/40 hover:bg-primary-50/40 transition-colors flex flex-col items-center justify-center gap-1"
          >
            <ImageIcon className="size-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Escolher post</span>
          </button>
        ) : value.posts.length === 1 ? (
          <PostCard post={value.posts[0]} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 flex items-center gap-2">
            <div className="flex -space-x-2">
              {value.posts.slice(0, 4).map((p) => (
                <Thumb key={p.id} post={p} className="size-10 ring-2 ring-white" />
              ))}
            </div>
            <span className="text-xs font-semibold text-slate-700">{value.posts.length} posts selecionados</span>
          </div>
        )}
        <p className="text-[11px] text-slate-400">Só comentários nesse post entram no fluxo.</p>
      </section>

      {/* 2 · PALAVRA */}
      <section className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Palavra no comentário</label>
        <input
          value={value.keywords.join(", ")}
          onChange={(e) => set({ keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
          placeholder="quero, valor, preço"
          className="w-full h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
        <p className="text-[11px] text-slate-400">Separe por vírgula. Ignora acento e maiúscula (olá = ola).</p>

        <div className="grid grid-cols-2 gap-2 pt-1">
          {([["contains", "Contém", "em qualquer parte"], ["exact", "Palavra exata", "a palavra inteira"]] as const).map(
            ([key, title, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => set({ keywordMatch: key })}
                className={`text-left p-2.5 rounded-lg border transition-colors ${
                  value.keywordMatch === key
                    ? "border-primary/30 bg-primary-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <p className="text-xs font-semibold text-slate-800">{title}</p>
                <p className="text-[10.5px] text-slate-500">{desc}</p>
              </button>
            ),
          )}
        </div>

        {value.keywords.length === 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50/70 border border-amber-200 rounded-lg px-2.5 py-1.5">
            Sem palavra, <strong>todo</strong> comentário recebe direct — inclusive “lindo 😍”.
            Prefira uma palavra que a pessoa precise digitar.
          </p>
        )}
      </section>

      {/* 3 · DIRECT */}
      <section className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Direct que a pessoa recebe</label>
        <textarea
          value={value.dm}
          onChange={(e) => set({ dm: e.target.value.slice(0, DM_MAX) })}
          rows={4}
          placeholder={'Oi! Vi seu comentário 🙌 Me responde aqui com "quero" que eu já te mando os valores.'}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
        <div className="flex items-start justify-between gap-2">
          {hint.tone !== "none" && (
            <p className={`text-[11px] ${hint.tone === "ok" ? "text-emerald-600" : "text-amber-600"}`}>
              {hint.tone === "ok" ? "✓ " : "⚠ "}{hint.msg}
            </p>
          )}
          {value.dm.length > 800 && (
            <span className="text-[11px] text-amber-600 tabular-nums shrink-0">{value.dm.length}/{DM_MAX}</span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          Você tem <strong>uma</strong> mensagem por comentário. O Instagram só deixa mandar outra
          depois que a pessoa responder.
        </p>
      </section>

      {/* 4 · RESPOSTA PÚBLICA */}
      <section className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Resposta pública no comentário</label>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
            recomendado
          </span>
        </div>

        {value.publicReplies.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={r}
              onChange={(e) => {
                const next = [...value.publicReplies]; next[i] = e.target.value; set({ publicReplies: next })
              }}
              placeholder="Te chamei no direct 👀"
              className="flex-1 h-9 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button type="button" onClick={() => set({ publicReplies: value.publicReplies.filter((_, j) => j !== i) })}
              className="size-9 grid place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}

        <button type="button" onClick={() => set({ publicReplies: [...value.publicReplies, ""] })}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
          <Plus className="size-3" /> Variação
        </button>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Quem ainda não te segue recebe o direct na aba <strong>Solicitações</strong>, que quase
          ninguém abre. Essa resposta é o que avisa a pessoa a ir lá olhar.
          {value.publicReplies.length > 1 && " Com variações, o Instagram não esconde por repetição."}
        </p>
      </section>

      {/* 5 · PRÉVIA */}
      {(value.dm.trim() || value.publicReplies.some(Boolean)) && (
        <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Prévia</p>

          <div className="text-xs">
            <p className="text-slate-700"><strong>maria.souza</strong> <span className="text-slate-400">agora</span></p>
            <p className="text-slate-600">quero saber o valor 😍</p>
            {value.publicReplies.some(Boolean) && (
              <p className="pl-4 mt-1 text-slate-600">
                ↳ <strong>{username ? `${username}` : "sua conta"}</strong> {value.publicReplies.find(Boolean)}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] uppercase tracking-wider text-slate-400">no direct</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap">
            {value.dm.trim() || "…"}
          </div>

          <p className={`text-[11px] ${value.publicReplies.some(Boolean) ? "text-slate-500" : "text-amber-600"}`}>
            {value.publicReplies.some(Boolean)
              ? "Quem não te segue vê essa mensagem em Solicitações — por isso a resposta pública importa."
              : "Sem resposta pública, quem não te segue provavelmente não vai ver o direct."}
          </p>
        </section>
      )}

      {/* 6 · REGRAS — fechado por padrão, o manual mora aqui */}
      <section>
        <button type="button" onClick={() => setShowRules((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600">
          <ChevronDown className={`size-3.5 transition-transform ${showRules ? "rotate-180" : ""}`} />
          Como o Instagram trata isso
        </button>
        {showRules && (
          <ul className="mt-2 space-y-1.5 text-[11px] text-slate-500 leading-relaxed pl-1">
            <li><strong>Uma mensagem por comentário.</strong> Depois dela, só dá pra escrever de novo se a pessoa responder.</li>
            <li><strong>Solicitações.</strong> Quem não te segue recebe o direct numa aba separada. A resposta pública é o que avisa.</li>
            <li><strong>7 dias.</strong> O direct precisa sair até 7 dias depois do comentário.</li>
            <li><strong>Nome e foto só depois.</strong> Quem só comentou entra na Kora com o @ — o Instagram libera nome e foto quando a pessoa responder.</li>
            <li><strong>Uma ferramenta por vez.</strong> Se você usa outra automação no mesmo perfil, a pessoa pode receber duas mensagens.</li>
          </ul>
        )}
      </section>

      <PostPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        username={username}
        selected={value.posts.map((p) => p.id)}
        onPick={onPick}
        multiple={value.posts.length > 1}
      />
    </div>
  )
}

function Thumb({ post, className = "" }: { post: IgPostRef; className?: string }) {
  return post.thumbUrl ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={post.thumbUrl} alt="" className={`rounded object-cover ${className}`} />
  ) : (
    <div className={`rounded bg-slate-100 grid place-items-center ${className}`}>
      <ImageIcon className="size-3.5 text-slate-300" />
    </div>
  )
}

function PostCard({ post }: { post: IgPostRef }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 flex gap-2.5">
      <Thumb post={post} className="size-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-700 line-clamp-2">{post.caption ?? "Sem legenda"}</p>
        <p className="text-[10.5px] text-slate-400 flex items-center gap-1.5 mt-0.5">
          {post.isReel && <><Play className="size-2.5" /> Reel ·</>}
          {post.timestamp ? new Date(post.timestamp).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : ""}
        </p>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noopener noreferrer"
            className="text-[10.5px] text-primary hover:underline inline-flex items-center gap-0.5 mt-0.5">
            Ver no Instagram <ExternalLink className="size-2.5" />
          </a>
        )}
      </div>
    </div>
  )
}
