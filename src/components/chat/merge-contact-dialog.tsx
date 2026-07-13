"use client"

import { useState, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Link2, Search, Loader2, X, AlertTriangle, Combine, Star, ArrowLeftRight } from "lucide-react"
import { searchContactsForMerge, mergeContacts, getMergeComparison, type MergeSide } from "@/lib/actions/contacts"
import { lifecycleMeta } from "@/lib/lifecycle"
import { SourceLogo, channelToSource } from "@/components/chat/source-logo"

interface Hit { id: string; name: string; phone: string | null; pic: string | null }
const CH_ORDER = ["whatsapp", "instagram", "site"]

/**
 * "Vincular contato" — funde DOIS contatos (a mesma pessoa em canais diferentes).
 * Comparativo lado a lado + inverter quem sobrevive + preview do resultado. Destrutivo
 * e atômico (server action → função SQL). Gate de permissão é do chamador.
 */
export function MergeContactButton({ survivorId }: { survivorId: string; survivorName?: string; survivorPic?: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [comp, setComp] = useState<{ a: MergeSide; b: MergeSide } | null>(null)
  const [swapped, setSwapped] = useState(false)   // a=contato visto (survivor default); swap inverte
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function close() { setOpen(false); setQuery(""); setHits([]); setComp(null); setSwapped(false); setError(null); setLoading(false) }

  function onQuery(v: string) {
    setQuery(v); setComp(null); setError(null)
    if (timer.current) clearTimeout(timer.current)
    if (v.trim().length < 2) { setHits([]); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      const r = await searchContactsForMerge(v, survivorId)
      setHits(r); setLoading(false)
    }, 300)
  }

  function pick(h: Hit) {
    setComp(null); setSwapped(false); setError(null)
    getMergeComparison(survivorId, h.id).then((c) => { if (c) setComp(c) }).catch(() => setError("Não foi possível carregar os contatos."))
  }

  const survivor = comp ? (swapped ? comp.b : comp.a) : null
  const absorbed = comp ? (swapped ? comp.a : comp.b) : null

  function confirmMerge() {
    if (!survivor || !absorbed) return
    setError(null)
    start(async () => {
      const r = await mergeContacts(survivor.id, absorbed.id)
      if ("error" in r) { setError(r.error); return }
      close()
      router.refresh()
    })
  }

  // Resultado do merge: canais reunidos + o que o sobrevivente ganha do absorvido.
  const mergedChannels = survivor && absorbed ? CH_ORDER.filter((c) => survivor.channels.includes(c) || absorbed.channels.includes(c)) : []
  const gainChannels   = survivor && absorbed ? absorbed.channels.filter((c) => !survivor.channels.includes(c)) : []
  const gainsPhoto     = !!(survivor && absorbed && !survivor.pic && absorbed.pic)
  const moved          = absorbed ? [
    [absorbed.conversations, "conversa", "conversas"],
    [absorbed.deals, "negócio", "negócios"],
    [absorbed.tags, "tag", "tags"],
  ].filter(([n]) => (n as number) > 0).map(([n, s, p]) => `${n} ${(n as number) === 1 ? s : p}`).join(" · ") : ""

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
              {!comp ? (
                <>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Busque o contato que é a <span className="font-semibold text-slate-700">mesma pessoa</span> em outro canal. Você confirma quem fica na próxima tela.
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
              ) : survivor && absorbed ? (
                <>
                  {/* ── Fusão animada: absorvido → núcleo → sobrevivente ── */}
                  <div className="flex items-stretch justify-center gap-1 pt-1">
                    <SideCard side={absorbed} role="absorbed" />
                    <div className="relative flex items-center justify-center w-16 shrink-0">
                      <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-gradient-to-r from-slate-200 via-violet-300 to-primary-300" />
                      <div className="absolute inset-0 grid place-items-center">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="absolute size-1.5 rounded-full bg-primary-500"
                            style={{ animation: "merge-flow 1.3s ease-in-out infinite", animationDelay: `${i * 0.22}s` }} />
                        ))}
                      </div>
                      <span className="relative grid place-items-center">
                        <span className="absolute inline-flex size-9 rounded-full bg-violet-400/25 animate-ping" />
                        <span className="relative size-9 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 grid place-items-center shadow-md ring-2 ring-white">
                          <Combine className="size-4 text-white" />
                        </span>
                      </span>
                    </div>
                    <SideCard side={survivor} role="survivor" />
                  </div>

                  {/* Inverter quem fica */}
                  <div className="flex justify-center">
                    <button onClick={() => setSwapped((v) => !v)} disabled={pending}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-slate-500 hover:text-primary-700 bg-slate-50 hover:bg-primary-50 border border-slate-200 rounded-full transition-colors disabled:opacity-50">
                      <ArrowLeftRight className="size-3" /> Inverter quem fica
                    </button>
                  </div>

                  {/* Resultado */}
                  <div className="rounded-lg border border-primary-100 bg-primary-50/50 p-3 space-y-1.5">
                    <p className="text-[11px] text-slate-700 leading-relaxed">
                      <span className="font-bold text-primary-700">{survivor.name}</span> reúne{" "}
                      <span className="inline-flex items-center gap-0.5 align-middle">{mergedChannels.map((c) => <SourceLogo key={c} source={channelToSource(c)!} size={13} />)}</span>{" "}
                      e mantém a etapa <span className="font-semibold">{lifecycleMeta(survivor.lifecycle).label}</span>.
                    </p>
                    {(gainChannels.length > 0 || gainsPhoto || moved) && (
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Ganha: {[
                          ...gainChannels.map((c) => c === "instagram" ? "Instagram" : c === "site" ? "site" : "WhatsApp"),
                          ...(gainsPhoto ? ["foto"] : []),
                          ...(absorbed.handle ? [absorbed.handle] : []),
                        ].join(" · ")}{moved && ` · ${moved}`}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 flex items-start gap-2">
                    <AlertTriangle className="size-3.5 text-amber-600 shrink-0 mt-px" />
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      <span className="font-semibold">{absorbed.name}</span> deixa de existir — tudo passa pro sobrevivente. Não dá pra desfazer.
                    </p>
                  </div>

                  {error && <p className="text-xs text-red-600">{error}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => { setComp(null); setSwapped(false) }} disabled={pending} className="h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">Voltar</button>
                    <button onClick={confirmMerge} disabled={pending} className="flex-1 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Combine className="size-3.5" />} Vincular e mesclar
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-6 justify-center"><Loader2 className="size-3.5 animate-spin" /> Carregando…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Coluna de um lado da fusão: avatar + nome + canais + papel (fica/some). */
function SideCard({ side, role }: { side: MergeSide; role: "survivor" | "absorbed" }) {
  const survivor = role === "survivor"
  return (
    <div className={`flex flex-col items-center gap-1 w-[7.5rem] rounded-xl px-1.5 py-2 ${survivor ? "bg-primary-50/60" : "opacity-70"}`}>
      <div className="relative">
        <Avatar pic={side.pic} name={side.name} big ring={survivor ? "ring-primary-400" : "ring-slate-200"} />
        {survivor && <span className="absolute -top-1 -right-1 size-4 rounded-full bg-primary grid place-items-center ring-2 ring-white"><Star className="size-2 text-white fill-white" /></span>}
      </div>
      <span className={`text-[11px] truncate max-w-full ${survivor ? "font-bold text-primary-800" : "font-medium text-slate-500"}`}>{side.name}</span>
      <span className="inline-flex items-center gap-0.5">
        {side.channels.map((c) => <SourceLogo key={c} source={channelToSource(c)!} size={12} />)}
      </span>
      <span className={`text-[9px] font-bold uppercase tracking-wider ${survivor ? "text-primary-600" : "text-slate-400"}`}>{survivor ? "fica" : "some"}</span>
    </div>
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
