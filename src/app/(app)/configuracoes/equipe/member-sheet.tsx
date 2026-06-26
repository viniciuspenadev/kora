"use client"

import { useState, useEffect, useTransition } from "react"
import { Loader2, Power, RotateCcw, CalendarDays, BadgeCheck, Smartphone } from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  updateMemberRole, updateMemberDepartment, toggleMemberViewAll, toggleMemberSeePool, updateMemberInstances, setMemberSupervises, setMemberActive,
  type TeamMember, type Department, type TenantRole,
} from "@/lib/actions/team"
import {
  listMemberAgendaAccess, setMemberAgendaAccess,
  type MemberAgendaAccess, type ShareLevel,
} from "@/lib/actions/agenda"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

interface Props {
  member:          TeamMember
  departments:     Department[]
  numbers:         { id: string; label: string; provider: string | null }[]
  currentUserId:   string
  currentUserRole: string
  onClose:         () => void
  onFeedback:      (kind: "ok" | "error", text: string) => void
}

export function MemberSheet({ member, departments, numbers, currentUserId, currentUserRole, onClose, onFeedback }: Props) {
  const [role, setRole]               = useState<TenantRole>(member.role)
  const [departmentId, setDepartment] = useState<string>(member.department_id ?? "")
  const [supMode, setSupMode]         = useState<"none" | "scoped" | "all">(
    member.view_all ? "all" : (member.supervises_departments.length ? "scoped" : "none"),
  )
  const [supDepts, setSupDepts]       = useState<string[]>(member.supervises_departments)
  const [seePool, setSeePool]         = useState(member.see_pool)
  const [instanceIds, setInstanceIds] = useState<string[]>(member.instance_ids ?? [])

  const [savePending, startSave]     = useTransition()
  const [statusPending, startStatus] = useTransition()
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const isSelf       = member.user_id === currentUserId
  const isOwner      = member.role === "owner"
  const canEditRole  = currentUserRole === "owner" && !isOwner
  const canEditOther = !isOwner || currentUserRole === "owner"

  async function handleSave() {
    let anyError: string | null = null
    let anyChange = false

    startSave(async () => {
      // Role
      if (role !== member.role) {
        anyChange = true
        const r = await updateMemberRole(member.user_id, role)
        if (r.error) anyError = r.error
      }

      // Departamento
      const newDept = departmentId || null
      if (newDept !== member.department_id) {
        anyChange = true
        const r = await updateMemberDepartment(member.user_id, newDept)
        if (r.error) anyError = r.error
      }

      // Supervisão: view_all = GERAL · supervises_departments = ESCOPADO (setores).
      const targetViewAll = supMode === "all"
      if (targetViewAll !== member.view_all) {
        anyChange = true
        const r = await toggleMemberViewAll(member.user_id, targetViewAll)
        if (r.error) anyError = r.error
      }
      const targetSup = supMode === "scoped" ? supDepts : []
      const curSup = member.supervises_departments
      const sameSup = curSup.length === targetSup.length && curSup.every((id) => targetSup.includes(id))
      if (!sameSup) {
        anyChange = true
        const r = await setMemberSupervises(member.user_id, targetSup)
        if (r.error) anyError = r.error
      }

      // see_pool (persiste o valor mesmo quando view_all está ligado — preserva
      // a preferência pra quando view_all for desligado depois)
      if (seePool !== member.see_pool) {
        anyChange = true
        const r = await toggleMemberSeePool(member.user_id, seePool)
        if (r.error) anyError = r.error
      }

      // instance_ids (Fase D) — números que atende
      const curIds = member.instance_ids ?? []
      const sameIds = curIds.length === instanceIds.length && curIds.every((id) => instanceIds.includes(id))
      if (!sameIds) {
        anyChange = true
        const r = await updateMemberInstances(member.user_id, instanceIds)
        if (r.error) anyError = r.error
      }

      if (anyError) {
        onFeedback("error", anyError)
        return
      }

      onFeedback("ok", anyChange ? "Atendente atualizado" : "Sem alterações")
      onClose()
    })
  }

  function handleToggleStatus() {
    startStatus(async () => {
      const r = await setMemberActive(member.user_id, !member.active)
      if (r.error) onFeedback("error", r.error)
      else {
        onFeedback("ok", member.active ? "Atendente desativado" : "Atendente reativado")
        onClose()
      }
    })
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={member.full_name ?? member.email}
        description={member.email}
        width="md"
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={savePending}
              className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={savePending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {savePending && <Loader2 className="size-3.5 animate-spin" />}
              Salvar
            </button>
          </>
        }
      >
        <div className="space-y-5">

          {isOwner && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Owner</span>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Esta pessoa é o owner do tenant. Papel não pode ser alterado direto — use &quot;Transferir posse&quot;.
              </p>
            </div>
          )}

          {isSelf && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Você</span>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Esta é a sua própria conta. Algumas ações estão bloqueadas (desativar, mudar próprio papel).
              </p>
            </div>
          )}

          <FormRow
            label="Papel"
            hint={!canEditRole ? "Apenas o owner pode mudar papéis" : "Define o que essa pessoa pode fazer no sistema"}
          >
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as TenantRole)}
              disabled={!canEditRole || isSelf}
              className={`${inputCls} disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <option value="agent">Atendente — atende conversas</option>
              <option value="admin">Admin — gerencia equipe e config</option>
              <option value="owner" disabled>Owner — só um por tenant</option>
            </select>
          </FormRow>

          <FormRow
            label="Departamento"
            hint="Habilita a fila do setor: a pessoa passa a ver as conversas não-atribuídas deste departamento (além das atribuídas a ela)."
          >
            <select
              value={departmentId}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={!canEditOther}
              className={`${inputCls} disabled:opacity-60`}
            >
              <option value="">— Sem departamento —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </FormRow>

          <div className="pt-4 border-t border-slate-100">
            <p className="text-sm font-medium text-slate-800">Supervisão</p>
            <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
              O que essa pessoa vê do trabalho dos <strong>outros</strong> atendentes (além do que é dela).
            </p>
            <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5">
              {([
                { v: "none",   l: "Não" },
                { v: "scoped", l: "Setores" },
                { v: "all",    l: "Geral" },
              ] as const).map((o) => (
                <button
                  key={o.v} type="button" disabled={!canEditOther}
                  onClick={() => setSupMode(o.v)}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${supMode === o.v ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              {supMode === "none"
                ? "Vê só o que é dela + a fila do setor dela."
                : supMode === "all"
                ? "Vê todas as conversas do tenant (supervisor geral)."
                : "Vê tudo dos setores marcados abaixo — inclusive conversas que já têm dono."}
            </p>
            {supMode === "scoped" && (
              <div className="space-y-1.5 mt-2">
                {departments.length === 0 && <p className="text-[11px] text-slate-400">Nenhum departamento cadastrado.</p>}
                {departments.map((d) => {
                  const checked = supDepts.includes(d.id)
                  return (
                    <label key={d.id} className={`flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2 ${canEditOther ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed opacity-60"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setSupDepts((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))}
                        disabled={!canEditOther}
                        className="size-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50"
                      />
                      <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-sm text-slate-700">{d.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className={`flex items-start gap-3 ${supMode === "all" ? "cursor-not-allowed" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={supMode === "all" ? true : seePool}
                onChange={(e) => setSeePool(e.target.checked)}
                disabled={!canEditOther || supMode === "all"}
                className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">Ver conversas não atribuídas (pool)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {supMode === "all"
                    ? "Como vê todas as conversas, já enxerga o pool."
                    : "Quando desligado, essa pessoa só vê conversas atribuídas a ela ou que participa."}
                </p>
                {supMode !== "all" && !seePool && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5 leading-relaxed">
                    ⚠️ Esta pessoa só verá conversas atribuídas a ela. Garanta que a <strong>Distribuição automática</strong> está ligada (ou que alguém atribui manualmente), senão ela não recebe conversas novas.
                  </p>
                )}
              </div>
            </label>
          </div>

          {role === "agent" && numbers.length > 1 && (
            <div className="pt-4 border-t border-slate-100">
              <p className="text-sm font-medium text-slate-800">Números que atende</p>
              <p className="text-[11px] text-slate-500 mt-0.5 mb-2">
                Marque os números cujas conversas esta pessoa atende. <strong>Nenhum marcado = todos</strong>. O número limita o que ela descobre (pool e fila do setor); conversas atribuídas a ela ou que ela participa seguem visíveis mesmo de outro número.
              </p>
              <div className="space-y-1.5">
                {numbers.map((n) => {
                  const checked = instanceIds.includes(n.id)
                  return (
                    <label key={n.id} className={`flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2 ${canEditOther ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed opacity-60"}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setInstanceIds((prev) => e.target.checked ? [...prev, n.id] : prev.filter((x) => x !== n.id))}
                        disabled={!canEditOther}
                        className="size-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50"
                      />
                      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded ${n.provider === "meta_cloud" ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-500"}`}>
                        {n.provider === "meta_cloud" ? <BadgeCheck className="size-3" /> : <Smartphone className="size-3" />}
                      </span>
                      <span className="text-sm text-slate-700">{n.label}</span>
                    </label>
                  )
                })}
              </div>
              {instanceIds.length === 0 && (
                <p className="text-[11px] text-slate-400 mt-1.5">Atendendo <strong>todos</strong> os números.</p>
              )}
            </div>
          )}

          {member.role === "agent" && <AgendaAccessSection memberUserId={member.user_id} onFeedback={onFeedback} />}

          {!isSelf && !isOwner && (
            <div className="pt-4 border-t border-slate-100">
              {member.active ? (
                <button
                  type="button"
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={statusPending}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-red-200 bg-white hover:bg-red-50 text-danger rounded-lg transition-colors disabled:opacity-50"
                >
                  {statusPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                  Desativar atendente
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={statusPending}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {statusPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                  Reativar atendente
                </button>
              )}
            </div>
          )}
        </div>
      </Sheet>

      <DangerConfirm
        open={confirmDeactivate}
        title={`Desativar ${member.full_name ?? member.email}?`}
        body={
          <>
            Atendente não conseguirá mais entrar nem responder conversas até ser reativado.
            <br /><br />
            Conversas em que ele é responsável ficam <strong>sem atribuição</strong> e aparecem na lista geral. Mensagens enviadas anteriormente são mantidas.
          </>
        }
        confirmLabel="Desativar"
        onConfirm={handleToggleStatus}
        onClose={() => setConfirmDeactivate(false)}
      />
    </>
  )
}

