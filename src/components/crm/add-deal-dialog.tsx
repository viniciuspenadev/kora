"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { X, Search, Loader2, User, MessageCircle, RotateCcw, ArrowLeft, Briefcase } from "lucide-react"
import { searchContacts } from "@/lib/actions/chat"
import { createDealFromBoard } from "@/lib/actions/deals"
import { formatPhoneDisplay } from "@/lib/phone-utils"

interface ContactResult {
  id: string
  phone_number: string
  push_name: string | null
  custom_name?: string | null
  conversation_state?: "active" | "resolved" | null
}

/** Alvo da criação — coluna clicada no board. */
export interface AddDealTarget {
  pipelineId: string
  stageId: string
  stageName: string
  stageColor: string
}

export function AddDealDialog({ target, onClose }: { target: AddDealTarget | null; onClose: () => void }) {
  const router = useRouter()
  const [search, setSearch]       = useState("")
  const [contacts, setContacts]   = useState<ContactResult[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked]       = useState<ContactResult | null>(null)
  const [name, setName]           = useState("")
  const [value, setValue]         = useState("")
  const [error, setError]         = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (target) { setSearch(""); setContacts([]); setPicked(null); setName(""); setValue(""); setError(null) }
  }, [target])

  useEffect(() => {
    if (picked || search.trim().length < 2) { setContacts([]); return }
    const h = setTimeout(async () => {
      setSearching(true)
      try { setContacts(await searchContacts(search) as ContactResult[]) }
      catch (e) { console.error(e) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(h)
  }, [search, picked])

  if (!target) return null

  function submit() {
    if (!picked || !target) return
    setError(null)
    const cents = value.replace(/[^\d]/g, "")
    startTransition(async () => {
      const r = await createDealFromBoard({
        contactId: picked.id, pipelineId: target.pipelineId, stageId: target.stageId,
        name: name.trim() || null, estimatedValue: cents ? Number(cents) : null,
      })
      if ("error" in r) { setError(r.error); return }
      onClose()
      router.push(`/negocios/${r.id}`)
      router.refresh()
    })
  }

  const nameOf = (c: ContactResult) => c.custom_name ?? c.push_name ?? formatPhoneDisplay(c.phone_number)

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[82vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100">
          <span className="size-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${target.stageColor} 14%, transparent)`, color: target.stageColor }}>
            <Briefcase className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900 leading-tight">Adicionar negócio</h2>
            <p className="text-[11px] text-slate-400 truncate">em <span className="font-semibold" style={{ color: target.stageColor }}>{target.stageName}</span></p>
          </div>
          <button type="button" onClick={onClose} className="size-7 rounded-lg hover:bg-slate-100 text-slate-400 grid place-items-center shrink-0"><X className="size-4" /></button>
        </div>

        {!picked ? (
          /* passo 1 — escolher contato */
          <div className="flex-1 overflow-y-auto p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contato por nome ou telefone…"
                className="w-full pl-9 pr-9 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-primary-600 animate-spin" />}
            </div>
            {search.trim().length < 2 && <p className="text-[11px] text-slate-400 text-center py-8">Um negócio nasce de um contato. Digite ao menos 2 caracteres para buscar.</p>}
            {contacts.length > 0 && (
              <div className="space-y-1">
                {contacts.map((c) => (
                  <button key={c.id} type="button" onClick={() => { setPicked(c); setName("") }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 text-left transition-colors">
                    <span className="size-7 rounded-full bg-primary-100 grid place-items-center shrink-0"><User className="size-3.5 text-primary-700" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700 truncate">{nameOf(c)}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{formatPhoneDisplay(c.phone_number)}</p>
                    </div>
                    {c.conversation_state === "active" && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 shrink-0"><MessageCircle className="size-2.5" /> Em atendimento</span>}
                    {c.conversation_state === "resolved" && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0"><RotateCcw className="size-2.5" /> Já falou</span>}
                  </button>
                ))}
              </div>
            )}
            {search.trim().length >= 2 && !searching && contacts.length === 0 && (
              <p className="text-[11px] text-slate-400 text-center py-8">Nenhum contato encontrado. Um negócio precisa de um contato existente — inicie uma conversa primeiro.</p>
            )}
          </div>
        ) : (
          /* passo 2 — detalhes */
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <button type="button" onClick={() => setPicked(null)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"><ArrowLeft className="size-3" /> trocar contato</button>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
              <span className="size-8 rounded-full bg-primary-100 grid place-items-center shrink-0"><User className="size-4 text-primary-700" /></span>
              <div className="min-w-0"><p className="text-xs font-semibold text-slate-800 truncate">{nameOf(picked)}</p><p className="text-[10px] text-slate-400 font-mono">{formatPhoneDisplay(picked.phone_number)}</p></div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Interesse / nome do negócio <span className="text-slate-300 font-normal">(opcional)</span></label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Ex: ${nameOf(picked)} — proposta`}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Valor estimado <span className="text-slate-300 font-normal">(opcional)</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">R$</span>
                <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0"
                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              </div>
            </div>
            {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">{error}</p>}
            <button type="button" disabled={pending} onClick={submit}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Briefcase className="size-3.5" />} Criar negócio em {target.stageName}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
