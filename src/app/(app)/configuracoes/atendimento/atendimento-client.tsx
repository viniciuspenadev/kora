"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import {
  Save, Loader2, AlertCircle, CheckCircle2,
  Users, UserCheck, Bell, Bot,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { Switch } from "@/components/ui/switch"
import { updateAtendimentoPolicy } from "@/lib/actions/atendimento"

type IAct = "notify"
type Bind = "carteira" | "pool"
type Tab  = "vinculo" | "inatividade"

interface Props {
  hasStudio:         boolean
  binding:           Bind
  inactivityEnabled: boolean
  inactivityHours:   number
  inactivityAction:  IAct
  /** Meta de 1ª resposta em minutos (null = sem meta). */
  slaMinutes:        number | null
}


export function AtendimentoClient(props: Props) {
  const [tab, setTab]       = useState<Tab>("vinculo")
  // Vínculo controla apenas a formação de carteira pelo atendimento.
  const [bind, setBind]     = useState<Bind>(props.binding)
  const [inact, setInact]   = useState(props.inactivityEnabled)
  const [hours, setHours]   = useState(props.inactivityHours)
  const [act, setAct]       = useState<IAct>(props.inactivityAction)
  // Meta de 1ª resposta (SLA): null = sem meta (o "% no prazo" dos relatórios fica off).
  const [slaMin, setSlaMin] = useState<number | null>(props.slaMinutes)

  const [pending, startT]   = useTransition()
  const [fb, setFb]         = useState<{ ok: boolean; text: string } | null>(null)
  const flash = (ok: boolean, text: string) => { setFb({ ok, text }); setTimeout(() => setFb(null), 3000) }

  function save() {
    setFb(null)
    startT(async () => {
      const r2 = await updateAtendimentoPolicy({
        handoff_binding: bind,
        inactivity_enabled: inact, inactivity_hours: hours,
        inactivity_action: act,
        sla_first_response_minutes: slaMin,
      })
      if (r2?.error) return flash(false, r2.error)
      flash(true, "Configuração salva")
    })
  }


  const TABS: { id: Tab; label: string }[] = [
    { id: "vinculo",      label: "Vínculo" },
    { id: "inatividade",  label: "Inatividade" },
  ]

  return (
    <div className="space-y-5">
      {/* Abas */}
      <div className="inline-flex bg-slate-100 rounded-lg p-1 gap-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`h-8 px-4 text-xs font-semibold rounded-md transition-colors ${tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ───────── Vínculo ───────── */}
      {tab === "vinculo" && (
        <SectionCard icon={UserCheck} title="Vínculo criado pelo atendimento" description="Defina se uma resposta do atendente cria um responsável para o cliente.">
          <div className="space-y-2">
            <RadioCard active={bind === "carteira"} onClick={() => setBind("carteira")} icon={UserCheck} title="Criar vínculo com o atendente" description="Na primeira resposta enviada com sucesso pelo responsável da conversa, o cliente sem dono passa a fazer parte da carteira dele." />
            <RadioCard active={bind === "pool"} onClick={() => setBind("pool")} icon={Users} title="Não criar vínculo pelo atendimento" description="Responder uma conversa não cria vínculo. Clientes que já têm responsável continuam com ele; negócios e agendamentos mantêm suas próprias regras." />
            <p className="text-xs text-slate-500 px-1 pt-2 leading-relaxed">O vínculo existente é preservado. Transferir uma conversa muda quem atende naquele momento; a troca do responsável pelo cliente é feita na ficha do contato.</p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="size-4 text-primary" />
                <p className="text-xs font-bold text-slate-800">Destino das conversas</p>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">Os fluxos do Kora Studio podem encaminhar para uma pessoa, departamento, fila ou responsável pelo cliente. Sem fluxo aplicável, ou quando ele termina sem escolher um destino, o atendimento vai para o responsável que pode atender naquele número; se não houver, vai para a fila.</p>
              {props.hasStudio && (
                <Link href="/studio/fluxos" className="inline-block mt-2.5 text-xs font-semibold text-primary-700 hover:underline">Configurar no Kora Studio</Link>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* ───────── Inatividade ───────── */}
      {tab === "inatividade" && (
        <SectionCard>
          <div className="flex items-start gap-3">
            <Switch size="lg" checked={inact} onChange={setInact} />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">Quando ninguém responde o cliente</p>
              <p className="text-xs text-slate-500 mt-0.5">Se o cliente manda mensagem e nenhum atendente responde por um tempo, o sistema age sozinho.</p>
            </div>
          </div>
          {inact && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                Depois de
                <input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 1)))}
                  className="w-16 h-9 px-2 text-sm border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
                horas sem resposta humana:
              </div>
              <div className="space-y-2">
                <RadioCard active={act === "notify"} onClick={() => setAct("notify")} icon={Bell} title="Avisar a equipe" description="Deixa um aviso interno na conversa. Não muda quem atende." />
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "inatividade" && (
        <SectionCard>
          <div className="flex items-start gap-3">
            <Switch size="lg" checked={slaMin != null} onChange={(v) => setSlaMin(v ? (props.slaMinutes ?? 15) : null)} />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">Meta de 1ª resposta</p>
              <p className="text-xs text-slate-500 mt-0.5">Quanto tempo, no máximo, o cliente deve esperar pela primeira resposta. Vira o &quot;% no prazo&quot; nos relatórios da equipe — não muda nada no atendimento em si.</p>
            </div>
          </div>
          {slaMin != null && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              Responder em até
              <input type="number" min={1} max={1440} value={slaMin} onChange={(e) => setSlaMin(Math.max(1, Math.min(1440, Number(e.target.value) || 15)))}
                className="w-16 h-9 px-2 text-sm border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
              minutos
            </div>
          )}
        </SectionCard>
      )}

      <p className="text-[11px] text-slate-400 px-1">Ao responder ou transferir uma conversa, a equipe assume o atendimento. O vínculo com o cliente é tratado separadamente.</p>

      {/* Save sticky */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 flex items-center gap-3 sticky bottom-4">
        <button type="button" onClick={save} disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Salvar
        </button>
        {fb && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${fb.ok ? "text-emerald-700" : "text-red-600"}`}>
            {fb.ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />} {fb.text}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────
function RadioCard({ active, onClick, title, description, icon: Icon }: { active: boolean; onClick: () => void; title: string; description: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${active ? "border-primary bg-primary-50/50 ring-2 ring-primary/10" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
      <p className={`text-sm font-semibold flex items-center gap-1.5 ${active ? "text-primary-700" : "text-slate-900"}`}>
        {Icon && <Icon className="size-3.5" />} {title}
      </p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>
    </button>
  )
}


