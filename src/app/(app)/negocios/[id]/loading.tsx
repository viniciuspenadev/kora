import { Pulse } from "@/components/ui/page-skeleton"

// Mirrors the approved detail: canvas header, stage strip, tabbed work and one sidebar.
export default function Loading() {
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-canvas px-4 py-5 sm:px-6 sm:py-6" aria-label="Carregando negócio">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Pulse className="size-8 rounded-lg" />
          <div className="space-y-2 flex-1">
            <Pulse className="h-4 w-56" />
            <Pulse className="h-2.5 w-40" />
          </div>
          <Pulse className="h-8 w-24" />
          <Pulse className="h-8 w-24" />
        </div>
        <Pulse className="h-9" />
        <Pulse className="h-24 rounded-xl" />
      </div>
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="space-y-4">
          <Pulse className="h-36 rounded-xl" />
          <Pulse className="h-[420px] rounded-xl" />
        </div>
        <div className="space-y-4">
          <Pulse className="h-[520px] rounded-xl" />
        </div>
      </div>
    </div>
  )
}
