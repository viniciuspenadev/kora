import { AnalyticHeaderSkeleton, DashboardSkeletonBody } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <AnalyticHeaderSkeleton />
      <DashboardSkeletonBody />
    </div>
  )
}
