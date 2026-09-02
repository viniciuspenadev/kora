"use client"

import { useState, useTransition } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { Loader2, Save, CheckCircle2, AlertCircle, Building2 } from "lucide-react"
import { updateOfficialProfile } from "@/lib/actions/whatsapp-official"
import type { MetaBusinessProfile } from "@/lib/providers/meta-cloud-provider"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"

const INPUT = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

const VERTICALS: Array<{ value: string; label: string }> = [
  { value: "UNDEFINED", label: "—" },
  { value: "PROF_SERVICES", label: "Serviços profissionais" },
  { value: "RETAIL", label: "Varejo / E-commerce" },
  { value: "APPAREL", label: "Vestuário / Moda" },
  { value: "GROCERY", label: "Mercado / Alimentos" },
  { value: "EDU", label: "Educação" },
  { value: "HEALTH", label: "Saúde" },
  { value: "FINANCE", label: "Finanças" },
  { value: "RESTAURANT", label: "Restaurante" },
  { value: "BEAUTY", label: "Beleza" },
  { value: "HOTEL", label: "Hotelaria" },
  { value: "TRAVEL", label: "Viagem" },
  { value: "EVENT_PLAN", label: "Eventos" },
  { value: "AUTO", label: "Automotivo" },
  { value: "NONPROFIT", label: "ONG / Sem fins lucrativos" },
  { value: "OTHER", label: "Outro" },
]

export function ProfileForm({ profile, instanceId }: { profile: MetaBusinessProfile; instanceId: string }) {
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
      }, instanceId)
      if (r.ok) setFb({ ok: true, msg: "Perfil atualizado!" })
      else setFb({ ok: false, msg: r.error ?? "Falha ao salvar." })
    })
  }

  return (
    <SectionCard title="Perfil da empresa" description="É o que o cliente final vê ao abrir a conversa no WhatsApp." icon={Building2}>
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
          <FormRow label="Recado (about)" hint="Foto de perfil: edição via upload chega em breve.">
            <input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={139} placeholder="Ex: Atendimento rápido pelo WhatsApp" className={INPUT} />
          </FormRow>
        </div>
      </div>

      <div className="space-y-4">
        <FormRow label="Descrição">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={256}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none" />
        </FormRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormRow label="Email">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="contato@empresa.com.br" className={INPUT} />
          </FormRow>
          <FormRow label="Segmento">
            <SimpleSelect value={vertical} onChange={setVertical}
              options={VERTICALS.map((v) => ({ value: v.value, label: v.label }))} />
          </FormRow>
        </div>
        <FormRow label="Endereço">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, cidade - UF" className={INPUT} />
        </FormRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormRow label="Site 1">
            <input value={web1} onChange={(e) => setWeb1(e.target.value)} placeholder="https://…" className={INPUT} />
          </FormRow>
          <FormRow label="Site 2">
            <input value={web2} onChange={(e) => setWeb2(e.target.value)} placeholder="https://…" className={INPUT} />
          </FormRow>
        </div>
      </div>

      {fb && (
        <div className={`flex items-start gap-2 mt-4 p-2.5 rounded-lg text-xs ${fb.ok ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"}`}>
          {fb.ok ? <CheckCircle2 className="size-4 shrink-0 mt-0.5" /> : <AlertCircle className="size-4 shrink-0 mt-0.5" />}
          <span>{fb.msg}</span>
        </div>
      )}

      <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
        <button onClick={save} disabled={pending}
          className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Salvar perfil
        </button>
      </div>
    </SectionCard>
  )
}
