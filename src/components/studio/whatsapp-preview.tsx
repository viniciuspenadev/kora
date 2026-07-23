"use client"

// Preview fiel do que o cliente VÊ no WhatsApp pra um nó de opções (Menu/Agendar).
// Espelha o renderer do runtime (flow/interactive.ts) INCLUSIVE os limites da Meta:
// botões só se ≤3 E títulos ≤20 E sem grupos; lista se ≤10 E títulos ≤24 (com
// SEÇÕES por grupo); senão degrada pro numerado — nunca corta. Toggle Oficial/QR:
// no QR (Baileys) não há interativo nativo → sempre numerado (igual ao real).

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { RenderMode } from "@/lib/ai-v2/flow/types"

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

/** Item do preview: string simples ou { title, group } (grupo = seção da lista). */
export type PreviewItem = string | { title: string; group?: string }

export function WhatsAppPreview({
  render = "auto", body, items, last, listButton = "Ver opções", note,
}: {
  render?: RenderMode
  body: string
  items: PreviewItem[]
  last?: string
  listButton?: string
  note?: string
}) {
  const [channel, setChannel] = useState<"official" | "qr">("official")

  const norm = items.map((o) => (typeof o === "string" ? { title: o } : o))
  const allTitles = last ? [...norm.map((o) => o.title), last] : norm.map((o) => o.title)
  const maxTitle = allTitles.length ? Math.max(...allTitles.map((t) => t.length)) : 0
  const grouped = norm.some((o) => o.group)

  // Veículo EFETIVO — MESMAS regras da boca (flow/interactive.ts): fidelidade primeiro.
  const wantsInteractive = channel === "official" && render !== "numbered" && norm.length > 0
  const fitsButtons = wantsInteractive && allTitles.length <= 3 && maxTitle <= 20 && !grouped
  const fitsList    = wantsInteractive && allTitles.length <= 10 && maxTitle <= 24
  const interactive = fitsButtons || fitsList
  const asButtons   = fitsButtons

  const numberedLines: string[] = [body.trim(), ""]
  {
    let g: string | undefined
    norm.forEach((o, i) => {
      if (o.group && o.group !== g) { g = o.group; numberedLines.push(`— ${g} —`) }
      numberedLines.push(`${NUM_EMOJI[i] ?? `${i + 1}.`} ${o.title}`)
    })
  }
  if (last) numberedLines.push(`0️⃣ ${last}`)
  const numbered = numberedLines.join("\n")

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pré-visualização</span>
        <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
          {(["official", "qr"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                channel === c ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {c === "official" ? "Oficial (Meta)" : "QR (não-oficial)"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-1.5" style={{ background: "#e9edef" }}>
        {!interactive ? (
          // ── Bolha numerada (texto) ──
          <Bubble>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-800">{numbered}</p>
          </Bubble>
        ) : (
          <>
            <Bubble>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-800">{body.trim()}</p>
            </Bubble>
            {asButtons ? (
              // ── Botões de resposta (≤3, títulos ≤20) ──
              <div className="space-y-1">
                {allTitles.map((label, i) => (
                  <div key={i} className="bg-white rounded-lg py-2 text-center text-[12.5px] font-medium text-[#00a5f4] shadow-sm">
                    {label}
                  </div>
                ))}
              </div>
            ) : (
              // ── Lista (≤10, títulos ≤24) ──
              <div className="bg-white rounded-lg py-2 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-[#00a5f4] shadow-sm">
                <ChevronDown className="size-3.5" /> {listButton}
              </div>
            )}
            {!asButtons && (
              <div className="rounded-lg border border-slate-200 bg-white/70">
                {norm.map((o, i) => (
                  <div key={i}>
                    {o.group && o.group !== norm[i - 1]?.group && (
                      <p className="px-3 pt-1.5 pb-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60">{o.group}</p>
                    )}
                    <div className="px-3 py-1.5 text-[11.5px] text-slate-600 border-t border-slate-100 first:border-t-0">{o.title}</div>
                  </div>
                ))}
                {last && <div className="px-3 py-1.5 text-[11.5px] text-slate-600 border-t border-slate-100">{last}</div>}
              </div>
            )}
          </>
        )}
      </div>

      {(note || channel === "qr") && (
        <p className="px-3 py-1.5 text-[10.5px] text-slate-400 bg-slate-50 border-t border-slate-100">
          {channel === "qr"
            ? "No WhatsApp não-oficial (QR) não há botões nativos — o cliente responde com o número."
            : note}
        </p>
      )}
    </div>
  )
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative max-w-[85%] bg-white rounded-lg rounded-tl-none px-2.5 py-1.5 shadow-sm">
      {children}
    </div>
  )
}
