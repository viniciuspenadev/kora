import { AnalyticHeaderSkeleton, DashboardSkeletonBody } from "@/components/ui/page-skeleton"

// Skeleton casado com o header analítico (§2.1) — o do header PRECISA ser o
// AnalyticHeaderSkeleton (não o da barra branca), senão pula na transição.
export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <AnalyticHeaderSkeleton />
      <DashboardSkeletonBody />
    </div>
  )
}
