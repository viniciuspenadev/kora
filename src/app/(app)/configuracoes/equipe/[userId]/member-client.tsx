"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Loader2, Check, Power, RotateCcw, CalendarDays, BadgeCheck, Smartphone,
  User, Contact, ShieldCheck, LayoutGrid, Settings2, Building2, Boxes, Briefcase, Megaphone, Landmark, FileText, AlertTriangle,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  updateMemberRole, updateMemberDepartment, toggleMemberViewAll, toggleMemberSeePool,
  updateMemberInstances, setMemberSupervises, setMemberActive, setMemberInventoryAccess, setMemberDealsAccess, setMemberContactsAccess, setMemberMarketingAccess, updateMemberProfile,
  type TeamMember, type Department, type TenantRole,
} from "@/lib/actions/team"
import {
  listMemberAgendaAccess, setMemberAgendaAccess, type MemberAgendaAccess, type ShareLevel,
} from "@/lib/actions/agenda"
import type { InventoryAccessLevel } from "@/lib/visibility"

const ROLE_LABEL: Record<TenantRole, string> = { owner: "Owner", admin: "Admin", agent: "Atendente" }
const INV_ORDER: Record<InventoryAccessLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 }
const initials = (s: string) => s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
const inputCls = "w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

type Tab = "perfil" | "acesso" | "modulos" | "agenda" | "conta"

