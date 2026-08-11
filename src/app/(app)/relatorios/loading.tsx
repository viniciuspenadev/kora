import { Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        {/* título + filtros à direita */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="space-y-2.5">
            <Pulse className="h-7 w-40" />
            <Pulse className="h-3 w-72" />
          </div>
          <div className="flex items-center gap-2">
            <Pulse className="h-9 w-32 rounded-lg" />
            <Pulse className="h-9 w-44 rounded-lg" />
          </div>
        </div>
        {/* abas */}
        <div className="flex items-center gap-1 mb-6 border-b border-slate-200 pb-2">
          {Array.from({ length: 6 }).map((_, i) => <Pulse key={i} className="h-5 w-20 mx-2" />)}
        </div>
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {Array.from({ length: 6 }).map((_, i) => <Pulse key={i} className="h-24 rounded-xl" />)}
        </div>
        {/* gráficos */}
        <div className="space-y-4">
          <Pulse className="h-72 rounded-xl" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Pulse className="h-56 rounded-xl" />
            <Pulse className="h-56 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
