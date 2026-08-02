"use client"

import { useState } from "react"
import { Heart, MessageCircle, Send, ChevronLeft, Info, User } from "lucide-react"
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

/**
 * Foto de perfil da conta CONECTADA — vem de `/api/ig-avatar` (URL fixa, sem parâmetro;
 * o tenant sai da sessão). Sem conexão ou falha na Meta → 404 → cai na inicial do @.
 *
 * ⚠️ Círculo chapado escuro NÃO serve de avatar: a prévia inteira depende de parecer o
 *    Instagram, e mancha preta parece defeito. Fallback é a inicial num degradê suave.
 */
function AccountAvatar({ handle, size = 28, ring }: { handle: string; size?: number; ring?: boolean }) {
  const [failed, setFailed] = useState(false)
  const letter = handle.replace("@", "").charAt(0).toUpperCase() || "K"
  const box = { width: size, height: size }

  if (failed) {
    return (
      <span style={box}
        className={`shrink-0 grid place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 font-semibold text-white ${
          ring ? "ring-2 ring-white/70" : ""}`}>
        <span style={{ fontSize: Math.round(size * 0.42) }}>{letter}</span>
      </span>
    )
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src="/api/ig-avatar" alt="" onError={() => setFailed(true)} style={box}
      className={`shrink-0 rounded-full object-cover bg-slate-200 ${ring ? "ring-2 ring-white/70" : ""}`} />
  )
}

/** Quem comenta é desconhecido — silhueta neutra, nunca um disco preto. */
function PersonAvatar({ size = 28, dark }: { size?: number; dark?: boolean }) {
  return (
    <span style={{ width: size, height: size }}
      className={`shrink-0 grid place-items-center rounded-full ${
        dark ? "bg-white/10 text-white/45" : "bg-slate-200 text-slate-400"}`}>
      <User style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </span>
  )
}

export interface IgPreviewData {
  thumbUrl:    string | null
  keyword:     string | null
  dm:          string
  /** Imagem do cartão (URL opaca `/api/card-image/...`). */
  dmImage?:    string | null
  /** Rótulos dos botões — a prévia mostra o que a pessoa vai TOCAR. */
  dmButtons?:  string[]
  publicReply: string | null
  username?:   string | null
}

