"use client"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { RefreshCw, Search } from "lucide-react"
import { callResultLabels } from "@/lib/voice/report"
import { SimpleSelect } from "@/components/ui/select"

export function CallFilters({ agents, instances }: { agents: { id: string; name: string }[]; instances: { id: string; label: string }[] }) {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams()
  const change = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString()); next.delete("page")
    if (value) next.set(name, value); else next.delete(name)
    router.push(`${pathname}?${next}`)
  }
  const input = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  return <div className="mb-5 flex flex-wrap items-center gap-2">
    <SimpleSelect ariaLabel="Filtrar ligações por atendente" className={input} value={params.get("agent") || ""} onChange={value => change("agent", value)}
      options={[{ value: "", label: "Todos os atendentes" }, ...agents.map(agent => ({ value: agent.id, label: agent.name }))]} />
    <SimpleSelect ariaLabel="Filtrar ligações por número" className={input} value={params.get("instance") || ""} onChange={value => change("instance", value)}
      options={[{ value: "", label: "Todos os números" }, ...instances.map(line => ({ value: line.id, label: line.label }))]} />
    <SimpleSelect ariaLabel="Filtrar resultado da ligação" className={input} value={params.get("result") || ""} onChange={value => change("result", value)}
      options={[{ value: "", label: "Todos os resultados" }, ...Object.entries(callResultLabels).map(([value, label]) => ({ value, label }))]} />
    <form className="flex items-center gap-1" onSubmit={event => { event.preventDefault(); change("q", String(new FormData(event.currentTarget).get("q") || "")) }}>
      <input key={params.get("q") || ""} className={input} name="q" aria-label="Pesquisar ligações por contato ou telefone" placeholder="Contato ou telefone" defaultValue={params.get("q") || ""} maxLength={100} />
      <button type="submit" className={input} aria-label="Pesquisar ligações"><Search className="size-4" /></button>
    </form>
    <button type="button" onClick={() => router.refresh()} className={`${input} ml-auto inline-flex items-center gap-2`}><RefreshCw className="size-3.5" /> Atualizar</button>
  </div>
}
