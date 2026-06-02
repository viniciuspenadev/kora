"use client"

import { useState } from "react"
import { BadgeCheck, Phone, ShieldCheck, Gauge, Send, Webhook, FileText, Building2, LayoutGrid } from "lucide-react"
import type { MetaPhoneInfo, MetaTemplate, MetaBusinessProfile } from "@/lib/providers/meta-cloud-provider"
import { TemplateManager } from "./template-manager"
import { ProfileForm } from "./profile-form"
import { OfficialTestSend } from "./official-test-send"

const QUALITY: Record<string, { label: string; dot: string; tone: string }> = {
  GREEN:   { label: "Alta",  dot: "bg-emerald-400", tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  YELLOW:  { label: "Média", dot: "bg-amber-400",   tone: "text-amber-700 bg-amber-50 border-amber-200" },
  RED:     { label: "Baixa", dot: "bg-red-400",     tone: "text-red-700 bg-red-50 border-red-200" },
  UNKNOWN: { label: "—",     dot: "bg-slate-300",   tone: "text-slate-500 bg-slate-50 border-slate-200" },
}
const TIER: Record<string, string> = {
  TIER_50: "50 / dia", TIER_250: "250 / dia", TIER_1K: "1.000 / dia",
  TIER_10K: "10.000 / dia", TIER_100K: "100.000 / dia", TIER_UNLIMITED: "Ilimitado",
}

type Tab = "overview" | "templates" | "profile"

export function OfficialDashboard({
  phone, templates, profile, status, wabaId, webhookOk,
}: {
  phone: MetaPhoneInfo
  templates: MetaTemplate[]
  profile: MetaBusinessProfile
  status: string | null
  wabaId: string | null
  webhookOk: boolean
}) {
  const [tab, setTab] = useState<Tab>("overview")
  const quality = QUALITY[phone.quality_rating ?? "UNKNOWN"] ?? QUALITY.UNKNOWN
  const connected = status === "connected"
  const tier = phone.messaging_limit_tier ? (TIER[phone.messaging_limit_tier] ?? phone.messaging_limit_tier) : "—"
  const approvedCount = templates.filter((t) => t.status === "APPROVED").length

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#004add] to-[#001548] p-6 text-white shadow-card">
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/5" />
        <div className="absolute right-16 bottom-4 size-24 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
              <BadgeCheck className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{phone.verified_name ?? "WhatsApp Oficial"}</h2>
                {phone.code_verification_status === "VERIFIED" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-400/20 text-emerald-100 px-1.5 py-0.5 rounded-full">
                    <BadgeCheck className="size-3" /> Verificado
                  </span>
                )}
              </div>
              <p className="text-sm text-white/70 flex items-center gap-1.5 mt-0.5">
                <Phone className="size-3.5" /> {phone.display_phone_number ?? "—"}
              </p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 h-7 rounded-full ${connected ? "bg-emerald-400/20 text-emerald-100" : "bg-white/15 text-white/80"}`}>
            <span className={`size-2 rounded-full ${connected ? "bg-emerald-300" : "bg-white/50"}`} />
            {connected ? "Conectado" : (status ?? "—")}
          </span>
        </div>

        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <HeroStat icon={<Gauge className="size-3.5" />} label="Qualidade" value={quality.label} dot={quality.dot} />
          <HeroStat icon={<Send className="size-3.5" />} label="Limite de envio" value={tier} />
          <HeroStat icon={<FileText className="size-3.5" />} label="Templates" value={`${approvedCount} aprovados`} />
          <HeroStat icon={<Webhook className="size-3.5" />} label="Webhook" value={webhookOk ? "Ativo" : "Inativo"} dot={webhookOk ? "bg-emerald-400" : "bg-red-400"} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutGrid className="size-3.5" />}>Visão geral</TabBtn>
        <TabBtn active={tab === "templates"} onClick={() => setTab("templates")} icon={<FileText className="size-3.5" />}>Templates</TabBtn>
        <TabBtn active={tab === "profile"} onClick={() => setTab("profile")} icon={<Building2 className="size-3.5" />}>Perfil</TabBtn>
      </div>

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="size-9 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Detalhes da conta</h2>
                <p className="text-[11px] text-slate-400">Conta oficial do WhatsApp Business (WABA)</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
              <DRow label="Número">{phone.display_phone_number ?? "—"}</DRow>
              <DRow label="Nome verificado">{phone.verified_name ?? "—"}</DRow>
              <DRow label="Qualidade">
                <span className={`inline-flex items-center gap-1.5 h-5 text-[10px] font-semibold px-2 rounded-md border ${quality.tone}`}>
                  <span className={`size-1.5 rounded-full ${quality.dot}`} /> {quality.label}
                </span>
              </DRow>
              <DRow label="Limite de mensagens">{tier}</DRow>
              <DRow label="Verificação do número">{phone.code_verification_status === "VERIFIED" ? "Verificado" : (phone.code_verification_status ?? "—")}</DRow>
              <DRow label="Recebimento (webhook)">{webhookOk ? "Ativo" : "Inativo"}</DRow>
              <DRow label="WABA"><span className="font-mono text-slate-600">{wabaId ?? "—"}</span></DRow>
            </div>
          </div>

          <OfficialTestSend templates={templates} />
        </div>
      )}

      {tab === "templates" && <TemplateManager templates={templates} />}
      {tab === "profile" && <ProfileForm profile={profile} />}
    </div>
  )
}

function HeroStat({ icon, label, value, dot }: { icon: React.ReactNode; label: string; value: string; dot?: string }) {
  return (
    <div className="rounded-xl bg-white/10 backdrop-blur px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-white/60 text-[10px] font-medium uppercase tracking-wide">{icon}{label}</div>
      <div className="flex items-center gap-1.5 mt-1">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        <span className="text-sm font-bold">{value}</span>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold border-b-2 -mb-px transition-colors ${active ? "border-primary text-primary-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
      {icon}{children}
    </button>
  )
}

function DRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-50 pb-2 sm:border-0 sm:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{children}</span>
    </div>
  )
}
