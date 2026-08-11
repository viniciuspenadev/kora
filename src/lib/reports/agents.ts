// ═══════════════════════════════════════════════════════════════
// Relatório POR ATENDENTE — camada de dados (Fase 3 do atendimento mensurável)
// ═══════════════════════════════════════════════════════════════
// docs/transfer-node-design.md + mockup aprovado (docs/mockups/relatorio-atendentes.html).
// Fontes, por natureza do dado:
//   • conversation_events (append-only) → concluídas, retornos, transferências,
//     origem (fila/direto/transferência/IA), janelas expiradas. NÃO retroativo:
//     conta a partir do deploy da fundação (eventsSince marca a honestidade na UI).
//   • chat_messages → atendidas, séries diárias, 1ª resposta (mediana), SLA %,
//     templates (retroativos).
//   • chat_conversations → carteira / em aberto / sem resolver +48h (estado atual).
//   • agent_availability_log → pausas → % disponível no período.
// Deltas: o período ANTERIOR (mesma duração) é coletado com o mesmo core.
// PostgREST pagina em ~1000 rows → todo fetch de linhas usa fetchAll (paged).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

export interface Delta { current: number; previous: number }
export interface AgentTransferOut { label: string; count: number }

export interface AgentReportRow {
  id:         string
  name:       string
  department: string | null
  paused:     boolean
  // volume & velocidade (mensagens — retroativo)
  atendidas:  number
  dias:       number[]         // atendidas por dia (mesmo eixo de days)
  frSec:      number | null    // 1ª resposta (mediana)
  slaPct:     number | null    // % dentro da meta (null = sem meta)
  slaBreach:  number           // estouros da meta
  templates:  number
  // eventos (a partir da fundação)
  concluidas: number
  retornos:   number
  transferiu: number
  transfersOut: AgentTransferOut[]
  origem:     { fila: number; direto: number; transferencia: number; ia: number }
  janelas:    number
  // estado atual
  carteira:   number
  emAberto:   number
  drop48h:    number           // em aberto, cliente esperando há +48h
  // disponibilidade (período)
  pausedMin:  number
  availPct:   number
}

export interface AgentReportData {
  days:         string[]        // ISO (YYYY-MM-DD) — eixo das séries
  agents:       AgentReportRow[]
  teamDaily:    number[]        // atendidas da equipe por dia
  teamAvgDaily: number[]        // média por atendente por dia (ficha: ele vs equipe)
  kpis: {
    atendidas:  Delta
    concluidas: Delta
    frSec:      Delta           // 0 = sem dado
    slaPct:     Delta | null    // null = sem meta configurada
    retornos:   Delta
    atendidasDaily:  number[]   // sparkline
    concluidasDaily: number[]   // sparkline
  }
  oficial: {
    templates:    Delta
    janelas:      Delta
    reabertasPct: number | null // % das janelas expiradas recuperadas via template
    handbacks:    number
    planB:        number
  }
  slaTargetMin: number | null
  hasOfficial:  boolean
  eventsSince:  string | null
  periodDays:   number
  /** Mensagens recebidas por dia-da-semana × hora (horário de Brasília, UTC-3). */
  heatmap:      { dow: number; hour: number; count: number }[]
}

