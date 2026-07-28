"use client"

import { useState, useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { X, Loader2, UserPlus, AlertTriangle } from "lucide-react"
import { createContact, lookupContact } from "@/lib/actions/contacts"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

/** Botão + diálogo "Novo contato" — criação manual dedup-safe (resolver canônico). */
export function NewContactButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0">
        <UserPlus className="size-3.5" /> Novo contato
      </button>
      {open && <NewContactDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function NewContactDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [name, setName]   = useState("")
  const [phone, setPhone] = useState("")
  const [bsuid, setBsuid] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start]  = useTransition()

  // ── Verificação AO VIVO de duplicado (debounce 400ms) ──
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    const p = phone.trim(), b = bsuid.trim()
    if (!p && !b) { setDup(null); return }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      const r = await lookupContact({ phone: p || undefined, bsuid: b || undefined })
      if (mine === seq.current) setDup(r)   // ignora respostas fora de ordem
    }, 400)
    return () => clearTimeout(t)
  }, [phone, bsuid])

  function submit() {
    setError(null)
    start(async () => {
      const r = await createContact({ name, phone, bsuid })
      if ("error" in r) { setError(r.error); return }
      router.push(`/contatos/${r.id}`)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-slate-100">
          <span className="size-6 rounded-lg bg-primary-50 grid place-items-center shrink-0"><UserPlus className="size-3.5 text-primary-600" /></span>
          <p className="text-sm font-semibold text-slate-900 flex-1">Novo contato</p>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          <Field label="Nome">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Maria Silva" className={inputCls} />
          </Field>
          <Field label="Telefone (WhatsApp)" hint="DDD + número · exterior use +DDI (ex: +1…)">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="11999998888  ·  +1 415…" className={inputCls} />
          </Field>
          <Field label="Usuário do WhatsApp" hint="opcional · BSUID — quando o contato chega sem telefone">
            <input value={bsuid} onChange={(e) => setBsuid(e.target.value)} placeholder="Identificador do contato (BSUID)" className={inputCls} />
          </Field>

          {dup ? (
            <div className="flex items-start gap-2 text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <AlertTriangle className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-amber-800 leading-snug">
                Já existe um contato com esse {phone.trim() ? "número" : "usuário"}: <strong>{dup.name}</strong>.{" "}
                <button type="button" onClick={() => router.push(`/contatos/${dup.id}`)} className="font-semibold underline hover:text-amber-900">Abrir cadastro</button>
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 leading-relaxed">Checamos na hora pra <strong>não duplicar</strong> — se já existir, avisamos aqui.</p>
          )}
          {error && <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 h-14 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          {dup ? (
            <button type="button" onClick={() => router.push(`/contatos/${dup.id}`)}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors">
              Abrir existente
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={pending || (!phone.trim() && !bsuid.trim())}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 transition-colors">
              {pending && <Loader2 className="size-3.5 animate-spin" />} Criar contato
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-slate-600 mb-1">
        {label}{hint && <span className="ml-1.5 font-normal text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
