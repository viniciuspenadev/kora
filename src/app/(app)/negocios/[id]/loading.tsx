import { Pulse } from "@/components/ui/page-skeleton"

// Casca do detalhe do negócio: header de comando + stepper + régua + corpo 2 colunas.
export default function Loading() {
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-canvas">
      <div className="bg-white border-b border-slate-200 px-6 pt-4 pb-4 space-y-4">
        <div className="flex items-center gap-3">
          <Pulse className="size-8 rounded-lg" />
          <Pulse className="size-11 rounded-full" />
          <div className="space-y-2 flex-1">
            <Pulse className="h-4 w-56" />
            <Pulse className="h-2.5 w-40" />
          </div>
          <Pulse className="h-8 w-24" />
          <Pulse className="h-8 w-24" />
        </div>
        <Pulse className="h-10" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => <Pulse key={i} className="h-14 rounded-xl" />)}
        </div>
      </div>
      <div className="px-6 py-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <div className="space-y-4">
          <Pulse className="h-16 rounded-2xl" />
          <Pulse className="h-44 rounded-2xl" />
          <Pulse className="h-64 rounded-2xl" />
        </div>
        <div className="space-y-4">
          <Pulse className="h-40 rounded-2xl" />
          <Pulse className="h-32 rounded-2xl" />
          <Pulse className="h-32 rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
