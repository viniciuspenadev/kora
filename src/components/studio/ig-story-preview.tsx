"use client"

import { Heart, Send, ChevronLeft, Info, User } from "lucide-react"
import { SourceLogo } from "@/components/chat/source-logo"

/**
 * Prévia do gatilho **"respondeu seu story"**.
 *
 * 🔴 Por que a prévia daqui é DIFERENTE da do comentário: lá o momento decisivo é a bala
 *    única (uma mensagem e acabou); aqui a resposta da pessoa **já abre a conversa**. Então
 *    o que precisa ficar claro na tela é o oposto — não "cuidado, é sua única chance", e sim
 *    "a partir daqui o fluxo conversa à vontade".
 *
 * ⚠️ Story é vertical (9:16) e tem a barra de progresso no topo. Copiar o quadrado do post
 *    faria a prévia parecer feed, não story — e a pessoa não reconheceria a própria tela.
 */

export type StoryPreviewFocus = "story" | "direct"

export interface IgStoryPreviewData {
  thumbUrl?:  string | null
  keyword:    string | null
  autoReact:  boolean
  username?:  string | null
}

export function IgStoryPreview({ data, focus = "story" }: { data: IgStoryPreviewData; focus?: StoryPreviewFocus }) {
  const handle = data.username ? `@${data.username}` : "sua conta"
  const resposta = data.keyword?.trim() || "…"

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 inline-flex items-center gap-1 rounded-lg bg-white/70 p-0.5 text-[11px] font-semibold ring-1 ring-slate-200">
        {([["story", "1 · No story"], ["direct", "2 · Na conversa"]] as const).map(([k, label]) => (
          <span key={k} className={`flex-1 h-7 grid place-items-center rounded-md transition-colors ${
            focus === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
            {label}
          </span>
        ))}
      </div>

      <div className="flex-1 min-h-0 rounded-2xl border border-slate-300/70 bg-white shadow-sm overflow-hidden flex flex-col">
        {focus === "story" ? (
          /* ── O story, como o cliente final vê ── */
          <div className="relative flex-1 min-h-0 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900">
            {data.thumbUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={data.thumbUrl} alt="" className="absolute inset-0 size-full object-cover opacity-90" />
            )}
            {/* Barra de progresso — é o que faz o olho reconhecer "isso é um story". */}
            <div className="absolute top-2 inset-x-2 flex gap-1">
              <span className="h-0.5 flex-1 rounded-full bg-white/70" />
              <span className="h-0.5 flex-1 rounded-full bg-white/25" />
            </div>
            <div className="absolute top-4 inset-x-2.5 flex items-center gap-1.5">
              <span className="size-5 rounded-full bg-white/25 ring-1 ring-white/40" />
              <span className="text-[10px] font-semibold text-white drop-shadow">{handle}</span>
            </div>

            {/* Resposta da pessoa, no campo do story */}
            <div className="absolute inset-x-2.5 bottom-2.5">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 rounded-full border border-white/50 bg-black/25 px-3 py-1.5 backdrop-blur-sm">
                  <p className="truncate text-[10px] text-white">{resposta}</p>
                </div>
                {/* ❤️ só aparece quando o recurso está ligado — a prévia não promete o que
                    não vai acontecer. */}
                <Heart className={`size-4 shrink-0 transition-colors ${
                  data.autoReact ? "fill-red-500 text-red-500" : "text-white/60"}`} />
                <Send className="size-4 shrink-0 text-white/60" />
              </div>
              {data.autoReact && (
                <p className="mt-1.5 text-center text-[9px] font-medium text-white/80">
                  a Kora curte a resposta na hora
                </p>
              )}
            </div>
          </div>
        ) : (
          /* ── A conversa que nasce dali ── */
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
              <ChevronLeft className="size-4 shrink-0 text-slate-400" />
              <span className="size-6 shrink-0 grid place-items-center rounded-full bg-slate-200 text-slate-400">
                <User className="size-3" strokeWidth={2.2} />
              </span>
              <p className="text-[11px] font-semibold text-slate-700 truncate">cliente</p>
              <SourceLogo source="instagram" size={14} className="ml-auto shrink-0 opacity-60" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-slate-50/60">
              <p className="text-center text-[9px] text-slate-400">respondeu ao seu story</p>
              <div className="flex justify-end">
                <div className="relative max-w-[80%] rounded-2xl rounded-tr-sm bg-primary/10 px-3 py-2">
                  <p className="text-[11px] leading-snug text-slate-700 break-words">{resposta}</p>
                  {data.autoReact && (
                    <span className="absolute -bottom-1.5 -left-1.5 grid size-4 place-items-center rounded-full bg-white shadow-sm">
                      <Heart className="size-2.5 fill-red-500 text-red-500" />
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <span className="size-6 shrink-0 rounded-full bg-slate-200" />
                <div className="rounded-2xl rounded-tl-sm border border-dashed border-slate-300 bg-white px-3 py-2">
                  <p className="text-[11px] italic text-slate-400">o fluxo assume daqui</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-500">
        <Info className="size-3 shrink-0 mt-px" />
        Responder um story já abre a conversa — aqui não existe bala única. O fluxo pode falar
        quantas vezes precisar.
      </p>
    </div>
  )
}
