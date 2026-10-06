import { ListHeaderSkeleton, Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <ListHeaderSkeleton />
      <div className="px-4 sm:px-6 pb-6 space-y-4">
        {/* KPIs (ícone + número + rótulo) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <Pulse className="size-9 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Pulse className="h-5 w-10" />
                <Pulse className="h-2.5 w-20" />
              </div>
            </div>
          ))}
        </div>
        {/* barra de controle: navegação de data ← → · escopo + visão */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Pulse className="h-9 w-32 rounded-lg" />
            <Pulse className="h-4 w-40 hidden sm:block" />
          </div>
          <div className="flex items-center gap-2">
            <Pulse className="h-9 w-28 rounded-lg" />
            <Pulse className="h-9 w-56 rounded-lg" />
          </div>
        </div>
        {/* grade do calendário */}
        <Pulse className="h-[460px] rounded-xl" />
      </div>
    </div>
  )
}