export function MemberProfileClient({ member, departments, numbers, currentUserId, currentUserRole, hasInventory = false, hasCrm = false, hasContacts = false, hasMarketing = false }: {
  member: TeamMember; departments: Department[]; numbers: { id: string; label: string; provider: string | null }[]
  currentUserId: string; currentUserRole: string; hasInventory?: boolean; hasCrm?: boolean; hasContacts?: boolean; hasMarketing?: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("perfil")
  const [flash, setFlashState] = useState<{ k: "ok" | "error"; t: string } | null>(null)
  const setFlash = (k: "ok" | "error", t: string) => { setFlashState({ k, t }); setTimeout(() => setFlashState(null), 3500) }

  // Estado editável (espelha a member-sheet + nome do perfil)
  const [fullName, setFullName]       = useState(member.full_name ?? "")
  const [role, setRole]               = useState<TenantRole>(member.role)
  const [departmentId, setDepartment] = useState<string>(member.department_id ?? "")
  const [supMode, setSupMode]         = useState<"none" | "scoped" | "all">(member.view_all ? "all" : (member.supervises_departments.length ? "scoped" : "none"))
  const [supDepts, setSupDepts]       = useState<string[]>(member.supervises_departments)
  const [seePool, setSeePool]         = useState(member.see_pool)
  const [invAccess, setInvAccess]     = useState<InventoryAccessLevel>(member.inventory_access)
  const [dealsAccess, setDealsAccess] = useState<InventoryAccessLevel>(member.deals_access)
  const [contactsAccess, setContactsAccess] = useState<InventoryAccessLevel>(member.contacts_access)
  const [marketingAccess, setMarketingAccess] = useState<InventoryAccessLevel>(member.marketing_access)
  const [instanceIds, setInstanceIds] = useState<string[]>(member.instance_ids ?? [])

  const [savePending, startSave]     = useTransition()
  const [statusPending, startStatus] = useTransition()
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  const isSelf       = member.user_id === currentUserId
  const isOwner      = member.role === "owner"
  const canEditRole  = currentUserRole === "owner" && !isOwner
  const canEditOther = !isOwner || currentUserRole === "owner"
  const name = fullName.trim() || member.email

  const dirty =
    fullName.trim() !== (member.full_name ?? "") || role !== member.role ||
    (departmentId || null) !== member.department_id || (supMode === "all") !== member.view_all ||
    seePool !== member.see_pool || invAccess !== member.inventory_access || dealsAccess !== member.deals_access || contactsAccess !== member.contacts_access || marketingAccess !== member.marketing_access ||
    !sameSet(supMode === "scoped" ? supDepts : [], member.supervises_departments) ||
    !sameSet(instanceIds, member.instance_ids ?? [])

  function handleSave() {
    startSave(async () => {
      let err: string | null = null
      const run = async (p: Promise<{ error?: string }>) => { const r = await p; if (r.error) err = r.error }

      if (fullName.trim() !== (member.full_name ?? "")) await run(updateMemberProfile(member.user_id, { fullName }))
      if (role !== member.role) await run(updateMemberRole(member.user_id, role))
      if ((departmentId || null) !== member.department_id) await run(updateMemberDepartment(member.user_id, departmentId || null))
      if ((supMode === "all") !== member.view_all) await run(toggleMemberViewAll(member.user_id, supMode === "all"))
      const targetSup = supMode === "scoped" ? supDepts : []
      if (!sameSet(targetSup, member.supervises_departments)) await run(setMemberSupervises(member.user_id, targetSup))
      if (seePool !== member.see_pool) await run(toggleMemberSeePool(member.user_id, seePool))
      if (invAccess !== member.inventory_access) await run(setMemberInventoryAccess(member.user_id, invAccess))
      if (dealsAccess !== member.deals_access) await run(setMemberDealsAccess(member.user_id, dealsAccess))
      if (contactsAccess !== member.contacts_access) await run(setMemberContactsAccess(member.user_id, contactsAccess))
      if (marketingAccess !== member.marketing_access) await run(setMemberMarketingAccess(member.user_id, marketingAccess))
      if (!sameSet(instanceIds, member.instance_ids ?? [])) await run(updateMemberInstances(member.user_id, instanceIds))

      if (err) { setFlash("error", err); return }
      setFlash("ok", "Alterações salvas")
      router.refresh()
    })
  }

  function toggleStatus() {
    startStatus(async () => {
      const r = await setMemberActive(member.user_id, !member.active)
      if (r.error) setFlash("error", r.error)
      else { setFlash("ok", member.active ? "Atendente desativado" : "Atendente reativado"); router.refresh() }
    })
  }

  // Estoque: caixas cumulativas Ver → Gerenciar (o "Editar" não aparece — escrever = Gerenciar).
  function invClick(tier: InventoryAccessLevel) {
    if (!canEditOther) return
    if (INV_ORDER[invAccess] >= INV_ORDER[tier]) setInvAccess(tier === "manage" ? "view" : "none")
    else setInvAccess(tier)
  }
  // Negócios: mesma escada Ver → Gerenciar (Ver = os dele; Gerenciar = todos + config).
  function dealsClick(tier: InventoryAccessLevel) {
    if (!canEditOther) return
    if (INV_ORDER[dealsAccess] >= INV_ORDER[tier]) setDealsAccess(tier === "manage" ? "view" : "none")
    else setDealsAccess(tier)
  }
  // Contatos: Ver = os dele (por relação) · Gerenciar = base toda + importar/mesclar.
  function contactsClick(tier: InventoryAccessLevel) {
    if (!canEditOther) return
    if (INV_ORDER[contactsAccess] >= INV_ORDER[tier]) setContactsAccess(tier === "manage" ? "view" : "none")
    else setContactsAccess(tier)
  }
  // Marketing: Ver = ver campanhas/resultados · Gerenciar = criar/disparar + configurar listas.
  function marketingClick(tier: InventoryAccessLevel) {
    if (!canEditOther) return
    if (INV_ORDER[marketingAccess] >= INV_ORDER[tier]) setMarketingAccess(tier === "manage" ? "view" : "none")
    else setMarketingAccess(tier)
  }

  const TABS: { id: Tab; label: string; icon: typeof User }[] = [
    { id: "perfil",  label: "Perfil", icon: User },
    { id: "acesso",  label: "Função & Visibilidade", icon: ShieldCheck },
    { id: "modulos", label: "Módulos", icon: LayoutGrid },
    { id: "agenda",  label: "Agenda", icon: CalendarDays },
    { id: "conta",   label: "Conta", icon: Settings2 },
  ]

  return (
    <div className="min-h-full bg-canvas px-4 sm:px-6 py-6">
      <nav className="text-xs font-semibold text-slate-400 mb-4 flex items-center gap-1.5">
        <Link href="/configuracoes/equipe" className="hover:text-primary">Equipe</Link>
        <span className="opacity-50">›</span><span className="text-slate-600">{name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Identidade */}
        <aside className="bg-white rounded-2xl border border-slate-200 p-5 lg:sticky lg:top-4 shadow-card">
          <div className="size-16 rounded-2xl grid place-items-center text-2xl font-extrabold text-white" style={{ background: "linear-gradient(135deg,#6366f1,#3b82f6)" }}>{initials(name)}</div>
          <h1 className="text-lg font-extrabold text-slate-900 mt-3.5 leading-tight break-words">{name}</h1>
          <p className="text-xs text-slate-400 break-all">{member.email}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-primary-50 text-primary">{ROLE_LABEL[member.role]}</span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              <span className={`size-1.5 rounded-full ${member.active ? "bg-emerald-500" : "bg-slate-400"}`} />{member.active ? "Ativo" : "Inativo"}
            </span>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2.5 text-[13px]">
            <Meta icon={Building2} k="Departamento" v={member.department?.name ?? "—"} />
            <Meta icon={CalendarDays} k="Membro desde" v={new Date(member.joined_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })} />
          </div>
          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Resumo de acesso</p>
            {accessSummary(supMode, seePool, instanceIds.length, invAccess, member.role).map((line, i) => (
              <p key={i} className="flex items-center gap-2 text-[12px] text-slate-600 py-0.5"><Check className="size-3 text-emerald-500 shrink-0" />{line}</p>
            ))}
          </div>
        </aside>

        {/* Painel */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
          <div className="flex gap-1 p-1.5 border-b border-slate-100 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition-colors ${tab === t.id ? "bg-primary-50 text-primary" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {(isOwner || isSelf) && (
              <div className={`flex items-start gap-2 px-3 py-2 rounded-lg mb-5 ${isOwner ? "bg-amber-50 border border-amber-100" : "bg-slate-50 border border-slate-200"}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isOwner ? "text-amber-700" : "text-slate-600"}`}>{isOwner ? "Owner" : "Você"}</span>
                <p className={`text-[11px] leading-relaxed ${isOwner ? "text-amber-800" : "text-slate-600"}`}>
                  {isOwner ? "Owner do tenant — papel muda só via “Transferir posse”." : "Sua própria conta — desativar e mudar o próprio papel estão bloqueados."}
                </p>
              </div>
            )}

            {/* PERFIL */}
            {tab === "perfil" && (
              <Section title="Perfil" sub="Dados da pessoa. O e-mail é o login e não muda por aqui.">
                <div className="flex items-center gap-4 mb-5">
                  <div className="size-14 rounded-2xl grid place-items-center text-xl font-extrabold text-white" style={{ background: "linear-gradient(135deg,#6366f1,#3b82f6)" }}>{initials(name)}</div>
                  <div className="text-[11px] text-slate-400">A foto usa as iniciais por enquanto.</div>
                </div>
                <div className="max-w-md space-y-4">
                  <Field label="Nome"><input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!canEditOther} maxLength={80} className={inputCls} placeholder="Nome da pessoa" /></Field>
                  <Field label="E-mail (login)" hint="Pra trocar o e-mail, a pessoa confirma pelo próprio login."><input value={member.email} disabled className={`${inputCls} bg-slate-50 text-slate-400`} /></Field>
                </div>
              </Section>
            )}

            {/* ACESSO */}
            {tab === "acesso" && (
              <Section title="Função & Visibilidade" sub="O que ela pode fazer e quais conversas enxerga.">
                <div className="max-w-lg space-y-5">
                  <Field label="Papel" hint={!canEditRole ? "Apenas o owner muda papéis." : undefined}>
                    <SimpleSelect value={role} onChange={(v) => setRole(v as TenantRole)} disabled={!canEditRole || isSelf} options={[
                      { value: "agent", label: "Atendente — atende conversas" },
                      { value: "admin", label: "Admin — gerencia equipe e config" },
                      { value: "owner", label: "Owner — só um por tenant", disabled: true },
                    ]} />
                  </Field>
                  <Field label="Departamento" hint="Habilita a fila do setor: passa a ver os não-atribuídos do departamento.">
                    <SimpleSelect value={departmentId} onChange={setDepartment} disabled={!canEditOther}
                      options={[{ value: "", label: "— Sem departamento —" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
                  </Field>

                  <div className="pt-2">
                    <p className="text-sm font-semibold text-slate-800">Supervisão</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 mb-2">O que ela vê do trabalho dos <strong>outros</strong> atendentes.</p>
                    <Segmented value={supMode} disabled={!canEditOther} onChange={(v) => setSupMode(v as typeof supMode)}
                      options={[{ v: "none", l: "Não" }, { v: "scoped", l: "Setores" }, { v: "all", l: "Geral" }]} />
                    <p className="text-[11px] text-slate-500 mt-2">
                      {supMode === "none" ? "Vê só o que é dela + a fila do setor dela." : supMode === "all" ? "Vê todas as conversas do tenant." : "Vê tudo dos setores marcados — inclusive com dono."}
                    </p>
                    {supMode === "scoped" && (
                      <div className="space-y-1.5 mt-2">
                        {departments.length === 0 && <p className="text-[11px] text-slate-400">Nenhum departamento cadastrado.</p>}
                        {departments.map((d) => (
                          <CheckRow key={d.id} checked={supDepts.includes(d.id)} disabled={!canEditOther}
                            onChange={(c) => setSupDepts((p) => c ? [...p, d.id] : p.filter((x) => x !== d.id))}>
                            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} /><span className="text-sm text-slate-700">{d.name}</span>
                          </CheckRow>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className={`flex items-start gap-3 pt-2 ${supMode === "all" ? "cursor-not-allowed" : "cursor-pointer"}`}>
                    <input type="checkbox" checked={supMode === "all" ? true : seePool} onChange={(e) => setSeePool(e.target.checked)} disabled={!canEditOther || supMode === "all"}
                      className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">Ver conversas não atribuídas (fila geral)</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{supMode === "all" ? "Como vê tudo, já enxerga a fila." : "Desligado = só vê o atribuído a ela ou que participa."}</p>
                      {supMode !== "all" && !seePool && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5 leading-relaxed">⚠️ Só verá o atribuído a ela — garanta a Distribuição automática ligada.</p>
                      )}
                    </div>
                  </label>

                  {role === "agent" && numbers.length > 1 && (
                    <div className="pt-2">
                      <p className="text-sm font-semibold text-slate-800">Números que atende</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 mb-2">Marque os números dela. <strong>Nenhum = todos.</strong></p>
                      <div className="space-y-1.5">
                        {numbers.map((n) => (
                          <CheckRow key={n.id} checked={instanceIds.includes(n.id)} disabled={!canEditOther}
                            onChange={(c) => setInstanceIds((p) => c ? [...p, n.id] : p.filter((x) => x !== n.id))}>
                            <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded ${n.provider === "meta_cloud" ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-500"}`}>
                              {n.provider === "meta_cloud" ? <BadgeCheck className="size-3" /> : <Smartphone className="size-3" />}
                            </span><span className="text-sm text-slate-700">{n.label}</span>
                          </CheckRow>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* MODULOS */}
            {tab === "modulos" && (
              <Section title="Acessos por módulo" sub="Libere só o que faz sentido. Owner e admin têm tudo. Módulos novos aparecem aqui.">
                {member.role !== "agent" ? (
                  <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">{ROLE_LABEL[member.role]} já tem acesso total a todos os módulos. Os acessos por módulo valem pra atendentes.</p>
                ) : (
                  <div className="space-y-2.5">
                    {hasContacts && (
                      <ModuleRow icon={Contact} iconCls="bg-primary-50 text-primary" name="Contatos" desc="Ver = só os contatos dele (por relação) · Gerenciar = base inteira, importar e mesclar.">
                        <div className="flex gap-2">
                          {([{ lvl: "view", l: "Ver" }, { lvl: "manage", l: "Gerenciar" }] as const).map(({ lvl, l }) => (
                            <PermBox key={lvl} label={l} on={INV_ORDER[contactsAccess] >= INV_ORDER[lvl]} disabled={!canEditOther} onClick={() => contactsClick(lvl)} />
                          ))}
                        </div>
                      </ModuleRow>
                    )}
                    {hasCrm && (
                      <ModuleRow icon={Briefcase} iconCls="bg-primary-50 text-primary" name="Negócios" desc="Ver = trabalha os negócios dele · Gerenciar = vê todos, configura funis e painel.">
                        <div className="flex gap-2">
                          {([{ lvl: "view", l: "Ver" }, { lvl: "manage", l: "Gerenciar" }] as const).map(({ lvl, l }) => (
                            <PermBox key={lvl} label={l} on={INV_ORDER[dealsAccess] >= INV_ORDER[lvl]} disabled={!canEditOther} onClick={() => dealsClick(lvl)} />
                          ))}
                        </div>
                      </ModuleRow>
                    )}
                    {hasInventory && (
                      <ModuleRow icon={Boxes} iconCls="bg-primary-50 text-primary" name="Estoque" desc="Ver = consultar saldo e extrato · Gerenciar = movimentar e configurar.">
                        <div className="flex gap-2">
                          {([{ lvl: "view", l: "Ver" }, { lvl: "manage", l: "Gerenciar" }] as const).map(({ lvl, l }) => (
                            <PermBox key={lvl} label={l} on={INV_ORDER[invAccess] >= INV_ORDER[lvl]} disabled={!canEditOther} onClick={() => invClick(lvl)} />
                          ))}
                        </div>
                      </ModuleRow>
                    )}
                    {hasMarketing && (
                      <ModuleRow icon={Megaphone} iconCls="bg-primary-50 text-primary" name="Marketing" desc="Ver = ver campanhas e resultados · Gerenciar = criar, disparar e configurar listas.">
                        <div className="flex gap-2">
                          {([{ lvl: "view", l: "Ver" }, { lvl: "manage", l: "Gerenciar" }] as const).map(({ lvl, l }) => (
                            <PermBox key={lvl} label={l} on={INV_ORDER[marketingAccess] >= INV_ORDER[lvl]} disabled={!canEditOther} onClick={() => marketingClick(lvl)} />
                          ))}
                        </div>
                      </ModuleRow>
                    )}
                    <ModuleRow icon={Landmark} iconCls="bg-emerald-50 text-emerald-600" name="Financeiro" soon desc="Contas a receber, fluxo de caixa." />
                    <ModuleRow icon={FileText} iconCls="bg-fuchsia-50 text-fuchsia-600" name="Fiscal (NF-e)" soon desc="Emissão e gestão de notas." />
                  </div>
                )}
              </Section>
            )}

            {/* AGENDA */}
            {tab === "agenda" && (
              <Section title="Acesso a agendas" sub="A Agenda é por-recurso (estilo Outlook): você delega a agenda de cada atendente. Mais nuançado que Ver/Gerenciar — por isso tem aba própria.">
                {member.role !== "agent" ? (
                  <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">{ROLE_LABEL[member.role]} já enxerga e gerencia todas as agendas.</p>
                ) : (
                  <AgendaAccessPanel memberUserId={member.user_id} onFeedback={setFlash} />
                )}
              </Section>
            )}

            {/* CONTA */}
            {tab === "conta" && (
              <Section title="Conta" sub="Situação da conta desta pessoa.">
                {isSelf || isOwner ? (
                  <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">{isOwner ? "O owner não pode ser desativado." : "Você não pode desativar a própria conta."}</p>
                ) : (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-danger mb-2">Zona de perigo</p>
                    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-danger-bg px-4 py-3">
                      <AlertTriangle className="size-5 text-danger shrink-0" />
                      <div className="flex-1">
                        <b className="text-sm text-danger">{member.active ? "Desativar atendente" : "Reativar atendente"}</b>
                        <p className="text-[12px] text-slate-600 mt-0.5">{member.active ? "Perde acesso na hora; as conversas dela vão pra fila. Reversível." : "Volta a ter acesso."}</p>
                      </div>
                      {member.active ? (
                        <button onClick={() => setConfirmDeactivate(true)} disabled={statusPending} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-red-300 bg-white hover:bg-danger hover:text-white text-danger rounded-lg disabled:opacity-50">
                          {statusPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />} Desativar
                        </button>
                      ) : (
                        <button onClick={toggleStatus} disabled={statusPending} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg disabled:opacity-50">
                          {statusPending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Reativar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Section>
            )}
          </div>

          {/* Save bar (some no Conta, que salva na hora) */}
          {tab !== "conta" && (
            <div className="sticky bottom-0 flex items-center gap-3 px-6 py-3.5 border-t border-slate-100 bg-white">
              {flash && <span className={`text-[12px] font-semibold ${flash.k === "ok" ? "text-emerald-600" : "text-red-600"}`}>{flash.t}</span>}
              <span className="ml-auto text-[11px] text-slate-400">{dirty ? "Alterações não salvas" : "Tudo salvo"}</span>
              <button onClick={handleSave} disabled={savePending || !dirty}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
                {savePending && <Loader2 className="size-3.5 animate-spin" />} Salvar alterações
              </button>
            </div>
          )}
        </section>
      </div>

      <DangerConfirm open={confirmDeactivate} title={`Desativar ${name}?`}
        body={<>Perde acesso até ser reativado. As conversas em que é responsável ficam <strong>sem atribuição</strong> na lista geral. Mensagens antigas são mantidas.</>}
        confirmLabel="Desativar" onConfirm={toggleStatus} onClose={() => setConfirmDeactivate(false)} />
    </div>
  )
}

function sameSet(a: string[], b: string[]) { return a.length === b.length && a.every((x) => b.includes(x)) }

function accessSummary(sup: string, pool: boolean, nums: number, inv: InventoryAccessLevel, role: TenantRole): string[] {
  if (role !== "agent") return ["Acesso total (admin)"]
  const out: string[] = []
  out.push(sup === "all" ? "Vê todas as conversas" : sup === "scoped" ? "Supervisiona setores" : pool ? "Vê a fila geral" : "Só o atribuído a ela")
  out.push(nums === 0 ? "Todos os números" : `${nums} número${nums > 1 ? "s" : ""}`)
  if (inv !== "none") out.push(`Estoque: ${inv === "view" ? "Ver" : "Gerenciar"}`)
  return out
}

function Meta({ icon: Icon, k, v }: { icon: typeof User; k: string; v: string }) {
  return <div className="flex items-start gap-2.5"><Icon className="size-4 text-slate-400 shrink-0 mt-0.5" /><div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</p><p className="text-[13px] font-semibold text-slate-700">{v}</p></div></div>
}
function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return <div><h2 className="text-[15px] font-bold text-slate-900">{title}</h2><p className="text-[12.5px] text-slate-400 mb-5">{sub}</p>{children}</div>
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-bold text-slate-700 mb-1.5">{label}</span>{children}{hint && <span className="block text-[11px] text-slate-400 mt-1.5">{hint}</span>}</label>
}
function Segmented({ value, options, disabled, onChange }: { value: string; options: { v: string; l: string }[]; disabled?: boolean; onChange: (v: string) => void }) {
  return <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5">
    {options.map((o) => <button key={o.v} type="button" disabled={disabled} onClick={() => onChange(o.v)}
      className={`flex-1 px-2 py-1.5 text-xs font-semibold rounded-md transition-colors disabled:opacity-50 ${value === o.v ? "bg-primary-50 text-primary" : "text-slate-500 hover:text-slate-800"}`}>{o.l}</button>)}
  </div>
}
function CheckRow({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (c: boolean) => void; children: React.ReactNode }) {
  return <label className={`flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-50"}`}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="size-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:opacity-50" />{children}
  </label>
}
function PermBox({ label, on, disabled, onClick }: { label: string; on: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`inline-flex items-center gap-2 border rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${on ? "border-primary-200 bg-primary-50 text-primary" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
    <span className={`size-4 rounded-[5px] border grid place-items-center ${on ? "bg-primary border-primary text-white" : "border-slate-300"}`}>{on && <Check className="size-3" />}</span>{label}
  </button>
}
function ModuleRow({ icon: Icon, iconCls, name, desc, soon, children }: { icon: typeof Boxes; iconCls: string; name: string; desc: string; soon?: boolean; children?: React.ReactNode }) {
  return <div className={`flex items-center gap-3.5 border border-slate-200 rounded-2xl p-4 ${soon ? "opacity-60 bg-slate-50/50" : "bg-white"}`}>
    <span className={`size-10 rounded-xl grid place-items-center shrink-0 ${iconCls}`}><Icon className="size-5" /></span>
    <div className="flex-1 min-w-0"><b className="text-sm font-bold text-slate-900 flex items-center gap-2">{name}{soon && <span className="text-[9.5px] font-extrabold uppercase tracking-wide bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full">Em breve</span>}</b><p className="text-[12px] text-slate-400">{desc}</p></div>
    {children}
  </div>
}

// ── Agenda: acesso por recurso (delegação estilo Outlook) ──
// Escada própria da Agenda mapeada ao frame Ver/Editar/Gerenciar:
//   none=Sem acesso · free_busy≈Ver (restrito) · details≈Ver (detalhado) · manage≈Editar/Gerenciar
const AGENDA_LEVELS: { v: "none" | ShareLevel; l: string; hint: string }[] = [
  { v: "none",      l: "Sem acesso", hint: "" },
  { v: "free_busy", l: "Restrita",   hint: "Ver só livre/ocupado (sem dados do cliente)" },
  { v: "details",   l: "Detalhada",  hint: "Ver a reunião completa (leitura)" },
  { v: "manage",    l: "Gerenciar",  hint: "Marca, cancela e remarca" },
]
function AgendaAccessPanel({ memberUserId, onFeedback }: { memberUserId: string; onFeedback: (k: "ok" | "error", t: string) => void }) {
  const [rows, setRows] = useState<MemberAgendaAccess[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSaving] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    listMemberAgendaAccess(memberUserId).then((r) => { if (on) { setRows(r); setLoading(false) } }).catch(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [memberUserId])
  async function setLevel(resourceId: string, level: "none" | ShareLevel) {
    setSaving(resourceId)
    const r = await setMemberAgendaAccess(memberUserId, resourceId, level)
    setSaving(null)
    if (r?.error) { onFeedback("error", r.error); return }
    setRows((prev) => prev.map((x) => (x.resource_id === resourceId ? { ...x, level: level === "none" ? null : level } : x)))
    onFeedback("ok", "Acesso à agenda atualizado")
  }

  if (loading) return <p className="text-center py-8"><Loader2 className="size-4 animate-spin inline text-slate-300" /></p>
  if (rows.length === 0) return (
    <div className="text-center py-10 bg-slate-50 border border-slate-200 rounded-xl">
      <CalendarDays className="size-7 text-slate-300 mx-auto mb-2" />
      <p className="text-sm font-semibold text-slate-600">Nenhuma agenda pra delegar</p>
      <p className="text-[12px] text-slate-400 mt-1 max-w-[38ch] mx-auto">Quando houver agendas de outros atendentes (recursos), você libera o acesso desta pessoa a cada uma aqui.</p>
    </div>
  )
  return (
    <div>
      {/* Legenda: níveis da Agenda ↔ Ver/Editar/Gerenciar */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4 text-[11px] text-slate-500">
        {AGENDA_LEVELS.filter((l) => l.hint).map((l) => (
          <span key={l.v} className="inline-flex items-center gap-1.5"><b className="text-slate-700">{l.l}</b> {l.hint}</span>
        ))}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.resource_id} className="rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-800 mb-2 truncate flex items-center gap-2"><CalendarDays className="size-4 text-slate-400" />{r.name}</p>
            <div className="inline-flex w-full rounded-lg border border-slate-200 bg-white p-0.5">
              {AGENDA_LEVELS.map((opt) => (
                <button key={opt.v} type="button" disabled={savingId === r.resource_id} onClick={() => setLevel(r.resource_id, opt.v)}
                  title={opt.hint} className={`flex-1 px-1 py-1.5 text-[11.5px] font-semibold rounded-md transition-colors disabled:opacity-50 ${(r.level ?? "none") === opt.v ? "bg-primary-50 text-primary" : "text-slate-500 hover:text-slate-800"}`}>{opt.l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
