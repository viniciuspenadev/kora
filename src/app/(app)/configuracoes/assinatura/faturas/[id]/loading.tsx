import { Pulse } from "@/components/ui/page-skeleton"

// A fatura é documento, não seção com abas — o skeleton imita o documento:
// volta + título + os três blocos (pagar · quanto · por quê).
export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 py-6">
        <div className="max-w-3xl space-y-4">
          <Pulse className="h-3 w-20" />
          <div className="space-y-2.5 pb-1">
            <Pulse className="h-7 w-56" />
            <Pulse className="h-3 w-72" />
          </div>
          <Pulse className="h-36 rounded-xl" />
          <Pulse className="h-28 rounded-xl" />
          <Pulse className="h-72 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
