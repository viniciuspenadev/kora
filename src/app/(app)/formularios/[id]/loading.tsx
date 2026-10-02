// Casca do editor: barra + abas + 3 colunas (mesma geometria da tela real, sem "pulo").
export default function Loading() {
  return (
    <div className="h-[calc(100dvh-3.5rem)] flex flex-col bg-canvas" data-skeleton>
      <div className="bg-white border-b border-slate-200 h-14 px-5 flex items-center gap-3">
        <div className="h-4 w-24 rounded bg-slate-200 animate-pulse" />
        <div className="h-5 w-48 rounded bg-slate-200 animate-pulse" />
        <div className="ml-auto h-8 w-36 rounded-lg bg-slate-100 animate-pulse" />
      </div>
      <div className="bg-white border-b border-slate-200 h-11 px-5 flex items-center gap-6">
        {[72, 80, 76].map((w) => <div key={w} className="h-3.5 rounded bg-slate-200 animate-pulse" style={{ width: w }} />)}
      </div>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_340px]">
        <div className="hidden lg:block bg-white border-r border-slate-200 p-4 space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
        <div className="p-6 flex justify-center"><div className="w-full max-w-[560px] h-96 rounded-2xl bg-white border border-slate-200 animate-pulse" /></div>
        <div className="hidden lg:block bg-white border-l border-slate-200 p-5 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 rounded-lg bg-slate-100 animate-pulse" />)}
        </div>
      </div>
    </div>
  )
}
