"use client"

import { useState, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Link2, Search, Loader2, X, AlertTriangle } from "lucide-react"
import { searchContactsForMerge, mergeContacts, getMergePreview } from "@/lib/actions/contacts"

interface Hit { id: string; name: string; phone: string | null; pic: string | null }
type Preview = { conversations: number; channels: number; deals: number; tasks: number; tags: number; appointments: number }

/**
 * "Vincular contato" — funde OUTRO contato (a mesma pessoa, em outro canal) NESTE.
 * O contato visto é o sobrevivente; o escolhido é absorvido. Destrutivo + atômico
 * (server action mergeContacts → função SQL). Gate de permissão é do chamador.
 */
export function MergeContactButton({ survivorId, survivorName, survivorPic }: { survivorId: string; survivorName: string; survivorPic: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Hit | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function close() { setOpen(false); setQuery(""); setHits([]); setSelected(null); setPreview(null); setError(null); setLoading(false) }

  function onQuery(v: string) {
    setQuery(v); setSelected(null); setPreview(null); setError(null)
    if (timer.current) clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      const r = await searchContactsForMerge(v, survivorId)
      setHits(r); setLoading(false)
    }, 300)
  }

  function pick(h: Hit) {
    setSelected(h); setPreview(null); setError(null)
    getMergePreview(h.id).then(setPreview).catch(() => {})
  }

  function confirmMerge() {
    if (!selected) return
    setError(null)
    start(async () => {
      const r = await mergeContacts(survivorId, selected.id)
      if ("error" in r) { setError(r.error); return }
      close()
      router.refresh()
    })
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors">
        <Link2 className="size-3.5" /> Vincular contato
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={close}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
              <Link2 className="size-4 text-primary-600" />
              <h2 className="text-sm font-bold text-slate-900 flex-1">Vincular contato</h2>
              <button onClick={close} className="size-7 rounded-lg text-slate-400 hover:bg-slate-100 grid place-items-center"><X className="size-4" /></button>
            </div>

            <div className="p-5 space-y-3">
              {!selected ? (
                <>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Busque o contato que é a <span className="font-semibold text-slate-700">mesma pessoa</span>. Ele será absorvido por <span className="font-semibold text-slate-700">{survivorName}</span> — conversas, canais, negócios e histórico passam pra cá.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                    <input autoFocus value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Nome, telefone, @ ou email…"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40" />
                  </div>
                  <div className="min-h-[3rem]">
                    {loading ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400 py-3"><Loader2 className="size-3.5 animate-spin" /> Buscando…</div>
                    ) : hits.length === 0 && query.trim().length >= 2 ? (
                      <p className="text-xs text-slate-400 py-3">Nenhum contato encontrado.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {hits.map((h) => (
                          <li key={h.id}>
                            <button onClick={() => pick(h)} className="w-full text-left px-1 py-2 hover:bg-slate-50 rounded flex items-center gap-2.5">
                              <Avatar pic={h.pic} name={h.name} ring="ring-slate-200" />
                              <span className="text-sm font-medium text-slate-800 flex-1 truncate">{h.name}</span>
                              {h.phone && <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">{h.phone}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {error && <p className="text-xs text-red-600">{error}</p>}
                </>
              ) : (
                <>
                  {/* Visual da fusão: absorvido → ícone → sobrevivente */}
                  <div className="flex items-center justify-center gap-3 py-1">
                    <div className="flex flex-col items-center gap-1 w-24">
                      <Avatar pic={selected.pic} name={selected.name} big ring="ring-slate-200" />
                      <span className="text-[10px] text-slate-400 truncate max-w-full">{selected.name}</span>
                    </div>
                    <div className="size-7 rounded-full bg-primary-50 border border-primary-200 grid place-items-center shrink-0">
                      <Link2 className="size-3.5 text-primary-600" />
                    </div>
                    <div className="flex flex-col items-center gap-1 w-24">
                      <Avatar pic={survivorPic} name={survivorName} big ring="ring-primary-300" />
                      <span className="text-[10px] font-semibold text-primary-700 truncate max-w-full">{survivorName}</span>
                    </div>
                  </div>

                  {preview && (
                    <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                      Vem junto:{" "}
                      {[
                        [preview.conversations, "conversa", "conversas"],
                        [preview.channels, "canal", "canais"],
                        [preview.deals, "negócio", "negócios"],
                        [preview.tags, "tag", "tags"],
                        [preview.appointments, "agendamento", "agendamentos"],
                      ].filter(([n]) => (n as number) > 0).map(([n, s, p]) => `${n} ${(n as number) === 1 ? s : p}`).join(" · ") || "histórico do contato"}
                    </p>
                  )}

                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                    <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 leading-relaxed">
                      <span className="font-semibold">{selected.name}</span> <span className="font-semibold">deixa de existir</span> e tudo passa pra <span className="font-semibold">{survivorName}</span>. Não dá pra desfazer.
                    </p>
                  </div>
                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => { setSelected(null); setPreview(null) }} disabled={pending} className="h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">Voltar</button>
                    <button onClick={confirmMerge} disabled={pending} className="flex-1 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Vincular e mesclar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Avatar({ pic, name, big, ring }: { pic: string | null; name: string; big?: boolean; ring: string }) {
  const cls = `${big ? "size-12 text-base" : "size-8 text-xs"} rounded-full object-cover ring-2 ${ring} shrink-0`
  return pic ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={pic} alt="" className={cls} />
  ) : (
    <span className={`${cls} grid place-items-center bg-slate-100 text-slate-500 font-bold`}>{(name[0] ?? "?").toUpperCase()}</span>
  )
}
