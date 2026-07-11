// ═══════════════════════════════════════════════════════════════
// Skeletons de navegação (loading.tsx) — a casca aparece em <100ms
// enquanto o server streama os dados. Peças puras (divs + pulse),
// zero fetch, zero client JS.
// ═══════════════════════════════════════════════════════════════

export function Pulse({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />
}

/** Header padrão do PageShell (ícone + título + subtítulo). */
export function HeaderSkeleton() {
  return (
    <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-5">
      <div className="flex items-center gap-3">
        <Pulse className="size-10 rounded-xl" />
        <div className="space-y-2">
          <Pulse className="h-4 w-44" />
          <Pulse className="h-2.5 w-72" />
        </div>
      </div>
    </div>
  )
}

/** Tabela genérica (toolbar + linhas). */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Pulse className="h-9 w-56" />
        <Pulse className="h-9 w-72" />
        <Pulse className="h-9 w-36 ml-auto" />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Pulse className="size-8 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Pulse className="h-3 w-1/3" />
              <Pulse className="h-2 w-1/4" />
            </div>
            <Pulse className="h-3 w-20" />
            <Pulse className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Board de colunas (pipeline/kanban). */
export function BoardSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <div className="px-4 sm:px-6 py-5 flex gap-3 overflow-hidden">
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="w-72 shrink-0 space-y-2">
          <Pulse className="h-9 rounded-xl" />
          {Array.from({ length: 3 - (i % 2) }).map((_, j) => (
            <div key={j} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Pulse className="size-8 rounded-full shrink-0" />
                <Pulse className="h-3 flex-1" />
              </div>
              <Pulse className="h-2.5 w-2/3" />
              <Pulse className="h-2.5 w-1/3" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Página genérica: header + cards. Fallback pra qualquer rota sem skeleton próprio. */
export function GenericPageSkeleton() {
  return (
    <div className="min-h-full bg-canvas">
      <HeaderSkeleton />
      <div className="px-4 sm:px-6 py-6 space-y-4">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Pulse key={i} className="h-20 rounded-xl" />)}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Pulse key={i} className="h-4" />)}
        </div>
      </div>
    </div>
  )
}
