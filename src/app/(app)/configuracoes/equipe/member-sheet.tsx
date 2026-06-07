"use client"

import { useState, useTransition } from "react"
import { Loader2, Power, RotateCcw } from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  updateMemberRole, updateMemberDepartment, toggleMemberViewAll, toggleMemberSeePool, setMemberActive,
  type TeamMember, type Department, type TenantRole,
} from "@/lib/actions/team"

const inputCls =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

interface Props {
  member:          TeamMember
  departments:     Department[]
  currentUserId:   string
  currentUserRole: string
  onClose:         () => void
  onFeedback:      (kind: "ok" | "error", text: string) => void
}

export function MemberSheet({ member, departments, currentUserId, currentUserRole, onClose, onFeedback }: Props) {
  const [role, setRole]               = useState<TenantRole>(member.role)
  const [departmentId, setDepartment] = useState<string>(member.department_id ?? "")
  const [viewAll, setViewAll]         = useState(member.view_all)
  const [seePool, setSeePool]         = useState(member.see_pool)

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

      // view_all
      if (viewAll !== member.view_all) {
        anyChange = true
        const r = await toggleMemberViewAll(member.user_id, viewAll)
        if (r.error) anyError = r.error
      }

      // see_pool (persiste o valor mesmo quando view_all está ligado — preserva
      // a preferência pra quando view_all for desligado depois)
      if (seePool !== member.see_pool) {
        anyChange = true
        const r = await toggleMemberSeePool(member.user_id, seePool)
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
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={viewAll}
                onChange={(e) => setViewAll(e.target.checked)}
                disabled={!canEditOther}
                className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">Pode ver todas as conversas</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Quando desligado, essa pessoa vê apenas: conversas atribuídas a ela, as que participa, a fila do seu departamento e — se permitido — o pool não-atribuído. Ligue para supervisores que precisam do panorama completo.
                </p>
              </div>
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className={`flex items-start gap-3 ${viewAll ? "cursor-not-allowed" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={viewAll ? true : seePool}
                onChange={(e) => setSeePool(e.target.checked)}
                disabled={!canEditOther || viewAll}
                className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">Ver conversas não atribuídas (pool)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {viewAll
                    ? "Como vê todas as conversas, já enxerga o pool."
                    : "Quando desligado, essa pessoa só vê conversas atribuídas a ela ou que participa."}
                </p>
                {!viewAll && !seePool && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5 leading-relaxed">
                    ⚠️ Esta pessoa só verá conversas atribuídas a ela. Garanta que a <strong>Distribuição automática</strong> está ligada (ou que alguém atribui manualmente), senão ela não recebe conversas novas.
                  </p>
                )}
              </div>
            </label>
          </div>

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
