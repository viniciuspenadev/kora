// ═══════════════════════════════════════════════════════════════
// Agenda 2.0 — board: forma normalizada do compromisso + normalizador
// ═══════════════════════════════════════════════════════════════
// TODA leitura passa por listAppointments (escada de visibilidade + redação
// free_busy já aplicadas no servidor). Aqui só normalizamos a linha crua (com
// embeds) para o formato que os cards/views/modal consomem — sem query inline.

import type { ResourceRow, ServiceRow } from "@/lib/actions/agenda"
import { minutesInTz, ymdInTz, isoFromDayMinute } from "./lanes"

/** Linha crua de listAppointments (com embeds de contato/serviço/recurso). */
export interface RawAppt {
  id: string; contact_id: string; conversation_id: string | null
  resource_id: string; service_id: string | null
  starts_at: string; ends_at: string; status: string; source: string; notes: string | null
  created_by?: string | null
  busy_only?: boolean
  chat_contacts?: { push_name: string | null; custom_name: string | null; phone_number: string | null; profile_pic_url?: string | null } | null
  tenant_services?: { name: string } | null
  tenant_resources?: { name: string } | null
}

/**
 * O que o bloco É. O quadro passou a mostrar três coisas (pedido do dono
 * 2026-08-20: *"quero um evento dentro do calendário, igual os agendamentos"* +
 * o follow-up **registrado lá dentro**, não como faixa fantasma):
 *
 *   appointment → compromisso COM cliente (tabela `appointments`)
 *   event       → compromisso interno do time (tabela `tenant_events`)
 *   followup    → a promessa de voltar a falar (estado da conversa)
 *
 * ⚠️ Só `appointment` ocupa a agenda. Os outros dois são **não-bloqueantes**
 *    (decisão do dono): aparecem como bloco e dividem o slot com o cliente.
 */
export type BoardKind = "appointment" | "event" | "followup"

export interface BoardAppt {
  id: string
  /** default "appointment" — o que não é agendamento não tem status/telefone/serviço. */
  kind: BoardKind
  /** Destino do clique quando não é agendamento (ex: follow-up abre a conversa). */
  href: string | null
  /** Só follow-up: já cumprido — fica no lugar, marcado (não some do calendário). */
  done?: boolean
  resourceId: string
  resourceAgentId: string | null   // dono da agenda → foto no badge da Semana-equipe
  serviceId: string | null
  conversationId: string | null
  createdBy: string | null
  dateKey: string          // YYYY-MM-DD (no fuso) do início
  startMin: number         // minuto-do-dia do início
  durMin: number           // duração em minutos
  startISO: string
  endISO: string
  status: string
  source: string
  busyOnly: boolean
  contactName: string
  phone: string | null
  serviceName: string | null
  servicePrice: number | null
  resourceName: string | null
  resourceKind: string | null
  resourceCapacity: number
  hasNotes: boolean
}

const contactName = (a: RawAppt): string =>
  a.busy_only ? "Ocupado" : (a.chat_contacts?.custom_name || a.chat_contacts?.push_name || a.chat_contacts?.phone_number || "Contato")

export function normalizeAppt(
  a: RawAppt,
  resources: Map<string, ResourceRow>,
  services: Map<string, ServiceRow>,
  notedIds: Set<string>,
): BoardAppt {
  const start = new Date(a.starts_at), end = new Date(a.ends_at)
  const durMin = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000))
  const res = resources.get(a.resource_id)
  const svc = a.service_id ? services.get(a.service_id) : undefined
  return {
    id: a.id,
    kind: "appointment",
    href: null,
    resourceId: a.resource_id,
    resourceAgentId: res?.assigned_agent_id ?? null,
    serviceId: a.service_id,
    conversationId: a.conversation_id,
    createdBy: a.created_by ?? null,
    dateKey: ymdInTz(start),
    startMin: minutesInTz(start),
    durMin,
    startISO: a.starts_at,
    endISO: a.ends_at,
    status: a.status,
    source: a.source,
    busyOnly: !!a.busy_only,
    contactName: contactName(a),
    phone: a.busy_only ? null : (a.chat_contacts?.phone_number ?? null),
    serviceName: a.tenant_services?.name ?? svc?.name ?? null,
    servicePrice: svc?.price ?? null,
    resourceName: a.tenant_resources?.name ?? res?.name ?? null,
    resourceKind: res?.kind ?? null,
    resourceCapacity: res?.capacity ?? 1,
    hasNotes: notedIds.has(a.id),
  }
}

/** Molde comum dos blocos que NÃO são agendamento: sem cliente, sem serviço,
 *  sem status. Some do lugar dos campos de venda pra o cartão não fingir dado. */
