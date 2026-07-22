import { ListHeaderSkeleton, Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <ListHeaderSkeleton />
      <div className="px-4 sm:px-6 pb-6">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* busca + botão de tags */}
          <div className="p-4 flex items-center gap-3">
            <Pulse className="h-9 flex-1" />
            <Pulse className="h-9 w-24 rounded-lg" />
          </div>
          {/* abas de filtro (Todos · Com tags · Bloqueados…) */}
          <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100">
            {Array.from({ length: 4 }).map((_, i) => <Pulse key={i} className="h-7 w-24 rounded-lg" />)}
          </div>
          {/* linhas de contato */}
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Pulse className="size-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Pulse className="h-3 w-1/3" />
                  <Pulse className="h-2 w-1/4" />
                </div>
                <div className="hidden lg:flex items-center gap-2">
                  <Pulse className="h-3 w-20" />
                  <Pulse className="h-3 w-16" />
                  <Pulse className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
