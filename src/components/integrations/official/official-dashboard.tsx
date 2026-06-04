"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BadgeCheck, Phone, ShieldCheck, Gauge, Send, Webhook, FileText, Building2, LayoutGrid, ArrowRight, Unplug, Loader2, AlertTriangle, X } from "lucide-react"
import type { MetaPhoneInfo, MetaTemplate, MetaBusinessProfile } from "@/lib/providers/meta-cloud-provider"
import { disconnectWhatsAppOfficial } from "@/lib/actions/whatsapp-official"
import { SectionCard } from "@/components/ui/section-card"
import { StatusDot } from "@/components/ui/status-dot"
import { ProfileForm } from "./profile-form"
import { OfficialTestSend } from "./official-test-send"

type Tone = "success" | "warning" | "danger" | "neutral"
const Q_TONE: Record<string, Tone> = { GREEN: "success", YELLOW: "warning", RED: "danger", UNKNOWN: "neutral" }
const Q_LABEL: Record<string, string> = { GREEN: "Alta", YELLOW: "Média", RED: "Baixa", UNKNOWN: "—" }
const TIER: Record<string, string> = {
  TIER_50: "50 / dia", TIER_250: "250 / dia", TIER_1K: "1.000 / dia",
  TIER_10K: "10.000 / dia", TIER_100K: "100.000 / dia", TIER_UNLIMITED: "Ilimitado",
}

type Tab = "overview" | "profile"

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
  const qTone = Q_TONE[phone.quality_rating ?? "UNKNOWN"] ?? "neutral"
  const qLabel = Q_LABEL[phone.quality_rating ?? "UNKNOWN"] ?? "—"
  const connected = status === "connected"
  const tier = phone.messaging_limit_tier ? (TIER[phone.messaging_limit_tier] ?? phone.messaging_limit_tier) : "—"
  const approvedCount = templates.filter((t) => t.status === "APPROVED").length

  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [disErr, setDisErr] = useState<string | null>(null)

  function doDisconnect() {
    setDisErr(null)
    startTransition(async () => {
      const res = await disconnectWhatsAppOfficial()
      if (res.error) { setDisErr(res.error); return }
      setConfirmOpen(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* Header da linha oficial */}
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
              <BadgeCheck className="size-6 text-primary-600" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900 truncate">{phone.verified_name ?? "WhatsApp Oficial"}</h2>
                {phone.code_verification_status === "VERIFIED" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded-full">
                    <BadgeCheck className="size-3" /> Verificado
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                <Phone className="size-3.5 text-slate-400" /> {phone.display_phone_number ?? "—"}
              </p>
            </div>
          </div>
          <StatusDot tone={connected ? "success" : "neutral"} label={connected ? "Conectado" : (status ?? "—")} pulse={connected} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <StatTile icon={<Gauge className="size-3.5" />} label="Qualidade"><StatusDot tone={qTone} label={qLabel} size="sm" /></StatTile>
          <StatTile icon={<Send className="size-3.5" />} label="Limite de envio"><span className="text-sm font-semibold text-slate-800">{tier}</span></StatTile>
          <StatTile icon={<FileText className="size-3.5" />} label="Templates"><span className="text-sm font-semibold text-slate-800">{approvedCount} aprovados</span></StatTile>
          <StatTile icon={<Webhook className="size-3.5" />} label="Webhook"><StatusDot tone={webhookOk ? "success" : "danger"} label={webhookOk ? "Ativo" : "Inativo"} size="sm" /></StatTile>
        </div>
      </SectionCard>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutGrid className="size-3.5" />}>Visão geral</TabBtn>
        <TabBtn active={tab === "profile"} onClick={() => setTab("profile")} icon={<Building2 className="size-3.5" />}>Perfil</TabBtn>
      </div>

      {tab === "overview" && (
        <div className="space-y-5">
          <SectionCard title="Detalhes da conta" description="Conta oficial do WhatsApp Business (WABA)" icon={ShieldCheck}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-xs">
              <DRow label="Número">{phone.display_phone_number ?? "—"}</DRow>
              <DRow label="Nome verificado">{phone.verified_name ?? "—"}</DRow>
              <DRow label="Qualidade"><StatusDot tone={qTone} label={qLabel} size="sm" /></DRow>
              <DRow label="Limite de mensagens">{tier}</DRow>
              <DRow label="Verificação do número">{phone.code_verification_status === "VERIFIED" ? "Verificado" : (phone.code_verification_status ?? "—")}</DRow>
              <DRow label="Recebimento (webhook)"><StatusDot tone={webhookOk ? "success" : "danger"} label={webhookOk ? "Ativo" : "Inativo"} size="sm" /></DRow>
              <DRow label="WABA"><span className="font-mono text-slate-600">{wabaId ?? "—"}</span></DRow>
            </div>
          </SectionCard>

          <SectionCard
            title="Templates de mensagem"
            description={`${approvedCount} aprovado(s) · crie e monitore na área dedicada`}
            icon={FileText}
            actions={
              <Link href="/templates" className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 transition-colors">
                Gerenciar <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            <p className="text-xs text-slate-500">Acesse <strong>Templates</strong> no menu para criar modelos, filtrar, ver o preview e acompanhar a qualidade de cada um.</p>
          </SectionCard>

          <OfficialTestSend templates={templates} />

          <SectionCard title="Desconectar" description="Encerra a conexão deste número com a Kora." icon={Unplug}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                A Kora para de enviar e receber por este número. As conversas e o histórico ficam
                preservados — você pode reconectar quando quiser.
              </p>
              <button
                type="button"
                onClick={() => { setDisErr(null); setConfirmOpen(true) }}
                className="h-9 px-4 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <Unplug className="size-3.5" /> Desconectar
              </button>
            </div>
          </SectionCard>
        </div>
      )}

      {tab === "profile" && <ProfileForm profile={profile} />}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => !pending && setConfirmOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <div className="flex items-start gap-3">
              <span className="size-9 shrink-0 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><AlertTriangle className="size-5" /></span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Desconectar o WhatsApp Oficial?</h3>
                <p className="text-xs text-slate-500 mt-1 leading-snug">A Kora para de enviar/receber por este número. Histórico preservado; dá pra reconectar depois.</p>
              </div>
              <button onClick={() => !pending && setConfirmOpen(false)} className="size-7 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center"><X className="size-4 text-slate-400" /></button>
            </div>
            {disErr && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{disErr}</p>}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button type="button" disabled={pending} onClick={() => setConfirmOpen(false)} className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
              <button type="button" disabled={pending} onClick={doDisconnect} className="h-9 px-4 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />} Desconectar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatTile({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 text-[10px] font-semibold uppercase tracking-wide">{icon}{label}</div>
      <div className="mt-1.5">{children}</div>
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