function blocoInterno(base: {
  id: string; kind: BoardKind; href: string | null
  resourceId: string; resourceAgentId: string | null; resourceName: string | null
  startISO: string; endISO: string; label: string; sub: string | null
}): BoardAppt {
  const start = new Date(base.startISO), end = new Date(base.endISO)
  return {
    id: base.id,
    kind: base.kind,
    href: base.href,
    resourceId: base.resourceId,
    resourceAgentId: base.resourceAgentId,
    serviceId: null,
    conversationId: null,
    createdBy: null,
    dateKey: ymdInTz(start),
    startMin: minutesInTz(start),
    durMin: Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000)),
    startISO: base.startISO,
    endISO: base.endISO,
    status: "scheduled",
    source: "manual",
    busyOnly: false,
    contactName: base.label,
    phone: null,
    serviceName: base.sub,
    servicePrice: null,
    resourceName: base.resourceName,
    resourceKind: null,
    resourceCapacity: 1,
    hasNotes: false,
  }
}

/** Evento interno do time → bloco do quadro. */
export function normalizeEvent(
  e: { id: string; title: string; starts_at: string; ends_at: string; resource_id: string | null; notes: string | null },
  resources: Map<string, ResourceRow>,
  fallbackResourceId: string,
): BoardAppt {
  const resId = e.resource_id ?? fallbackResourceId
  const res = resources.get(resId)
  return blocoInterno({
    id: e.id, kind: "event", href: null,
    resourceId: resId,
    resourceAgentId: res?.assigned_agent_id ?? null,
    resourceName: res?.name ?? null,
    startISO: e.starts_at, endISO: e.ends_at,
    label: e.title, sub: e.notes,
  })
}

/** Follow-up (promessa de voltar) → bloco do quadro, na agenda de quem prometeu.
 *  Duração fixa: a promessa não tem fim marcado — é um ponto no dia. */
const FOLLOWUP_MIN = 30
export function normalizeFollowUp(
  f: { id: string; at: string; title: string; subtitle: string | null; href: string; done?: boolean },
  resourceId: string,
  resources: Map<string, ResourceRow>,
): BoardAppt {
  const res = resources.get(resourceId)
  const fim = new Date(new Date(f.at).getTime() + FOLLOWUP_MIN * 60_000).toISOString()
  return {
    ...blocoInterno({
      id: f.id, kind: "followup", href: f.href,
      resourceId,
      resourceAgentId: res?.assigned_agent_id ?? null,
      resourceName: res?.name ?? null,
      startISO: f.at, endISO: fim,
      label: f.title, sub: f.subtitle,
    }),
    done: !!f.done,
  }
}

/** Rótulo curto do recurso (tipo/kind ou capacidade) pro cabeçalho de coluna. */
export function resourceSubLabel(res: ResourceRow): string {
  if (res.kind?.trim()) return res.kind
  if (res.capacity > 1) return `Capacidade ${res.capacity}`
  return "Agenda"
}

export function fmtBRL(v: number | null): string {
  if (v == null) return ""
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: v % 1 === 0 ? 0 : 2 })
}

// ── Bloqueios (folga/feriado/manutenção) ─────────────────────
export interface RawBlackout { id: string; resource_id: string | null; starts_at: string; ends_at: string; reason: string | null }
export interface BlackoutBlock { id: string; startMin: number; durMin: number; label: string; blocking: boolean }

/**
 * Recorta um bloqueio no dia `dateKey`, devolvendo o bloco (minuto-do-dia +
 * duração) ou null se não intercepta o dia. `prefix` (nome do recurso) só é usado
 * no modo "Todas (equipe)" da Semana. `blocking=false` = INFORMATIVO: aparece mas
 * não trava clique/gesto — bloqueio de COLEGA na Semana-equipe não pode impedir
 * marcação na agenda de outra pessoa (só o tenant-wide bloqueia todo mundo).
 */
export function blackoutBlockForDay(b: RawBlackout, dateKey: string, opts?: { prefix?: string; blocking?: boolean }): BlackoutBlock | null {
  const dayStart = new Date(isoFromDayMinute(dateKey, 0)).getTime()
  const dayEnd = dayStart + 1440 * 60_000
  const bStart = new Date(b.starts_at).getTime(), bEnd = new Date(b.ends_at).getTime()
  if (bStart >= dayEnd || bEnd <= dayStart) return null
  const startMin = bStart <= dayStart ? 0 : minutesInTz(new Date(bStart))
  const endMin = bEnd >= dayEnd ? 1440 : minutesInTz(new Date(bEnd))
  const durMin = endMin - startMin
  if (durMin <= 0) return null
  const reason = b.reason?.trim() || "Bloqueio"
  return { id: b.id, startMin, durMin, label: `${opts?.prefix ? opts.prefix + " · " : ""}🔒 ${reason}`, blocking: opts?.blocking ?? true }
}