export function IgCommentPreview({ data, focus = "post" }: { data: IgPreviewData; focus?: PreviewFocus }) {
  // O campo em FOCO manda — mas o clique manual na aba continua valendo até a pessoa
  // focar outro campo. Ajuste-durante-render (não `useEffect`): trocar estado dentro de
  // efeito causa render em cascata e o lint reprova, com razão.
  const [tab, setTab] = useState<PreviewFocus>(focus)
  const [seen, setSeen] = useState<PreviewFocus>(focus)
  if (seen !== focus) { setSeen(focus); setTab(focus) }

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
        <AccountAvatar handle={handle} size={26} />
        <span className="text-[11px] font-semibold text-slate-700 truncate">{handle}</span>
        <SourceLogo source="instagram" size={14} className="ml-auto shrink-0 opacity-60" />
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

      {/* Escurecimento do post quando a folha sobe — é o que o Instagram faz e é o que
          separa as duas camadas. Sem ele a folha "flutua" sem contexto. */}
      <div className={`absolute inset-0 bg-black transition-opacity duration-300 pointer-events-none ${
        sheet ? "opacity-40" : "opacity-0"}`} />

      {/* 🔴 FOLHA DE COMENTÁRIOS — ESCURA, como o app real (referência do dono). Ela sobe
          por cima do post; é o gesto do Instagram que faz a prévia parecer o Instagram e
          não um cartão de exemplo. */}
      <div className={`absolute inset-x-0 bottom-0 rounded-t-2xl bg-[#181818] text-white shadow-[0_-10px_30px_-8px_rgba(0,0,0,0.6)] transition-transform duration-300 ease-out ${
        sheet ? "translate-y-0" : "translate-y-full"}`} style={{ height: "60%" }}>
        <button type="button" onClick={onCloseSheet} aria-label="Fechar comentários"
          className="w-full pt-2.5 pb-2 grid place-items-center">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </button>
        <p className="pb-2.5 text-center text-[13px] font-semibold">Comentários</p>

        <div className="px-3.5 pb-3 space-y-3.5 overflow-y-auto" style={{ maxHeight: "calc(100% - 62px)" }}>
          {/* Comentário do cliente: avatar · @ + tempo · texto abaixo · "Responder" —
              a mesma anatomia do app. */}
          <div className="flex gap-2.5">
            <PersonAvatar size={28} dark />
            <div className="min-w-0 flex-1">
              <p className="text-[11px]">
                <span className="font-semibold">cliente</span>
                <span className="ml-1.5 text-white/40">agora</span>
              </p>
              <p className="mt-0.5 text-[12px] leading-snug break-words">{comment}</p>
              <p className="mt-1 text-[10px] font-medium text-white/40">Responder</p>

              {/* A resposta da conta entra recuada dentro do fio, como uma resposta real. */}
              {data.publicReply?.trim() ? (
                <div className="mt-2.5 flex gap-2">
                  <AccountAvatar handle={handle} size={24} />
                  <div className="min-w-0">
                    <p className="text-[11px]">
                      <span className="font-semibold">{handle.replace("@", "")}</span>
                      <span className="ml-1.5 text-white/40">agora</span>
                    </p>
                    <p className="mt-0.5 text-[12px] leading-snug break-words">{data.publicReply}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-2.5 pl-8 text-[11px] italic text-white/30">escreva a resposta pública…</p>
              )}
            </div>
          </div>
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

/**
 * A bolha do direct. Vira CARTÃO quando há imagem ou botão — que é o formato real que a
 * Meta entrega (`generic`/`button template`), não uma licença poética da prévia.
 *
 * 🔴 Mostrar o botão aqui é o ponto pedagógico da tela inteira: é olhando pra ele que a
 *    pessoa entende que o direct não é um recado, é uma PORTA.
 */
function DirectBubble({ data }: { data: IgPreviewData }) {
  const btns = (data.dmButtons ?? []).filter((b) => b.trim())
  const rich = !!data.dmImage || btns.length > 0

  if (!rich) {
    return (
      <div key={data.dm} className="max-w-[80%] rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        {data.dm.trim()
          ? <p className="text-[11px] leading-snug text-slate-700 whitespace-pre-wrap break-words">{data.dm}</p>
          : <p className="text-[11px] italic text-slate-300">escreva o direct…</p>}
      </div>
    )
  }

  return (
    <div key={`${data.dm}|${data.dmImage}|${btns.join("|")}`}
      className="max-w-[85%] overflow-hidden rounded-2xl rounded-tl-sm border border-slate-200 bg-white animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {data.dmImage && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={data.dmImage} alt="" className="w-full aspect-[1.91/1] object-cover bg-slate-100" />
      )}
      <div className="px-3 py-2">
        {data.dm.trim()
          ? <p className="text-[11px] leading-snug text-slate-700 whitespace-pre-wrap break-words">{data.dm}</p>
          : <p className="text-[11px] italic text-slate-300">escreva o direct…</p>}
      </div>
      {btns.map((b, i) => (
        <div key={i} className="border-t border-slate-100 py-2 text-center text-[11px] font-semibold text-[#0095f6]">
          {b}
        </div>
      ))}
    </div>
  )
}

function DirectScreen({ data, handle }: { data: IgPreviewData; handle: string }) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 shrink-0">
        <ChevronLeft className="size-4 shrink-0 text-slate-400" />
        <AccountAvatar handle={handle} size={26} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-700 truncate">{handle}</p>
          <p className="text-[9px] text-slate-400">Instagram</p>
        </div>
        <SourceLogo source="instagram" size={14} className="ml-auto shrink-0 opacity-60" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-slate-50/60">
        <p className="text-center text-[9px] text-slate-400">agora</p>
        <div className="flex gap-2">
          <AccountAvatar handle={handle} size={24} />
          {/* `animate-in` da entrada: a bolha CHEGA, não aparece pronta — é o que dá a
              sensação de mensagem recebida ao vivo. */}
          <DirectBubble data={data} />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 shrink-0">
        <div className="flex-1 h-7 rounded-full bg-slate-100" />
        <Send className="size-4 text-slate-300" />
      </div>
    </>
  )
}