// ── Acesso a agendas (delegação estilo Outlook) — admin define pelo Sheet ──
const AGENDA_LEVELS: { v: "none" | ShareLevel; l: string }[] = [
  { v: "none",      l: "Nenhum" },
  { v: "free_busy", l: "Restrita" },
  { v: "details",   l: "Detalhada" },
  { v: "manage",    l: "Gerenciar" },
]

function AgendaAccessSection({ memberUserId, onFeedback }: {
  memberUserId: string
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [rows, setRows]       = useState<MemberAgendaAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let on = true
    listMemberAgendaAccess(memberUserId)
      .then((r) => { if (on) { setRows(r); setLoading(false) } })
      .catch(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [memberUserId])

  async function setLevel(resourceId: string, level: "none" | ShareLevel) {
    setSaving(resourceId)
    const r = await setMemberAgendaAccess(memberUserId, resourceId, level)
    setSaving(null)
    if (r?.error) { onFeedback("error", r.error); return }
    setRows((prev) => prev.map((x) => (x.resource_id === resourceId ? { ...x, level: level === "none" ? null : level } : x)))
  }

  if (loading || rows.length === 0) return null   // sem agendas / não-admin → some

  return (
    <div className="pt-4 border-t border-slate-100">
      <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><CalendarDays className="size-4 text-slate-400" /> Acesso a agendas</p>
      <p className="text-[11px] text-slate-500 mt-0.5 mb-3">
        Libere a agenda de outros atendentes pra esta pessoa. <strong>Restrita</strong> = só os horários ocupados, sem dados do cliente; <strong>Detalhada</strong> = vê a reunião (leitura); <strong>Gerenciar</strong> = marca/cancela/remarca (não altera a configuração da agenda nem compartilha com terceiros).
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.resource_id} className="rounded-lg border border-slate-200 p-2">
            <p className="text-sm text-slate-700 mb-1.5 truncate">{r.name}</p>
            <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5">
              {AGENDA_LEVELS.map((opt) => {
                const active = (r.level ?? "none") === opt.v
                return (
                  <button
                    key={opt.v} type="button" disabled={savingId === r.resource_id}
                    onClick={() => setLevel(r.resource_id, opt.v)}
                    className={`flex-1 px-1 py-1 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50 ${
                      active ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {opt.l}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
