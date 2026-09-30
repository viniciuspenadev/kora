import { Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      {/* Cabeçalho branco: identidade + tira de KPIs */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-5">
        <div className="flex items-start gap-3.5">
          <Pulse className="size-8 rounded-lg shrink-0" />
          <Pulse className="size-11 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Pulse className="h-6 w-56" />
            <Pulse className="h-3 w-72" />
          </div>
          <Pulse className="h-9 w-20 rounded-lg shrink-0" />
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Pulse className="h-2.5 w-20" />
              <Pulse className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Corpo: main + rail */}
      <div className="px-4 sm:px-6 py-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div className="space-y-4">
          <Pulse className="h-56 rounded-xl" />
          <Pulse className="h-48 rounded-xl" />
        </div>
        <Pulse className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
