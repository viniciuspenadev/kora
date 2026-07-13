import { Pulse } from "@/components/ui/page-skeleton"

// Casca do inbox: lista de conversas + painel de chat (duas colunas full-height).
export default function Loading() {
  return (
    <div className="h-[calc(100dvh-3.5rem)] flex overflow-hidden bg-white">
      <div className="w-80 shrink-0 border-r border-slate-200 p-3 space-y-2">
        <Pulse className="h-9" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-2 py-2">
            <Pulse className="size-10 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Pulse className="h-3 w-2/3" />
              <Pulse className="h-2.5 w-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 grid place-items-center bg-slate-50/50">
        <Pulse className="size-16 rounded-2xl" />
      </div>
    </div>
  )
}
