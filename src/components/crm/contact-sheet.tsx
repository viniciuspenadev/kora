"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  X, Loader2, MessageSquare, ExternalLink, Trophy, XCircle, Briefcase, Calendar,
  User, CheckSquare, TrendingUp, Wallet, RefreshCcw, ShoppingBag, Clock, Plus,
  Tag as TagIcon, ListChecks, Check, Bot,
} from "lucide-react"
import { ContactPic } from "@/components/chat/contact-pic"
import { getContactSheet, type ContactSheetData } from "@/lib/actions/contact-sheet"
import type { ActivityItem } from "@/lib/actions/deals"
import { applyTag, removeTag } from "@/lib/actions/tags"
import { addContactsToList, removeContactFromList } from "@/lib/actions/lists"
import { setTaskDone } from "@/lib/actions/tasks"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"

// ─────────────────────────────────────────────────────────────────
// Contato 360 — sheet lateral (tela 4 da referência, "com vida"):
// banda + avatar grande · tags e LISTAS gerenciáveis aqui mesmo · KPIs em
// cards com ícone colorido · dossiê com timeline conectada, atividades com
// concluir e negócios ricos. Define a linguagem da futura repaginação do
// detalhe do negócio. Uma superfície, N portas (board · roster).
// ─────────────────────────────────────────────────────────────────

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?"
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })

const LIFE: Record<string, { label: string; cls: string }> = {
  contact:  { label: "Contato",  cls: "bg-slate-100 text-slate-600" },
  lead:     { label: "Lead",     cls: "bg-sky-50 text-sky-700" },
  customer: { label: "Cliente",  cls: "bg-emerald-50 text-emerald-700" },
  won:      { label: "Cliente",  cls: "bg-emerald-50 text-emerald-700" },
  lost:     { label: "Perdido",  cls: "bg-red-50 text-red-600" },
  unfit:    { label: "Fora do perfil", cls: "bg-amber-50 text-amber-700" },
}

type DossierTab = "historico" | "atividades" | "negocios"
type InfoTab    = "perfil" | "endereco" | "campos"

