"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  X, Loader2, MessageSquare, ExternalLink, Trophy, XCircle, Briefcase, Calendar,
  User, CheckSquare, TrendingUp, Wallet, RefreshCcw, ShoppingBag, Clock,
} from "lucide-react"
import { ContactPic } from "@/components/chat/contact-pic"
import { getContactSheet, type ContactSheetData } from "@/lib/actions/contact-sheet"
import type { ActivityItem } from "@/lib/actions/deals"
import { formatPhoneDisplay } from "@/lib/phone-utils"

// ─────────────────────────────────────────────────────────────────
// Contato 360 — sheet lateral (tela 4 da referência): identidade + tags +
// 4 KPIs comerciais à esquerda · dossiê (Histórico | Atividades | Negócios)
// à direita. Uma superfície, N portas (board de Negócios é a primeira).
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

  useEffect(() => {
    if (!contactId) return
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

  if (!contactId) return null
  const c    = data?.record.contact
  const name = c ? (c.custom_name?.trim() || c.push_name?.trim() || (c.phone_number ? formatPhoneDisplay(c.phone_number) : "Contato")) : ""
  const life = c?.lifecycle_stage ? LIFE[c.lifecycle_stage] : null
  const openConv = data?.record.conversations?.[0]?.id ?? null
  const pendingTasks = (data?.record.deals ?? []).flatMap((d) => d.next_task ? [{ ...d.next_task, dealName: d.name }] : [])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full sm:max-w-[880px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* topo */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <h2 className="text-sm font-bold text-slate-900">Contato</h2>
          <div className="flex items-center gap-2">
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
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[300px_1fr]">
            {/* ── identidade (esquerda) ── */}
            <div className="min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r border-slate-100">
              {/* faixa + avatar (referência) */}
              <div className="bg-gradient-to-b from-primary-50 to-white pt-6 pb-3 px-5 text-center">
                <span className="mx-auto size-16 rounded-full overflow-hidden grid place-items-center text-lg font-bold text-white ring-4 ring-white shadow-sm" style={{ background: "#004add" }}>
                  <ContactPic pic={c.profile_pic_url} imgClass="size-full object-cover" fallback={<span>{initials(name)}</span>} />
                </span>
                <p className="mt-2 text-base font-bold text-slate-900 leading-tight">{name}</p>
                <div className="mt-1.5 flex items-center justify-center gap-1 flex-wrap">
                  {life && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${life.cls}`}>{life.label}</span>}
                  {data.tags.map((t) => (
                    <span key={t.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}>{t.name}</span>
                  ))}
                </div>
              </div>

              {/* KPIs comerciais 2×2 (referência: ticket · total · ciclo · última compra) */}
              <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                <KpiChip icon={TrendingUp}  label="Ticket médio"    value={commerce.ticket != null ? brl(commerce.ticket) : "R$ 0"} />
                <KpiChip icon={Wallet}      label="Total"           value={brl(commerce.total)} />
                <KpiChip icon={RefreshCcw}  label="Ciclo de compra" value={commerce.ciclo != null ? `${commerce.ciclo}d` : "0d"} />
                <KpiChip icon={ShoppingBag} label="Última compra"   value={commerce.ultimaDias != null ? `${commerce.ultimaDias}d` : "—"} sub={`${commerce.compras} compra${commerce.compras !== 1 ? "s" : ""}`} />
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
              <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100 shrink-0">
                {(["historico", "atividades", "negocios"] as DossierTab[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)}
                    className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-primary-700" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                    {t === "historico" ? "Histórico" : t === "atividades" ? `Atividades${pendingTasks.length ? ` (${pendingTasks.length})` : ""}` : `Negócios (${data.record.deals.length})`}
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {tab === "historico" && (
                  data.activity.length === 0 ? <Empty text="Sem eventos ainda." /> : (
                    <div className="space-y-0.5">
                      {data.activity.map((a) => <HistoryRow key={a.id} a={a} />)}
                    </div>
                  )
                )}

                {tab === "atividades" && (
                  pendingTasks.length === 0 ? <Empty text="Nenhuma atividade pendente. Crie follow-ups na ficha do negócio." /> : (
                    <div className="divide-y divide-slate-100">
                      {pendingTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-3 py-2.5">
                          <span className="size-7 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><CheckSquare className="size-3.5" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-800 truncate">{t.title}</p>
                            {t.dealName && <p className="text-[10.5px] text-slate-400 truncate">{t.dealName}</p>}
                          </div>
                          {t.due_at && (
                            <span className={`text-[10.5px] tabular-nums shrink-0 inline-flex items-center gap-1 ${new Date(t.due_at) < new Date() ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                              <Clock className="size-3" />{new Date(t.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}

                {tab === "negocios" && (
                  data.record.deals.length === 0 ? <Empty text="Nenhum negócio ainda." /> : (
                    <div className="divide-y divide-slate-100">
                      {data.record.deals.map((d) => (
                        <button key={d.id} type="button" onClick={() => { onClose(); router.push(`/negocios/${d.id}`) }}
                          className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors">
                          <StatusBadge status={d.status} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-800 truncate">{d.name?.trim() || "Negócio"}</p>
                            <p className="text-[10.5px] text-slate-400 truncate">
                              {d.pipeline_name ?? "—"}{d.stage?.name ? ` · ${d.stage.name}` : ""}
                            </p>
                          </div>
                          {d.status === "open" && d.stage_entered_at && (
                            <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{daysBetween(d.stage_entered_at, new Date().toISOString())}d na etapa</span>
                          )}
                          <span className="text-xs font-bold text-slate-800 tabular-nums shrink-0">{d.estimated_value ? brl(Number(d.estimated_value)) : "—"}</span>
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

function KpiChip({ icon: Icon, label, value, sub }: { icon: typeof Wallet; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[10px] text-slate-400 flex items-center gap-1"><Icon className="size-3 text-slate-300" /> {label}</p>
      <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[9.5px] text-slate-400">{sub}</p>}
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

const HIST_ICON: Record<ActivityItem["kind"], { icon: typeof User; cls: string }> = {
  deal_won:     { icon: Trophy,        cls: "bg-emerald-50 text-emerald-600" },
  deal_lost:    { icon: XCircle,       cls: "bg-red-50 text-red-500" },
  deal:         { icon: Briefcase,     cls: "bg-primary-50 text-primary-600" },
  conversation: { icon: MessageSquare, cls: "bg-slate-100 text-slate-500" },
  appointment:  { icon: Calendar,      cls: "bg-violet-50 text-violet-500" },
  lifecycle:    { icon: User,          cls: "bg-amber-50 text-amber-600" },
  task:         { icon: CheckSquare,   cls: "bg-sky-50 text-sky-600" },
}

function HistoryRow({ a }: { a: ActivityItem }) {
  const m = HIST_ICON[a.kind] ?? HIST_ICON.lifecycle
  const I = m.icon
  return (
    <div className="flex items-start gap-3 py-2">
      <span className={`size-7 rounded-full grid place-items-center shrink-0 ${m.cls}`}><I className="size-3.5" /></span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-xs text-slate-700 leading-snug">{a.title}{a.sub ? <span className="text-slate-400"> · {a.sub}</span> : null}</p>
      </div>
      <span className="text-[10px] text-slate-400 tabular-nums shrink-0 pt-1">{new Date(a.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "won")  return <span className="size-7 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center shrink-0"><Trophy className="size-3.5" /></span>
  if (status === "lost") return <span className="size-7 rounded-full bg-red-50 text-red-500 grid place-items-center shrink-0"><XCircle className="size-3.5" /></span>
  return <span className="size-7 rounded-full bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Briefcase className="size-3.5" /></span>
}
