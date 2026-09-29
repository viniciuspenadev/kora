import { ListHeaderSkeleton, Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <ListHeaderSkeleton />
      <div className="px-4 sm:px-6 pb-6 space-y-4">
        <Pulse className="h-56 rounded-xl" />
        <Pulse className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
