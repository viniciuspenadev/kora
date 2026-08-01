"use client"

import { useEffect, useState } from "react"
import { Heart, MessageCircle, Send, ChevronLeft, Info } from "lucide-react"
import { SourceLogo } from "@/components/chat/source-logo"

/**
 * Prévia do que o CLIENTE FINAL recebe — comentário no post + direct.
 * Desenho: docs/studio-config-modal-design.md §3.
 *
 * 🔴 AS TRÊS REGRAS QUE A MANTÊM HONESTA:
 *   1. **Reflete a config REAL.** Digitou "orçamento", aparece "orçamento". Exemplo
 *      genérico deixa de ser prévia e vira vídeo de vendas — e leva a confiança junto.
 *   2. **Silenciosa no que não sabe.** Sem post, quadro vazio; sem direct, bolha vazia.
 *   3. Nada de laço infinito: a folha de comentários abre uma vez, ao entrar na seção.
 *
 * 🔴 ELA SEGUE A SEÇÃO ATIVA (`focus`). Chegou na seção do direct, ela vira o direct;
 *    chegou na resposta pública, sobe a folha de comentários. Sem isso a pessoa digita
 *    numa coluna e tem que clicar na outra pra ver o efeito — que é o atrito que a prévia
 *    existe pra eliminar.
 *
 * 🔴 POR QUE MOSTRAR AS DUAS TELAS e não só o direct: é isso que comunica que acontecem
 *    DUAS coisas, e **por que a resposta pública existe** — ela manda quem não segue a
 *    conta olhar a aba Solicitações.
 *
 * ⚠️ A miniatura vem do proxy autenticado (`/api/ig-thumb/<id>`), nunca da URL de CDN da
 *    Meta — aquela expira em ~1-2 dias.
 */

export type PreviewFocus = "post" | "comments" | "direct"

export interface IgPreviewData {
  thumbUrl:    string | null
  keyword:     string | null
  dm:          string
  publicReply: string | null
  username?:   string | null
}

