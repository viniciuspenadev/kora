"use client"

// Preview fiel do que o cliente VÊ no WhatsApp pra um nó de opções (Menu/Agendar).
// Espelha o renderer do runtime (flow/interactive.ts): numerado vs botões (≤3) vs
// lista (4+). Toggle Oficial/QR mostra a diferença por canal — no QR (Baileys) não
// há interativo nativo, então cai SEMPRE pro numerado (igual ao fallback real).
// Tira a engine do escuro: o cliente não escreve o craft, mas enxerga a saída.

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import type { RenderMode } from "@/lib/ai-v2/flow/types"

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

export function WhatsAppPreview({
  render = "auto", body, items, last, listButton = "Ver opções", note,
}: {
  render?: RenderMode
  body: string
  items: string[]
  last?: string
  listButton?: string
  note?: string
}) {
  const [channel, setChannel] = useState<"official" | "qr">("official")

  const all = last ? [...items, last] : items
  // Veículo EFETIVO: QR sempre numerado; Oficial respeita render (numbered força texto).
  const interactive = channel === "official" && render !== "numbered" && items.length > 0
  const asButtons = interactive && all.length <= 3

  const numbered = [
    body.trim(),
    "",
    ...items.map((o, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${o}`),
    ...(last ? [`0️⃣ ${last}`] : []),
  ].join("\n")

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
              // ── Botões de resposta (≤3) ──
              <div className="space-y-1">
                {all.map((label, i) => (
                  <div key={i} className="bg-white rounded-lg py-2 text-center text-[12.5px] font-medium text-[#00a5f4] shadow-sm">
                    {label}
                  </div>
                ))}
              </div>
            ) : (
              // ── Lista (4+) ──
              <div className="bg-white rounded-lg py-2 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-[#00a5f4] shadow-sm">
                <ChevronDown className="size-3.5" /> {listButton}
              </div>
            )}
            {!asButtons && (
              <div className="rounded-lg border border-slate-200 bg-white/70 divide-y divide-slate-100">
                {all.map((label, i) => (
                  <div key={i} className="px-3 py-1.5 text-[11.5px] text-slate-600">{label}</div>
                ))}
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