type Builder = (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>

/** Busca paginada (PostgREST corta em ~1000 rows por request). */
async function fetchAll<T>(build: Builder): Promise<T[]> {
  const PAGE = 1000
  let out: T[] = []
  for (let off = 0; ; off += PAGE) {
    const { data } = await build(off, off + PAGE - 1)
    const rows = (data ?? []) as T[]
    out = out.concat(rows)
    if (rows.length < PAGE) break
  }
  return out
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

interface AgentBase { id: string; name: string; department: string | null; paused: boolean }

// ═══ Core: coleta UM período (reusado pro atual e pro anterior) ═══
interface RangeCollect {
  perAgent: Map<string, {
    atendidas: number; dias: Map<string, Set<string>>; templates: number
    frDiffs: number[]
    concluidas: number; retornos: number; transferiu: number
    transfersOut: Map<string, number>
    origem: { fila: number; direto: number; transferencia: number; ia: number }
    janelas: number; pausedMin: number
  }>
  teamDailyMap: Map<string, Set<string>>     // dia → convs atendidas (equipe)
  concluidasDailyMap: Map<string, number>
  handbacks: number; planB: number; janelasTeam: number
  templatesTeam: number; retornosTeam: number
  windowEvents: { conversation_id: string; created_at: string }[]
  templateMsgs: { conversation_id: string; created_at: string }[]
}

async function collectRange(
  tenantId: string, from: string, to: string,
  agents: AgentBase[], agentName: Map<string, string>, deptName: Map<string, string>,
): Promise<RangeCollect> {
  const zero = () => ({
    atendidas: 0, dias: new Map<string, Set<string>>(), templates: 0, frDiffs: [] as number[],
    concluidas: 0, retornos: 0, transferiu: 0, transfersOut: new Map<string, number>(),
    origem: { fila: 0, direto: 0, transferencia: 0, ia: 0 }, janelas: 0, pausedMin: 0,
  })
  const perAgent = new Map(agents.map((a) => [a.id, zero()]))
  const get = (id: string | null) => (id ? perAgent.get(id) : undefined)

  // ── mensagens de atendente (atendidas + séries + templates) ──
  type AMsg = { conversation_id: string; sender_id: string | null; created_at: string; template: string | null }
  const agentMsgs = await fetchAll<AMsg>((a, b) =>
    supabaseAdmin.from("chat_messages")
      .select("conversation_id, sender_id, created_at, template:metadata->>template")
      .eq("tenant_id", tenantId).eq("sender_type", "agent").eq("is_private_note", false)
      .gte("created_at", from).lt("created_at", to)
      .order("created_at", { ascending: true }).range(a, b))

  const teamDailyMap = new Map<string, Set<string>>()
  const seen = new Map<string, Set<string>>()
  const templateMsgs: { conversation_id: string; created_at: string }[] = []
  let templatesTeam = 0
  for (const m of agentMsgs) {
    const day = m.created_at.slice(0, 10)
    let t = teamDailyMap.get(day); if (!t) { t = new Set(); teamDailyMap.set(day, t) }
    t.add(m.conversation_id)
    if (m.template) { templatesTeam++; templateMsgs.push({ conversation_id: m.conversation_id, created_at: m.created_at }) }
    if (!m.sender_id) continue
    const e = get(m.sender_id); if (!e) continue
    let s = seen.get(m.sender_id); if (!s) { s = new Set(); seen.set(m.sender_id, s) }
    if (!s.has(m.conversation_id)) { s.add(m.conversation_id); e.atendidas++ }
    let d = e.dias.get(day); if (!d) { d = new Set(); e.dias.set(day, d) }
    d.add(m.conversation_id)
    if (m.template) e.templates++
  }

  // ── 1ª resposta: conversas CRIADAS no período ──
  const newConvs = await fetchAll<{ id: string }>((a, b) =>
    supabaseAdmin.from("chat_conversations").select("id")
      .eq("tenant_id", tenantId).gte("created_at", from).lt("created_at", to)
      .order("created_at", { ascending: true }).range(a, b))
  type FRMsg = { conversation_id: string; sender_type: string; sender_id: string | null; created_at: string }
  const frByConv = new Map<string, { contact?: number; agent?: number; agentId?: string | null }>()
  for (const ids of chunk(newConvs.map((c) => c.id), 150)) {
    const rows = await fetchAll<FRMsg>((a, b) =>
      supabaseAdmin.from("chat_messages")
        .select("conversation_id, sender_type, sender_id, created_at")
        .eq("tenant_id", tenantId).eq("is_private_note", false)
        .in("sender_type", ["contact", "agent"]).in("conversation_id", ids)
        .order("created_at", { ascending: true }).range(a, b))
    for (const m of rows) {
      const ts = new Date(m.created_at).getTime()
      const e = frByConv.get(m.conversation_id) ?? {}
      if (m.sender_type === "contact") { if (e.contact === undefined) e.contact = ts }
      else if (e.contact !== undefined && e.agent === undefined) { e.agent = ts; e.agentId = m.sender_id }
      frByConv.set(m.conversation_id, e)
    }
  }
  for (const e of frByConv.values()) {
    if (e.contact === undefined || e.agent === undefined || !e.agentId) continue
    get(e.agentId)?.frDiffs.push(Math.round((e.agent - e.contact) / 1000))
  }

  // ── eventos do ciclo ──
  type Ev = { type: string; actor_kind: string; actor_id: string | null; to_agent_id: string | null; department_id: string | null; reason: string | null; conversation_id: string; created_at: string }
  const events = await fetchAll<Ev>((a, b) =>
    supabaseAdmin.from("conversation_events")
      .select("type, actor_kind, actor_id, to_agent_id, department_id, reason, conversation_id, created_at")
      .eq("tenant_id", tenantId).gte("created_at", from).lt("created_at", to)
      .order("created_at", { ascending: true }).range(a, b))

  const concluidasDailyMap = new Map<string, number>()
  const windowEvents: { conversation_id: string; created_at: string }[] = []
  let handbacks = 0, planB = 0, janelasTeam = 0, retornosTeam = 0
  for (const ev of events) {
    switch (ev.type) {
      case "resolved": {
        const day = ev.created_at.slice(0, 10)
        concluidasDailyMap.set(day, (concluidasDailyMap.get(day) ?? 0) + 1)
        const e = get(ev.actor_id); if (e) e.concluidas++
        break
      }
      case "reopened": { retornosTeam++; const e = get(ev.to_agent_id); if (e) e.retornos++; break }
      case "transferred": {
        const a = get(ev.actor_kind === "agent" ? ev.actor_id : null)
        if (a) {
          a.transferiu++
          const label = ev.to_agent_id ? (agentName.get(ev.to_agent_id) ?? "Atendente")
            : ev.department_id ? (deptName.get(ev.department_id) ?? "Setor") : "Fila geral"
          a.transfersOut.set(label, (a.transfersOut.get(label) ?? 0) + 1)
        }
        const r = get(ev.to_agent_id); if (r) r.origem.transferencia++
        break
      }
      case "assigned": {
        const e = get(ev.to_agent_id); if (!e) break
        if (ev.reason === "auto_assign_pool") e.origem.fila++
        else e.origem.direto++
        break
      }
      case "ai_handback":    { handbacks++; const e = get(ev.to_agent_id); if (e) e.origem.ia++; break }
      case "plan_b":         planB++; break
      case "window_expired": {
        janelasTeam++
        windowEvents.push({ conversation_id: ev.conversation_id, created_at: ev.created_at })
        const e = get(ev.to_agent_id); if (e) e.janelas++
        break
      }
    }
  }

  // ── pausas → minutos pausado (pares pause→unpause; aberto fecha no fim) ──
  type Pause = { user_id: string; paused: boolean; paused_until: string | null; created_at: string }
  const pauses = await fetchAll<Pause>((a, b) =>
    supabaseAdmin.from("agent_availability_log")
      .select("user_id, paused, paused_until, created_at")
      .eq("tenant_id", tenantId).gte("created_at", from).lt("created_at", to)
      .order("created_at", { ascending: true }).range(a, b))
  const byUser = new Map<string, Pause[]>()
  for (const p of pauses) { const l = byUser.get(p.user_id) ?? []; l.push(p); byUser.set(p.user_id, l) }
  const toMs = new Date(to).getTime()
  for (const [uid, rows] of byUser) {
    const e = get(uid); if (!e) continue
    let start: number | null = null, cap: number | null = null, total = 0
    for (const r of rows) {
      const ts = new Date(r.created_at).getTime()
      if (r.paused) { if (start === null) { start = ts; cap = r.paused_until ? new Date(r.paused_until).getTime() : null } }
      else if (start !== null) { total += Math.max(0, Math.min(ts, cap ?? ts) - start); start = null; cap = null }
    }
    if (start !== null) total += Math.max(0, Math.min(cap ?? toMs, toMs) - start)
    e.pausedMin = Math.round(total / 60000)
  }

  return { perAgent, teamDailyMap, concluidasDailyMap, handbacks, planB, janelasTeam, templatesTeam, retornosTeam, windowEvents, templateMsgs }
}

// ═══ Entrada pública ═════════════════════════════════════════════
export async function getAgentReport(tenantId: string, fromISO: string, toISO: string): Promise<AgentReportData> {
  const fromD = new Date(fromISO), toD = new Date(toISO)
  const from = fromD.toISOString(), to = toD.toISOString()
  const spanMs = toD.getTime() - fromD.getTime()
  const prevFrom = new Date(fromD.getTime() - spanMs).toISOString()
  const periodDays = Math.max(1, Math.round(spanMs / 86_400_000))

  // ── base: membros + deptos + config ──
  const [{ data: members }, { data: depts }, { data: cfg }, { data: official }, { data: firstEvent }] = await Promise.all([
    supabaseAdmin.from("tenant_users")
      .select("user_id, department_id, auto_assign_paused, auto_assign_paused_until, profiles!tenant_users_user_id_fkey ( full_name )")
      .eq("tenant_id", tenantId).eq("active", true),
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
    supabaseAdmin.from("tenant_config").select("sla_first_response_minutes").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("whatsapp_instances").select("id").eq("tenant_id", tenantId).eq("provider", "meta_cloud").limit(1).maybeSingle(),
    supabaseAdmin.from("conversation_events").select("created_at").eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ])

  const deptName = new Map(((depts ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]))
  const now = Date.now()
  const agents: AgentBase[] = ((members ?? []) as {
    user_id: string; department_id: string | null
    auto_assign_paused: boolean | null; auto_assign_paused_until: string | null
    profiles: { full_name: string | null } | { full_name: string | null }[] | null
  }[]).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    const pausedActive = !!m.auto_assign_paused && (!m.auto_assign_paused_until || new Date(m.auto_assign_paused_until).getTime() > now)
    return { id: m.user_id, name: p?.full_name ?? "Atendente", department: m.department_id ? (deptName.get(m.department_id) ?? null) : null, paused: pausedActive }
  })
  const agentName = new Map(agents.map((a) => [a.id, a.name]))
  const slaTargetMin = (cfg?.sla_first_response_minutes as number | null | undefined) ?? null

  // ── coleta: período atual + anterior (deltas) + heatmap em paralelo ──
  const [cur, prev, inboundMsgs] = await Promise.all([
    collectRange(tenantId, from, to, agents, agentName, deptName),
    collectRange(tenantId, prevFrom, from, agents, agentName, deptName),
    // Heatmap: mensagens RECEBIDAS por dow×hora (Brasília = UTC-3 fixo).
    fetchAll<{ created_at: string }>((a, b) =>
      supabaseAdmin.from("chat_messages").select("created_at")
        .eq("tenant_id", tenantId).eq("sender_type", "contact").eq("is_private_note", false)
        .gte("created_at", from).lt("created_at", to)
        .order("created_at", { ascending: true }).range(a, b)),
  ])

  const heatCount = new Map<string, number>()
  for (const m of inboundMsgs) {
    const d = new Date(m.created_at)
    d.setUTCHours(d.getUTCHours() - 3)
    const key = `${d.getUTCDay()}:${d.getUTCHours()}`
    heatCount.set(key, (heatCount.get(key) ?? 0) + 1)
  }
  const heatmap: { dow: number; hour: number; count: number }[] = []
  for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) {
    heatmap.push({ dow, hour, count: heatCount.get(`${dow}:${hour}`) ?? 0 })
  }

  // ── estado atual por agente (carteira / em aberto / +48h) ──
  const cutoff48 = new Date(now - 48 * 3_600_000).toISOString()
  const stateCounts = await Promise.all(agents.map(async (a) => {
    const [cart, open, drop] = await Promise.all([
      supabaseAdmin.from("chat_conversations").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("assigned_to", a.id).is("archived_at", null),
      supabaseAdmin.from("chat_conversations").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("assigned_to", a.id).is("archived_at", null).in("status", ["open", "pending"]),
      supabaseAdmin.from("chat_conversations").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("assigned_to", a.id).is("archived_at", null)
        .in("status", ["open", "pending"]).eq("last_message_dir", "in").lt("last_message_at", cutoff48),
    ])
    return { id: a.id, carteira: cart.count ?? 0, emAberto: open.count ?? 0, drop48h: drop.count ?? 0 }
  }))
  const stateBy = new Map(stateCounts.map((s) => [s.id, s]))

  // ── eixo de dias ──
  const days: string[] = []
  for (const d = new Date(fromD); d < toD; d.setUTCDate(d.getUTCDate() + 1)) days.push(isoDay(d))
  const teamDaily = days.map((d) => cur.teamDailyMap.get(d)?.size ?? 0)
  const concluidasDaily = days.map((d) => cur.concluidasDailyMap.get(d) ?? 0)
  const teamAvgDaily = teamDaily.map((v) => (agents.length > 0 ? +(v / agents.length).toFixed(1) : 0))

  // ── linhas por agente ──
  const effectiveMin = Math.max(1, Math.round((Math.min(now, toD.getTime()) - fromD.getTime()) / 60000))
  const allFrCur: number[] = [], allFrPrev: number[] = []
  const rows: AgentReportRow[] = agents.map((a) => {
    const e = cur.perAgent.get(a.id)!
    allFrCur.push(...e.frDiffs)
    allFrPrev.push(...(prev.perAgent.get(a.id)?.frDiffs ?? []))
    const fr = median(e.frDiffs)
    const withinTarget = slaTargetMin !== null ? e.frDiffs.filter((d) => d <= slaTargetMin * 60).length : 0
    return {
      id: a.id, name: a.name, department: a.department, paused: a.paused,
      atendidas: e.atendidas,
      dias: days.map((d) => e.dias.get(d)?.size ?? 0),
      frSec: fr,
      slaPct: slaTargetMin !== null && e.frDiffs.length > 0 ? Math.round((withinTarget / e.frDiffs.length) * 100) : null,
      slaBreach: slaTargetMin !== null ? e.frDiffs.length - withinTarget : 0,
      templates: e.templates,
      concluidas: e.concluidas, retornos: e.retornos, transferiu: e.transferiu,
      transfersOut: [...e.transfersOut.entries()].map(([label, count]) => ({ label, count })).sort((x, y) => y.count - x.count),
      origem: e.origem, janelas: e.janelas,
      carteira: stateBy.get(a.id)?.carteira ?? 0,
      emAberto: stateBy.get(a.id)?.emAberto ?? 0,
      drop48h: stateBy.get(a.id)?.drop48h ?? 0,
      pausedMin: e.pausedMin,
      availPct: Math.max(0, Math.min(100, Math.round(100 - (e.pausedMin / effectiveMin) * 100))),
    }
  }).sort((x, y) => y.atendidas - x.atendidas)

  // ── KPIs da equipe (atual vs anterior) ──
  const sum = (c: RangeCollect, f: (e: NonNullable<ReturnType<RangeCollect["perAgent"]["get"]>>) => number) =>
    [...c.perAgent.values()].reduce((s, e) => s + f(e), 0)
  const slaOf = (diffs: number[]) => slaTargetMin !== null && diffs.length > 0
    ? Math.round((diffs.filter((d) => d <= slaTargetMin * 60).length / diffs.length) * 100) : 0

  // reabertas via template: janela expirou e DEPOIS saiu template na mesma conversa
  const recovered = cur.windowEvents.filter((w) =>
    cur.templateMsgs.some((m) => m.conversation_id === w.conversation_id && m.created_at > w.created_at)).length

  return {
    days,
    agents: rows,
    teamDaily, teamAvgDaily,
    kpis: {
      atendidas:  { current: sum(cur, (e) => e.atendidas),  previous: sum(prev, (e) => e.atendidas) },
      concluidas: { current: sum(cur, (e) => e.concluidas), previous: sum(prev, (e) => e.concluidas) },
      frSec:      { current: median(allFrCur) ?? 0,          previous: median(allFrPrev) ?? 0 },
      slaPct:     slaTargetMin !== null ? { current: slaOf(allFrCur), previous: slaOf(allFrPrev) } : null,
      retornos:   { current: cur.retornosTeam, previous: prev.retornosTeam },
      atendidasDaily: teamDaily,
      concluidasDaily,
    },
    oficial: {
      templates:    { current: cur.templatesTeam, previous: prev.templatesTeam },
      janelas:      { current: cur.janelasTeam,   previous: prev.janelasTeam },
      reabertasPct: cur.janelasTeam > 0 ? Math.round((recovered / cur.janelasTeam) * 100) : null,
      handbacks:    cur.handbacks,
      planB:        cur.planB,
    },
    slaTargetMin,
    hasOfficial: !!official,
    eventsSince: (firstEvent?.created_at as string | undefined) ?? null,
    periodDays,
    heatmap,
  }
}
