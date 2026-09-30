"use client"

import { useSearchParams } from "next/navigation"
import { BoardSkeleton, Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  const list = useSearchParams().get("view") === "list"
  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-canvas overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3">
        <Pulse className="h-8 w-44" />
        <Pulse className="h-5 w-24" />
        <Pulse className="h-8 w-28 ml-auto" />
      </div>
      {list ? <div className="space-y-4 px-4 py-5 sm:px-6 sm:py-6" aria-label="Carregando lista de negócios">
        <div className="space-y-2"><Pulse className="h-6 w-60" /><Pulse className="h-4 w-72 max-w-full" /></div>
        <div className="flex gap-3"><Pulse className="h-9 flex-1" /><Pulse className="h-9 w-24" /></div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex gap-3 border-b border-slate-200 p-4"><Pulse className="h-6 w-20" /><Pulse className="h-6 w-20" /><Pulse className="h-6 w-20" /></div>
          <div className="divide-y divide-slate-100">{Array.from({ length: 6 }, (_, i) => <div key={i} className="flex gap-5 p-5"><div className="flex-1 space-y-2"><Pulse className="h-4 w-2/3" /><Pulse className="h-3 w-1/2" /></div><Pulse className="h-6 w-20" /><Pulse className="hidden h-4 w-32 md:block" /></div>)}</div>
        </div>
      </div> : <BoardSkeleton cols={5} />}
    </div>
  )
}
