import { HeaderSkeleton, Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <HeaderSkeleton />
      <div className="px-4 sm:px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Pulse key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Pulse className="xl:col-span-2 h-72 rounded-xl" />
          <Pulse className="h-72 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Pulse className="h-56 rounded-xl" />
          <Pulse className="h-56 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