export function ContactSheet({ contactId, onClose }: { contactId: string | null; onClose: () => void }) {
  const router = useRouter()
  const [data, setData]   = useState<ContactSheetData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab]     = useState<DossierTab>("historico")
  const [info, setInfo]   = useState<InfoTab>("perfil")
  const [pending, start]  = useTransition()

  useEffect(() => {
    if (!contactId) return
    // Reset síncrono intencional: novo contato → limpa o sheet antes do fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null); setError(null); setTab("historico"); setInfo("perfil")
    let alive = true
    getContactSheet(contactId)
      .then((r) => { if (!alive) return; if ("error" in r) setError(r.error); else setData(r) })
      .catch(() => { if (alive) setError("Falha ao carregar o contato") })
    return () => { alive = false }
  }, [contactId])

  useEffect(() => {
    if (!contactId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [contactId, onClose])

  // KPIs comerciais — derivados dos negócios GANHOS (compras) do contato.
  const commerce = useMemo(() => {
    const deals = data?.record.deals ?? []
    const won = deals.filter((d) => d.status === "won" && d.won_at)
    const total = won.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
    const compras = won.length
    const ciclo = compras ? Math.round(won.reduce((s, d) => s + daysBetween(d.created_at, d.won_at as string), 0) / compras) : null
    const ultima = compras ? won.map((d) => d.won_at as string).sort().reverse()[0] : null
    return {
      ticket: compras ? total / compras : null,
      total, compras, ciclo,
      ultimaDias: ultima ? daysBetween(ultima, new Date().toISOString()) : null,
    }
  }, [data])

  // ── mutações inline (tags · listas · concluir tarefa) ──────────
  function toggleTag(tagId: string, next: boolean) {
    if (!data || !contactId) return
    const tag = data.allTags.find((t) => t.id === tagId)
    if (!tag) return
    setData({ ...data, tags: next ? [...data.tags, tag].sort((a, b) => a.name.localeCompare(b.name)) : data.tags.filter((t) => t.id !== tagId) })
    start(async () => {
      try { if (next) await applyTag(tagId, "contact", contactId); else await removeTag(tagId, "contact", contactId) }
      catch (e) { alert((e as Error).message) }
    })
  }

  function toggleList(listId: string, next: boolean) {
    if (!data || !contactId) return
    setData({ ...data, memberListIds: next ? [...data.memberListIds, listId] : data.memberListIds.filter((id) => id !== listId) })
    start(async () => {
      try { if (next) await addContactsToList(listId, [contactId]); else await removeContactFromList(listId, contactId) }
      catch (e) { alert((e as Error).message) }
    })
  }

  function doneTask(taskId: string) {
    if (!data) return
    setData({
      ...data,
      record: { ...data.record, deals: data.record.deals.map((d) => d.next_task?.id === taskId ? { ...d, next_task: null } : d) },
    })
    start(async () => {
      const r = await setTaskDone(taskId, true)
      if (r && "error" in r && r.error) alert(r.error)
    })
  }

  if (!contactId) return null
  const c    = data?.record.contact
  const name = c ? (c.custom_name?.trim() || c.push_name?.trim() || (c.phone_number ? formatPhoneDisplay(c.phone_number) : "Contato")) : ""
  const life = c?.lifecycle_stage ? LIFE[c.lifecycle_stage] : null
  const openConv = data?.record.conversations?.[0]?.id ?? null
  const pendingTasks = (data?.record.deals ?? []).flatMap((d) => d.next_task ? [{ ...d.next_task, dealName: d.name }] : [])
  const memberLists = (data?.lists ?? []).filter((l) => data?.memberListIds.includes(l.id))

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full sm:max-w-[1100px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* topo */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <h2 className="text-sm font-bold text-slate-900">Contato</h2>
          <div className="flex items-center gap-2">
            {pending && <Loader2 className="size-4 animate-spin text-slate-300" />}
            {c && (
              <Link href={`/contatos/${c.id}`} onClick={onClose}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
                <ExternalLink className="size-3" /> Ficha completa
              </Link>
            )}
            {openConv && (
              <button type="button" onClick={() => { onClose(); router.push(`/inbox?conversation=${openConv}`) }}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
                <MessageSquare className="size-3" /> Abrir conversa
              </button>
            )}
            <button type="button" onClick={onClose} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
          </div>
        </div>

        {!data && !error && (
          <div className="flex-1 grid place-items-center"><Loader2 className="size-5 animate-spin text-slate-300" /></div>
        )}
        {error && (
          <div className="flex-1 grid place-items-center"><p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">{error}</p></div>
        )}

        {data && c && (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr]">
            {/* ── identidade (esquerda) ── */}
            <div className="min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r border-slate-100">
              {/* banda + avatar GRANDE (referência) */}
              <div className="relative">
                <div className="h-20 bg-gradient-to-r from-primary-100 via-sky-100 to-primary-50" />
                <div className="px-5 -mt-10 text-center">
                  <span className="mx-auto size-20 rounded-full overflow-hidden grid place-items-center text-2xl font-bold text-white ring-4 ring-white shadow-md" style={{ background: "#004add" }}>
                    <ContactPic pic={c.profile_pic_url} imgClass="size-full object-cover" fallback={<span>{initials(name)}</span>} />
                  </span>
                  <p className="mt-2 text-lg font-bold text-slate-900 leading-tight">{name}</p>

                  {/* tags + "+" gerenciável aqui mesmo */}
                  <div className="mt-2 flex items-center justify-center gap-1 flex-wrap">
                    {life && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${life.cls}`}>{life.label}</span>}
                    {data.tags.map((t) => (
                      <span key={t.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}>{t.name}</span>
                    ))}
                    <DropdownMenu>
                      <DropdownMenuTrigger title="Adicionar/remover tags"
                        className="size-5 rounded-full grid place-items-center border border-dashed border-slate-300 text-slate-400 hover:border-primary hover:text-primary transition-colors">
                        <Plus className="size-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" className="w-52">
                        <div className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><TagIcon className="size-3" /> Tags</div>
                        {data.allTags.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-400">Nenhuma tag criada.</p>}
                        {data.allTags.map((t) => (
                          <DropdownMenuCheckboxItem key={t.id} checked={data.tags.some((x) => x.id === t.id)} closeOnClick={false}
                            onCheckedChange={(v) => toggleTag(t.id, v)}>
                            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                            <span className="truncate">{t.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* listas + "+ Adicionar listas" (referência, funcionando) */}
                  <div className="mt-1.5 flex items-center justify-center gap-1 flex-wrap">
                    {memberLists.map((l) => (
                      <span key={l.id} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100">
                        <ListChecks className="size-2.5" /> {l.name}
                      </span>
                    ))}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-primary hover:text-primary transition-colors">
                        <Plus className="size-2.5" /> Adicionar listas
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" className="w-52">
                        <div className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><ListChecks className="size-3" /> Listas estáticas</div>
                        {data.lists.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-400">Crie listas em Configurações → Comercial.</p>}
                        {data.lists.map((l) => (
                          <DropdownMenuCheckboxItem key={l.id} checked={data.memberListIds.includes(l.id)} closeOnClick={false}
                            onCheckedChange={(v) => toggleList(l.id, v)}>
                            <span className="truncate">{l.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              {/* KPIs 2×2 — cards com ícone colorido (referência) */}
              <div className="px-4 pt-4 pb-4 grid grid-cols-2 gap-2">
                <KpiCard icon={TrendingUp}  tint="#004add" label="Ticket médio"    value={commerce.ticket != null ? brl(commerce.ticket) : "R$ 0"} />
                <KpiCard icon={Wallet}      tint="#059669" label="Total"           value={brl(commerce.total)} />
                <KpiCard icon={RefreshCcw}  tint="#0284c7" label="Ciclo de compra" value={commerce.ciclo != null ? `${commerce.ciclo}d` : "0d"} />
                <KpiCard icon={ShoppingBag} tint="#7c3aed" label="Última compra"   value={commerce.ultimaDias != null ? `${commerce.ultimaDias}d` : "—"} sub={`${commerce.compras} compra${commerce.compras !== 1 ? "s" : ""}`} />
              </div>

              {/* Perfil | Endereço | Campos adicionais */}
              <div className="px-4 pb-5">
                <div className="flex items-center gap-1 border-b border-slate-100 mb-3">
                  {(["perfil", "endereco", "campos"] as InfoTab[]).map((t) => (
                    <button key={t} type="button" onClick={() => setInfo(t)}
                      className={`px-2.5 py-1.5 text-[11px] font-semibold border-b-2 -mb-px transition-colors ${info === t ? "border-primary text-primary-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                      {t === "perfil" ? "Perfil" : t === "endereco" ? "Endereço" : "Campos adicionais"}
                    </button>
                  ))}
                </div>
                {info === "perfil" && (
                  <dl className="space-y-2.5">
                    <InfoRow label="Nome" value={name} />
                    <InfoRow label="Empresa" value={c.company} />
                    <InfoRow label="E-mail" value={c.email} />
                    <InfoRow label="Telefone" value={c.phone_number ? formatPhoneDisplay(c.phone_number) : null} />
                    <InfoRow label="Documento" value={c.doc_id} />
                    <InfoRow label="Origem" value={c.source} />
                    <InfoRow label="Criado em" value={shortDate(c.created_at)} />
                  </dl>
                )}
                {info === "endereco" && (
                  <dl className="space-y-2.5">
                    <InfoRow label="Rua" value={[c.address_street, c.address_number].filter(Boolean).join(", ") || null} />
                    <InfoRow label="Complemento" value={c.address_complement} />
                    <InfoRow label="Bairro" value={c.address_district} />
                    <InfoRow label="Cidade" value={[c.address_city, c.address_state].filter(Boolean).join(" / ") || null} />
                    <InfoRow label="CEP" value={c.address_cep} />
                  </dl>
                )}
                {info === "campos" && (
                  <dl className="space-y-2.5">
                    {c.custom_fields && Object.keys(c.custom_fields).length > 0
                      ? Object.entries(c.custom_fields).map(([k, v]) => <InfoRow key={k} label={k} value={v == null || v === "" ? null : String(v)} />)
                      : <p className="text-[11px] text-slate-400">Nenhum campo adicional preenchido.</p>}
                  </dl>
                )}
              </div>
            </div>

            {/* ── dossiê (direita) ── */}
            <div className="min-h-0 flex flex-col">
              <div className="flex items-center gap-1 px-5 pt-3 border-b border-slate-100 shrink-0">
                {(["historico", "atividades", "negocios"] as DossierTab[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)}
                    className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-primary-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                    {t === "historico" ? "Histórico" : t === "atividades" ? `Atividades${pendingTasks.length ? ` (${pendingTasks.length})` : ""}` : `Negócios (${data.record.deals.length})`}
                  </button>
                ))}
              </div>

              {/* título + subtítulo do dossiê (referência) */}
              <div className="px-5 pt-4 pb-1 shrink-0">
                <h3 className="text-sm font-bold text-slate-900">{tab === "historico" ? "Histórico" : tab === "atividades" ? "Atividades" : "Negócios"}</h3>
                <p className="text-[11px] text-slate-400">
                  {tab === "historico" ? "Tudo que aconteceu com este contato, em ordem." : tab === "atividades" ? "Follow-ups pendentes dos negócios." : "A participação do contato no funil."}
                </p>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                {tab === "historico" && (
                  data.activity.length === 0 ? <Empty text="Sem eventos ainda." /> : (
                    /* timeline CONECTADA — círculos coloridos + linha (referência) */
                    <div className="relative">
                      <div className="absolute left-5 top-3 bottom-3 w-px bg-slate-200" aria-hidden />
                      <div className="space-y-2">
                        {data.activity.map((a) => <HistoryRow key={a.id} a={a} />)}
                      </div>
                    </div>
                  )
                )}

                {tab === "atividades" && (
                  pendingTasks.length === 0 ? <Empty text="Nenhuma atividade pendente. Crie follow-ups na ficha do negócio." /> : (
                    <div className="space-y-2">
                      {pendingTasks.map((t) => <TaskCard key={t.id} t={t} pending={pending} onDone={() => doneTask(t.id)} />)}
                    </div>
                  )
                )}

                {tab === "negocios" && (
                  data.record.deals.length === 0 ? <Empty text="Nenhum negócio ainda." /> : (
                    <div className="space-y-2">
                      {data.record.deals.map((d) => (
                        <button key={d.id} type="button" onClick={() => { onClose(); router.push(`/negocios/${d.id}`) }}
                          className="w-full flex items-center gap-3 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-soft px-3.5 py-3 text-left transition-all">
                          <StatusBadge status={d.status} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-900 truncate">{d.name?.trim() || "Negócio"}</p>
                            <p className="text-[10.5px] text-slate-400 truncate">{d.pipeline_name ?? "—"}{d.stage?.name ? ` · ${d.stage.name}` : ""}</p>
                          </div>
                          <DateBox iso={d.created_at} />
                          {d.status === "open" && d.stage_entered_at && (
                            <span className="hidden sm:block text-center shrink-0">
                              <span className="block text-xs font-bold text-slate-700 tabular-nums">{daysBetween(d.stage_entered_at, new Date().toISOString())}d</span>
                              <span className="block text-[9.5px] text-slate-400">na etapa</span>
                            </span>
                          )}
                          <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0 w-24 text-right">{d.estimated_value ? brl(Number(d.estimated_value)) : "—"}</span>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

// ── primitivas ────────────────────────────────────────────────────
function KpiCard({ icon: Icon, tint, label, value, sub }: { icon: typeof Wallet; tint: string; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-2.5 flex items-center gap-2.5">
      <span className="size-9 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${tint} 12%, transparent)`, color: tint }}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-400 leading-tight truncate">{label}</p>
        <p className="text-sm font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[9px] text-slate-400 leading-tight">{sub}</p>}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
      <dd className={`text-xs mt-0.5 break-words ${value ? "text-slate-700" : "text-slate-300"}`}>{value || "—"}</dd>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 text-center py-10">{text}</p>
}

function DateBox({ iso }: { iso: string }) {
  const d = new Date(iso)
  return (
    <span className="hidden sm:flex flex-col items-center justify-center size-10 rounded-lg border border-slate-200 shrink-0 leading-none">
      <span className="text-sm font-bold text-slate-800 tabular-nums">{d.getDate()}</span>
      <span className="text-[8.5px] uppercase text-slate-400 mt-0.5">{d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
    </span>
  )
}

const HIST_ICON: Record<ActivityItem["kind"], { icon: typeof User; cls: string }> = {
  deal_won:     { icon: Trophy,        cls: "bg-emerald-500 text-white" },
  deal_lost:    { icon: XCircle,       cls: "bg-red-400 text-white" },
  deal:         { icon: Briefcase,     cls: "bg-primary text-white" },
  conversation: { icon: MessageSquare, cls: "bg-slate-300 text-white" },
  appointment:  { icon: Calendar,      cls: "bg-violet-400 text-white" },
  lifecycle:    { icon: User,          cls: "bg-sky-400 text-white" },
  task:         { icon: CheckSquare,   cls: "bg-amber-400 text-white" },
}

function HistoryRow({ a }: { a: ActivityItem }) {
  const m = HIST_ICON[a.kind] ?? HIST_ICON.lifecycle
  const I = m.icon
  const when = new Date(a.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  return (
    <div className="relative flex items-start gap-3">
      <span className={`relative z-10 size-10 rounded-full grid place-items-center shrink-0 ring-4 ring-white ${m.cls}`}><I className="size-4" /></span>
      <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
        {/* corpo — texto rico: valores/mudança em destaque (referência) */}
        <div className="px-4 pt-2.5 pb-2">
          <p className="text-xs text-slate-800 leading-snug">
            {a.title}
            {a.change && (
              <> {" "}<span className="font-semibold text-primary-600 tabular-nums">{a.change.from ?? "—"}</span>
                <span className="text-slate-400"> para </span>
                <span className="font-semibold text-primary-600 tabular-nums">{a.change.to ?? "—"}</span></>
            )}
          </p>
          {a.sub && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{a.sub}</p>}
        </div>
        {/* rodapé — autor + data (referência) */}
        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
          {a.by ? (
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500 min-w-0">
              {a.byKind === "human" ? (
                <span className="size-4 rounded-full grid place-items-center text-[7px] font-bold text-white shrink-0" style={{ background: "#004add" }}>{initials(a.by)}</span>
              ) : (
                <span className="size-4 rounded-full grid place-items-center bg-slate-200 text-slate-500 shrink-0"><Bot className="size-2.5" /></span>
              )}
              <span className="truncate font-medium">{a.by}</span>
            </span>
          ) : <span />}
          <span className="ml-auto text-[10px] text-slate-400 tabular-nums shrink-0">{when}</span>
        </div>
      </div>
    </div>
  )
}

function TaskCard({ t, pending, onDone }: { t: { id: string; title: string; due_at: string | null; dealName: string | null }; pending: boolean; onDone: () => void }) {
  const due = t.due_at ? new Date(t.due_at) : null
  const now = new Date()
  const overdue = !!due && due < now
  const today   = !!due && due.toDateString() === now.toDateString()
  const tone = overdue ? "text-red-600" : today ? "text-amber-600" : "text-slate-600"
  const weekday = due ? due.toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "") : null

  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-slate-200 px-3.5 py-3">
      {due ? (
        <div className={`text-center shrink-0 w-16 ${tone}`}>
          <p className="text-[10px] font-semibold capitalize leading-tight">{weekday}</p>
          <p className="text-lg font-bold tabular-nums leading-tight">{due.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</p>
        </div>
      ) : (
        <div className="text-center shrink-0 w-16 text-slate-300"><Clock className="size-5 mx-auto" /></div>
      )}
      <div className="min-w-0 flex-1 border-l border-slate-100 pl-3.5">
        <p className="text-xs font-bold text-slate-900 truncate">{t.title}</p>
        <div className="flex items-center gap-2.5 mt-0.5 text-[10.5px] text-slate-400">
          {due && <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {due.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
          {t.dealName && <span className="truncate">{t.dealName}</span>}
          {overdue && <span className="text-red-600 font-semibold">atrasada</span>}
        </div>
      </div>
      <button type="button" disabled={pending} onClick={onDone} title="Concluir"
        className="size-8 rounded-full border-2 border-slate-200 text-transparent hover:border-emerald-400 hover:text-emerald-500 grid place-items-center transition-colors disabled:opacity-50 shrink-0">
        <Check className="size-4" strokeWidth={3} />
      </button>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "won")  return <span className="size-9 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center shrink-0"><Trophy className="size-4" /></span>
  if (status === "lost") return <span className="size-9 rounded-lg bg-red-50 text-red-500 grid place-items-center shrink-0"><XCircle className="size-4" /></span>
  return <span className="size-9 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Briefcase className="size-4" /></span>
}
