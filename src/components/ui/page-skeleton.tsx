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

/** Header ANALÍTICO (design-system §2.1): título no canvas + pílulas de filtro.
    Casa com o header de painéis/dashboards — usar no lugar de HeaderSkeleton nessas rotas. */
export function AnalyticHeaderSkeleton() {
  return (
    <div className="px-4 sm:px-6 pt-10 pb-10 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1 space-y-2.5">
        <Pulse className="h-6 w-52" />
        <Pulse className="h-2.5 w-72" />
      </div>
      <div className="flex items-center gap-2">
        <Pulse className="h-9 w-56 rounded-lg" />
        <Pulse className="h-9 w-44 rounded-lg" />
      </div>
    </div>
  )
}

/** Corpo de dashboard analítico (KPIs + gráficos). Compartilhado por loading.tsx
    (navegação) e pelo refetch de filtro no client — mesma casca nos dois momentos. */
export function DashboardSkeletonBody() {
  return (
    <div className="px-4 sm:px-6 pb-6 space-y-4">
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
  )
}

/** Header de LISTA (design-system §2.3): título no canvas + ações à direita.
    Casa com <PageShell variant="list"> — respiro simétrico pt-10 pb-10. */
export function ListHeaderSkeleton() {
  return (
    <div className="px-4 sm:px-6 pt-10 pb-10 flex items-start justify-between gap-3 flex-wrap">
      <div className="space-y-2.5">
        <Pulse className="h-7 w-44" />
        <Pulse className="h-3 w-64" />
      </div>
      <div className="flex items-center gap-2">
        <Pulse className="h-9 w-28 rounded-lg" />
        <Pulse className="h-9 w-36 rounded-lg" />
      </div>
    </div>
  )
}

/** Página de lista completa (§2.3): header + KPIs opcionais + card de busca+linhas.
    Serve de loading.tsx pra estoque/contatos/catálogo/campanhas/listas. */
export function ListPageSkeleton({ kpis = 0, rows = 8 }: { kpis?: number; rows?: number }) {
  return (
    <div className="min-h-full bg-canvas">
      <ListHeaderSkeleton />
      <div className="px-4 sm:px-6 pb-6 space-y-4">
        {kpis > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: kpis }).map((_, i) => <Pulse key={i} className="h-24 rounded-xl" />)}
          </div>
        )}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4"><Pulse className="h-9 w-full max-w-md" /></div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Pulse className="size-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Pulse className="h-3 w-1/3" />
                  <Pulse className="h-2 w-1/4" />
                </div>
                <Pulse className="h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Seção com ABAS (design-system §2.2): título 2xl + subtítulo + tab bar + cards.
    Serve de loading.tsx pra Organização (equipe/departamentos) e afins. */
export function TabsPageSkeleton({ tabs = 2 }: { tabs?: number }) {
  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6 space-y-2.5">
          <Pulse className="h-7 w-48" />
          <Pulse className="h-3 w-72" />
        </div>
        <div className="flex items-center gap-1 mb-6 border-b border-slate-200 pb-2">
          {Array.from({ length: tabs }).map((_, i) => <Pulse key={i} className="h-5 w-24 mx-2" />)}
        </div>
        <div className="space-y-4">
          <Pulse className="h-24 rounded-xl" />
          <Pulse className="h-64 rounded-xl" />
        </div>
      </div>
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
