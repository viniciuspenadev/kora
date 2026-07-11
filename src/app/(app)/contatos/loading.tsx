import { HeaderSkeleton, TableSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <HeaderSkeleton />
      <TableSkeleton rows={10} />
    </div>
  )
}