export function IgCommentPreview({ data, focus = "post" }: { data: IgPreviewData; focus?: PreviewFocus }) {
  const [tab, setTab] = useState<PreviewFocus>(focus)
  // A seção ativa MANDA — mas o clique manual continua valendo até a rolagem mudar de
  // seção de novo. Sem este efeito a prévia ignoraria a rolagem; sem o estado local,
  // clicar na aba não faria nada.
  useEffect(() => { setTab(focus) }, [focus])

  const handle  = data.username ? `@${data.username}` : "sua conta"
  const comment = data.keyword?.trim() || "…"

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 inline-flex items-center gap-1 rounded-lg bg-white/70 p-0.5 text-[11px] font-semibold ring-1 ring-slate-200">
        {([["post", "1 · No post"], ["direct", "2 · No direct"]] as const).map(([k, label]) => {
          // "comments" é uma variação do post — a aba do post fica acesa nas duas.
          const on = k === "post" ? tab !== "direct" : tab === "direct"
          return (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`flex-1 h-7 rounded-md transition-colors ${
                on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 rounded-2xl border border-slate-300/70 bg-white shadow-sm overflow-hidden flex flex-col relative">
        {tab === "direct"
          ? <DirectScreen data={data} handle={handle} />
          : <PostScreen data={data} comment={comment} handle={handle}
              sheet={tab === "comments"} onCloseSheet={() => setTab("post")} />}
      </div>

      <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-500">
        <Info className="size-3 shrink-0 mt-px" />
        {tab === "direct"
          ? "Uma resposta privada por comentário, e só dentro de 7 dias. Regra da Meta."
          : "A resposta pública avisa quem não segue a conta — pra essa pessoa o direct cai em Solicitações."}
      </p>
    </div>
  )
}

function PostScreen({ data, comment, handle, sheet, onCloseSheet }: {
  data: IgPreviewData; comment: string; handle: string; sheet: boolean; onCloseSheet: () => void
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
        <SourceLogo source="instagram" size={18} />
        <span className="text-[11px] font-semibold text-slate-700 truncate">{handle}</span>
      </div>

      <div className="aspect-square bg-slate-100 shrink-0">
        {data.thumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={data.thumbUrl} alt="Post selecionado" className="size-full object-cover" />
        ) : (
          <div className="size-full grid place-items-center text-[11px] text-slate-400">escolha o post</div>
        )}
      </div>

      <div className="flex items-center gap-3 px-3 py-2 text-slate-400 shrink-0">
        <Heart className="size-4" /><MessageCircle className="size-4" /><Send className="size-4" />
      </div>

      {/* 🔴 FOLHA DE COMENTÁRIOS — sobe por cima do post, como no Instagram de verdade.
          Entra quando a seção da resposta pública fica ativa. É o gesto que o app real faz,
          e é ele que faz a prévia parecer o Instagram em vez de um cartão de exemplo. */}
      <div className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-200 bg-white shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.25)] transition-transform duration-300 ease-out ${
        sheet ? "translate-y-0" : "translate-y-full"}`} style={{ maxHeight: "62%" }}>
        <button type="button" onClick={onCloseSheet} aria-label="Fechar comentários"
          className="w-full pt-2 pb-1 grid place-items-center">
          <span className="h-1 w-9 rounded-full bg-slate-300" />
        </button>
        <p className="px-3 pb-2 text-[11px] font-semibold text-slate-700 border-b border-slate-100">Comentários</p>

        <div className="px-3 py-2.5 space-y-2.5 overflow-y-auto" style={{ maxHeight: "calc(62vh - 60px)" }}>
          <div className="flex gap-2">
            <span className="size-6 shrink-0 rounded-full bg-slate-200" />
            <p className="text-[11px] leading-snug">
              <span className="font-semibold text-slate-700">cliente</span>{" "}
              <span className="text-slate-600">{comment}</span>
            </p>
          </div>
          {data.publicReply?.trim() ? (
            <div className="flex gap-2 pl-7">
              <span className="size-6 shrink-0 rounded-full bg-slate-800" />
              <p className="text-[11px] leading-snug">
                <span className="font-semibold text-slate-700">{handle}</span>{" "}
                <span className="text-slate-600">{data.publicReply}</span>
              </p>
            </div>
          ) : (
            <p className="pl-7 text-[11px] italic text-slate-300">escreva a resposta pública…</p>
          )}
        </div>
      </div>

      {/* Comentário resumido no rodapé do post, quando a folha está fechada. */}
      {!sheet && (
        <div className="px-3 pb-3 shrink-0">
          <p className="text-[11px] leading-snug">
            <span className="font-semibold text-slate-700">cliente</span>{" "}
            <span className="text-slate-600">{comment}</span>
          </p>
        </div>
      )}
    </>
  )
}

function DirectScreen({ data, handle }: { data: IgPreviewData; handle: string }) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
        <ChevronLeft className="size-4 text-slate-400" />
        <SourceLogo source="instagram" size={18} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-700 truncate">{handle}</p>
          <p className="text-[9px] text-slate-400">Instagram</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-slate-50/60">
        <p className="text-center text-[9px] text-slate-400">agora</p>
        <div className="flex gap-2">
          <span className="size-6 shrink-0 rounded-full bg-slate-800" />
          {/* `animate-in` da entrada: a bolha CHEGA, não aparece pronta — é o que dá a
              sensação de mensagem recebida ao vivo. */}
          <div key={data.dm} className="max-w-[80%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
            {data.dm.trim()
              ? <p className="text-[11px] leading-snug text-slate-700 whitespace-pre-wrap break-words">{data.dm}</p>
              : <p className="text-[11px] italic text-slate-300">escreva o direct…</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 shrink-0">
        <div className="flex-1 h-7 rounded-full bg-slate-100" />
        <Send className="size-4 text-slate-300" />
      </div>
    </>
  )
}
