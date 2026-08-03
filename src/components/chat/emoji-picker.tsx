"use client"

import { useState, useMemo } from "react"
import { Search } from "lucide-react"

const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  {
    label: "Mais usados",
    emojis: ["👍","🙏","🙂","😊","❤️","🔥","✅","💪","🎉","👏","💯","🚀","📦","💰","📞","📧"],
  },
  {
    label: "Sentimentos",
    emojis: ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","🙂","😍","🥰","😘","😗","😙","😚","😋","😛","😜","🤪","🤩","🥳","😎","🤓","🧐","🤔","🤨","😐","😑","😶","🙄","😏","😒","😕","🙁","😔","😟","😞","😢","😭","😤","😠","😡","🤬","🤯","😳","🥺","😱","😨","😰","😥","😓","🤗","🤭","🤫","🥱","😴","🤤"],
  },
  {
    label: "Gestos",
    emojis: ["👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤝","🙏","🤲","👐","🙌","👏","🤜","🤛","✊","👊","💪","🦾","🦿","👀","👁️","👂","👃","👅","👄","🧠"],
  },
  {
    label: "Comércio",
    emojis: ["💰","💵","💴","💶","💷","💸","💳","🧾","📊","📈","📉","📦","📫","📬","📭","📮","📋","📝","✏️","📌","📍","📎","🖇️","📂","📁","🗂️","📅","📆","📇","🗃️","🗄️","🗑️","🔒","🔓","🔑","🛒","🛍️","🏷️","🎁","🎀"],
  },
  {
    label: "Comunicação",
    emojis: ["📞","☎️","📱","📲","💬","💭","🗨️","🗯️","💌","📧","📨","📩","📤","📥","✉️","📰","📢","📣","🔔","🔕","🔇","🔈","🔉","🔊"],
  },
  {
    label: "Símbolos",
    emojis: ["✅","☑️","✔️","❌","❎","⭕","🚫","⛔","📛","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","💯","🔥","💥","💦","💨","🎉","🎊","✨","⭐","🌟","💫","💢","💤","❓","❔","❗","❕","‼️","⚠️","⚡","🆗","🆕","🆒","🆓","🔝","🔚","🔛","🔜","🔙"],
  },
]

interface Props {
  onSelect: (emoji: string) => void
  onClose:  () => void
}

export function EmojiPicker({ onSelect, onClose }: Props) {
  const [search, setSearch] = useState("")
  const [active, setActive] = useState(0)

  const allEmojis = useMemo(() => EMOJI_GROUPS.flatMap((g) => g.emojis), [])

  const filtered = useMemo(() => {
    if (!search.trim()) return null
    return Array.from(new Set(allEmojis))
  }, [search, allEmojis])

  const group = EMOJI_GROUPS[active]
  const emojis = filtered ?? group.emojis

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg w-80 overflow-hidden flex flex-col">
      <div className="p-2 border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            autoFocus
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
          />
        </div>
      </div>

      {!filtered && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 overflow-x-auto">
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.label}
              onClick={() => setActive(i)}
              className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                active === i ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-8 gap-0.5 p-2 max-h-56 overflow-y-auto">
        {emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => { onSelect(e); onClose() }}
            className="size-8 flex items-center justify-center text-lg rounded-md hover:bg-slate-100 transition-colors"
            title={e}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
