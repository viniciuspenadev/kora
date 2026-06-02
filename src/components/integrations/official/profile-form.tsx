"use client"

import { useState, useTransition } from "react"
import { Loader2, Save, CheckCircle2, AlertCircle, Building2 } from "lucide-react"
import { updateOfficialProfile } from "@/lib/actions/whatsapp-official"
import type { MetaBusinessProfile } from "@/lib/providers/meta-cloud-provider"

const VERTICALS: Array<{ value: string; label: string }> = [
  { value: "UNDEFINED", label: "—" },
  { value: "PROF_SERVICES", label: "Serviços profissionais" },
  { value: "RETAIL", label: "Varejo" },
  { value: "ECOMMERCE", label: "E-commerce" },
  { value: "EDU", label: "Educação" },
  { value: "HEALTH", label: "Saúde" },
  { value: "FINANCE", label: "Finanças" },
  { value: "RESTAURANT", label: "Restaurante" },
  { value: "BEAUTY", label: "Beleza" },
  { value: "TRAVEL", label: "Viagem" },
  { value: "EVENT_PLAN", label: "Eventos" },
  { value: "OTHER", label: "Outro" },
]

export function ProfileForm({ profile }: { profile: MetaBusinessProfile }) {
  const [about, setAbout] = useState(profile.about ?? "")
  const [description, setDescription] = useState(profile.description ?? "")
  const [address, setAddress] = useState(profile.address ?? "")
  const [email, setEmail] = useState(profile.email ?? "")
  const [vertical, setVertical] = useState(profile.vertical ?? "UNDEFINED")
  const [web1, setWeb1] = useState(profile.websites?.[0] ?? "")
  const [web2, setWeb2] = useState(profile.websites?.[1] ?? "")
  const [fb, setFb] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pending, startT] = useTransition()

  function save() {
    setFb(null)
    startT(async () => {
      const r = await updateOfficialProfile({
        about, description, address, email, vertical,
        websites: [web1, web2].filter((w) => w.trim()),
      })
      if (r.ok) setFb({ ok: true, msg: "Perfil atualizado!" })
      else setFb({ ok: false, msg: r.error ?? "Falha ao salvar." })
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="size-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
          <Building2 className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Perfil da empresa</h2>
          <p className="text-[11px] text-slate-400">É o que o cliente final vê ao abrir a conversa no WhatsApp.</p>
        </div>
      </div>

      <div className="flex items-start gap-4 mb-4">
        {profile.profile_picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.profile_picture_url} alt="Foto de perfil" className="size-16 rounded-full object-cover border border-slate-200 shrink-0" />
        ) : (
          <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
            <Building2 className="size-6 text-slate-300" />
          </div>
        )}
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Recado (about)</label>
          <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={139} placeholder="Ex: Atendimento rápido pelo WhatsApp"
            className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <p className="text-[10px] text-slate-400 mt-1">Foto de perfil: edição via upload chega em breve.</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Descrição</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={256}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="contato@empresa.com.br"
              className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Segmento</label>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)}
              className="w-full h-9 px-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
              {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Endereço</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, cidade - UF"
            className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Site 1</label>
            <input value={web1} onChange={(e) => setWeb1(e.target.value)} placeholder="https://…"
              className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Site 2</label>
            <input value={web2} onChange={(e) => setWeb2(e.target.value)} placeholder="https://…"
              className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>
      </div>

      {fb && (
        <div className={`flex items-start gap-2 mt-3 p-2.5 rounded-lg text-xs ${fb.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {fb.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
          <span>{fb.msg}</span>
        </div>
      )}

      <div className="flex justify-end mt-4">
        <button onClick={save} disabled={pending}
          className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Salvar perfil
        </button>
      </div>
    </div>
  )
}
