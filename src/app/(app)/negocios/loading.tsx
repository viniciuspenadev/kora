import { BoardSkeleton, Pulse } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-canvas overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3">
        <Pulse className="h-8 w-44" />
        <Pulse className="h-5 w-24" />
        <Pulse className="h-8 w-28 ml-auto" />
      </div>
      <BoardSkeleton cols={5} />
    </div>
  )
}
