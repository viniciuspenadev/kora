"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Share2, Loader2, Users } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import {
  listResourceShares, upsertResourceShare, removeResourceShare, setResourceEveryoneLevel, listAppointmentAgents,
  type ResourceRow, type ResourceShareRow, type ShareLevel,
} from "@/lib/actions/agenda"

type Agent = { user_id: string; full_name: string | null }
const LEVELS: { v: "none" | ShareLevel; l: string }[] = [
  { v: "none", l: "Nenhum" }, { v: "free_busy", l: "Restrita" }, { v: "details", l: "Detalhada" }, { v: "manage", l: "Gerenciar" },
]

/**
 * O DONO compartilha a(s) própria(s) agenda(s) — autosserviço (modelo Outlook).
 * Cada agenda: nível pra "toda a equipe" + pessoas específicas (sobem acima do piso).
 * Backend gateia (dono ou admin) e audita. "Gerenciar" não reconfigura nem re-compartilha.
 */
export function ShareAgendaDialog({ resources, onClose }: { resources: ResourceRow[]; onClose: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  useEffect(() => { listAppointmentAgents().then(setAgents).catch(() => {}) }, [])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="size-4 text-primary-600" /> Compartilhar minha agenda</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-500 -mt-1">
          <strong>Restrita</strong> = só horários ocupados (sem dados do cliente) · <strong>Detalhada</strong> = vê as reuniões (leitura) · <strong>Gerenciar</strong> = marca/cancela por você.
        </p>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {resources.map((r) => <AgendaShareBlock key={r.id} resource={r} agents={agents} multi={resources.length > 1} />)}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AgendaShareBlock({ resource, agents, multi }: { resource: ResourceRow; agents: Agent[]; multi: boolean }) {
  const [everyone, setEveryone] = useState<"none" | ShareLevel>(resource.share_everyone_level ?? "none")
  const [shares, setShares]     = useState<ResourceShareRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [pick, setPick]         = useState("")
  const [pickLevel, setPickLvl] = useState<ShareLevel>("free_busy")
  const [busy, setBusy]         = useState(false)

  const load = useCallback(async () => { setShares(await listResourceShares(resource.id)); setLoading(false) }, [resource.id])
  useEffect(() => { void load() }, [load])

  const sharedIds = new Set(shares.map((s) => s.grantee_user_id))
  const available = agents.filter((a) => a.user_id !== resource.assigned_agent_id && !sharedIds.has(a.user_id))

  async function setEveryoneLevel(level: "none" | ShareLevel) {
    const prev = everyone
    setEveryone(level)
    const r = await setResourceEveryoneLevel(resource.id, level)
    if (r?.error) { toast.error(r.error); setEveryone(prev) }
  }
  async function add() {
    if (!pick) return
    setBusy(true)
    const r = await upsertResourceShare(resource.id, pick, pickLevel)
    setBusy(false)
    if (r?.error) { toast.error(r.error); return }
    setPick(""); void load()
  }
  async function changeLevel(userId: string, level: "none" | ShareLevel) {
    if (level === "none") {
      const r = await removeResourceShare(resource.id, userId)
      if (r?.error) { toast.error(r.error); return }
      setShares((p) => p.filter((s) => s.grantee_user_id !== userId)); return
    }
    const r = await upsertResourceShare(resource.id, userId, level)
    if (r?.error) { toast.error(r.error); return }
    setShares((p) => p.map((s) => (s.grantee_user_id === userId ? { ...s, level } : s)))
  }

  return (
    <div className={multi ? "rounded-xl border border-slate-200 p-3" : ""}>
      {multi && <p className="text-sm font-semibold text-slate-800 mb-2">{resource.name}</p>}

      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100">
        <span className="text-sm text-slate-700 flex items-center gap-1.5"><Users className="size-3.5 text-slate-400" /> Toda a equipe</span>
        <LevelPicker value={everyone} onChange={setEveryoneLevel} />
      </div>

      {!loading && shares.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {shares.map((s) => (
            <div key={s.grantee_user_id} className="flex items-center gap-2">
              <span className="text-sm text-slate-700 truncate flex-1">{s.full_name ?? "—"}</span>
              <LevelPicker value={s.level} onChange={(lv) => changeLevel(s.grantee_user_id, lv)} />
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 flex-1">
            <option value="">Adicionar pessoa…</option>
            {available.map((a) => <option key={a.user_id} value={a.user_id}>{a.full_name ?? "—"}</option>)}
          </Select>
          <Select value={pickLevel} onChange={(e) => setPickLvl(e.target.value as ShareLevel)} className="h-8 w-28">
            {LEVELS.filter((l) => l.v !== "none").map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
          </Select>
          <Button size="sm" onClick={add} disabled={!pick || busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Add"}</Button>
        </div>
      )}
    </div>
  )
}

function LevelPicker({ value, onChange }: { value: "none" | ShareLevel; onChange: (v: "none" | ShareLevel) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
      {LEVELS.map((opt) => {
        const active = value === opt.v
        return (
          <button
            key={opt.v} type="button" onClick={() => onChange(opt.v)}
            className={`px-1.5 py-0.5 text-[11px] font-medium rounded-md transition-colors ${active ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-700"}`}
          >
            {opt.l}
          </button>
        )
      })}
    </div>
  )
}
