/**
 * Divisor visual entre fases de origem da conversa (site → WhatsApp etc).
 * Renderiza linha horizontal centrada com ícone lucide + label + timestamp.
 *
 * Usado em conjunto com `buildTimelineGroups()` (abaixo): agrupa as mensagens
 * por dia e insere "items" virtuais de divisor onde a origem muda.
 */
import { MonitorSmartphone, MessageCircle, type LucideIcon } from "lucide-react"
import type { ChatMessage } from "@/types/chat"

interface DividerItem {
  kind:  "divider"
  id:    string
  icon:  LucideIcon
  label: string
  time:  string | null
}
interface MessageItem {
  kind: "message"
  id:   string
  msg:  ChatMessage
}
export type TimelineItem = DividerItem | MessageItem

/**
 * Grupo de mensagens do mesmo dia. Cada grupo vira um `<section>` no DOM
 * pra que o `DateDivider` sticky pertencente a esse grupo "saia" junto
 * com as mensagens quando o usuário rola — caso contrário, múltiplos
 * sticky com mesmo container pai se empilham em vez de se substituir.
 */
export interface TimelineGroup {
  id:        string        // dateKey (YYYY-MM-DD)
  dateLabel: string
  items:     TimelineItem[]
}

export function TimelineDivider({ icon: Icon, label, time }: Omit<DividerItem, "kind" | "id">) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 select-none">
      <div className="flex-1 h-px bg-slate-200" />
      <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
        <Icon className="size-3.5 text-slate-400" strokeWidth={2.25} />
        <span>{label}</span>
        {time && <span className="text-slate-400 normal-case font-normal">· {time}</span>}
      </div>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  )
}

/**
 * Pílula sticky no topo do scroll com a data atual do grupo de mensagens
 * (estilo WhatsApp). Múltiplas instâncias consecutivas se "trocam" naturalmente
 * por causa do `position: sticky` — quando o usuário rola pra cima, "Hoje"
 * sai e "Ontem" assume a posição.
 */
export function DateDivider({ label }: { label: string }) {
  return (
    <div className="sticky top-1 z-10 flex justify-center pointer-events-none my-2 px-4">
      <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200 shadow-sm pointer-events-auto">
        {label}
      </span>
    </div>
  )
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth() &&
    a.getDate()     === b.getDate()
  )
}

function formatDateLabel(iso: string): string {
  const date  = new Date(iso)
  if (isNaN(date.getTime())) return ""

  const today = new Date()
  const yest  = new Date()
  yest.setDate(today.getDate() - 1)

  if (isSameDay(date, today)) return "Hoje"
  if (isSameDay(date, yest))  return "Ontem"

  // Pega zero-hour pra contar dias inteiros (não horas)
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dateMidnight  = new Date(date.getFullYear(),  date.getMonth(),  date.getDate())
  const diffDays = Math.floor((todayMidnight.getTime() - dateMidnight.getTime()) / 86_400_000)

  if (diffDays > 0 && diffDays < 7) {
    // dia da semana ("segunda-feira", "terça-feira", ...) capitalizado
    const wd = date.toLocaleDateString("pt-BR", { weekday: "long" })
    return wd.charAt(0).toUpperCase() + wd.slice(1)
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  } catch {
    return null
  }
}

/**
 * Agrupa as mensagens por DIA (cada grupo vira um `<section>` com seu próprio
 * `DateDivider` sticky) e insere divisores de origem dentro dos items:
 *  - antes da 1ª `site_lead_meta` → "Lead chegou pelo site"
 *  - antes da 1ª msg do contato que NÃO é `site_lead_answers` → "Continuou pelo WhatsApp"
 */
export function buildTimelineGroups(messages: ChatMessage[]): TimelineGroup[] {
  const groups: TimelineGroup[] = []
  let injectedSiteDivider     = false
  let injectedWhatsappDivider = false

  // Pré-checa: a conversa tem alguma msg de origem "site"?
  const hasSiteOrigin = messages.some((m) => {
    const kind = (m.metadata as Record<string, unknown> | null | undefined)?.kind
    return kind === "site_lead_meta" || kind === "site_lead_answers"
  })

  for (const m of messages) {
    const meta = (m.metadata as Record<string, unknown> | null | undefined) ?? {}
    const kind = meta.kind as string | undefined

    // Abre novo grupo de dia quando a data muda
    const dateKey = m.created_at?.slice(0, 10) ?? "?"
    let group = groups[groups.length - 1]
    if (!group || group.id !== dateKey) {
      group = { id: dateKey, dateLabel: formatDateLabel(m.created_at) || dateKey, items: [] }
      groups.push(group)
    }

    // 1º marker site: antes da meta do site (só se essa conv veio do site)
    if (hasSiteOrigin && !injectedSiteDivider && kind === "site_lead_meta") {
      group.items.push({
        kind:  "divider",
        id:    `divider-site-${m.id}`,
        icon:  MonitorSmartphone,
        label: "Lead chegou pelo site",
        time:  fmtTime(m.created_at),
      })
      injectedSiteDivider = true
    }

    // 2º marker: antes da 1ª msg do CONTATO que NÃO é resposta de form
    // (= primeira msg WhatsApp real do lead, depois do form)
    if (
      hasSiteOrigin &&
      injectedSiteDivider &&
      !injectedWhatsappDivider &&
      m.sender_type === "contact" &&
      kind !== "site_lead_answers"
    ) {
      group.items.push({
        kind:  "divider",
        id:    `divider-wa-${m.id}`,
        icon:  MessageCircle,
        label: "Continuou pelo WhatsApp",
        time:  fmtTime(m.created_at),
      })
      injectedWhatsappDivider = true
    }

    group.items.push({ kind: "message", id: m.id, msg: m })
  }

  return groups
}
