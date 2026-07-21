import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 pt-10 pb-6">
        <div className="h-4 w-24 rounded bg-slate-200 animate-pulse mb-4" />
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-xl bg-slate-200 animate-pulse shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="h-7 w-56 rounded bg-slate-200 animate-pulse" />
            <div className="h-3 w-40 rounded bg-slate-100 animate-pulse mt-2" />
          </div>
        </div>
      </div>
      <div className="px-4 sm:px-6">
        <div className="h-9 w-72 rounded bg-slate-100 animate-pulse border-b border-slate-200" />
      </div>
      <div className="px-4 sm:px-6 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 grid place-items-center min-h-[300px]">
          <Loader2 className="size-5 animate-spin text-slate-300" />
        </div>
      </div>
    </div>
  )
}
