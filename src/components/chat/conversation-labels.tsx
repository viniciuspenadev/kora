"use client"

import { Popover } from "@base-ui/react/popover"
import { X } from "lucide-react"
import { lifecycleMeta } from "@/lib/lifecycle"

type ContactTag = { id: string; name: string; color: string }

/** One compact line; additional labels float outside the scrolling Inbox list. */
export function ConversationLabels({ classification, tags }: { classification?: string | null; tags: ContactTag[] }) {
  const stage = classification === "won" ? "customer" : classification === "lost" ? "lead" : classification
  const lifecycle = stage && stage !== "contact" ? lifecycleMeta(stage) : null
  const [first, ...remaining] = tags
  if (!lifecycle && !first) return null

  return <div className="mt-2 flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap text-[11px]">
    {lifecycle && <span className={`inline-flex shrink-0 items-center rounded border border-transparent px-1.5 text-[10px] leading-4 font-medium ${lifecycle.bg} ${lifecycle.text}`}>{lifecycle.label}</span>}
    {first && <span title={first.name} className="inline-flex min-w-0 max-w-[140px] items-center rounded border px-1.5 text-[10px] leading-4 font-medium" style={{ backgroundColor: first.color + "20", color: first.color, borderColor: first.color + "30" }}><span className="truncate">{first.name}</span></span>}
    {remaining.length > 0 && <Popover.Root>
      <Popover.Trigger openOnHover delay={180} closeDelay={160}
        aria-label={`Ver mais ${remaining.length} etiqueta${remaining.length === 1 ? "" : "s"}`}
        onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
        className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 font-semibold text-slate-500 hover:bg-primary-50 hover:text-primary data-open:bg-primary-50 data-open:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        +{remaining.length}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={12} className="z-[65]">
          <Popover.Popup onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}
            className="w-64 max-w-[calc(100vw-24px)] rounded-xl border border-slate-200 bg-white p-3 text-slate-700 shadow-lg outline-none">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Popover.Title className="text-xs font-semibold">Mais etiquetas</Popover.Title>
              <Popover.Close aria-label="Fechar etiquetas" className="inline-flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-3.5" /></Popover.Close>
            </div>
            <ul className="max-h-52 space-y-1 overflow-y-auto">
              {remaining.map(tag => <li key={tag.id} className="rounded-md px-2 py-1.5 text-[11px]" style={{ backgroundColor: tag.color + "20", color: tag.color }}><span className="whitespace-normal break-words">{tag.name}</span></li>)}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>}
  </div>
}
