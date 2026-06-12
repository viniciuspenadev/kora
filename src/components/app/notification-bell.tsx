"use client"

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Bell, CalendarCheck, CalendarX, CalendarClock, UserCheck, Sun, Check, type LucideIcon } from "lucide-react"
import { getRealtimeClient } from "@/lib/realtime"
import {
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  type NotificationItem,
} from "@/lib/actions/notifications"

// ═══════════════════════════════════════════════════════════════
// Sininho — "plano do atendente" (docs/agenda-design.md §6.2)
// ═══════════════════════════════════════════════════════════════
// Feed in-app via Realtime (canal por destinatário). Visual editorial/monocromático
// (design-system): o TIPO é comunicado pelo ícone, não pela cor; "não-lida" vira
// CONTRASTE (chip escuro) em vez de tinta. Genérico — qualquer `type` futuro cai aqui.

const TZ = "America/Sao_Paulo"

// Só a forma do ícone diferencia o tipo — a cor é monocromática (aplicada no chip).
const ICONS: Record<string, LucideIcon> = {
  appt_created:         CalendarClock,
  appt_reminder:        CalendarClock,
  appt_confirmed:       CalendarCheck,
  appt_canceled:        CalendarX,
  appt_rescheduled:     CalendarClock,
  appt_reschedule_help: CalendarClock,
  appt_no_show:         CalendarX,
  daily_briefing:       Sun,
  transfer_received:    UserCheck,
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "agora"
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function hrefFor(n: NotificationItem): string {
  const p = n.payload ?? {}
  if (p.conversation_id) return `/inbox?conversation=${p.conversation_id}`
  if (p.appointment_id) return "/agenda"
  return "/agenda"
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })

export function NotificationBell({
  userId, supabaseToken,
}: { userId: string; supabaseToken: string }) {
  const router = useRouter()
  const [open, setOpen]     = useState(false)
  const [items, setItems]   = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(() => { getUnreadCount().then(setUnread).catch(() => {}) }, [])

  // Contagem inicial + Realtime (insert/update das MINHAS notificações).
  useEffect(() => {
    refreshCount()
    if (!supabaseToken || !userId) return
    const client = getRealtimeClient(supabaseToken)
    let active = true
    const channel = client
      .channel(`notif:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          if (!active) return
          const row = (payload.new ?? payload.old) as NotificationItem | undefined
          if (!row?.id) return
          if (payload.eventType === "INSERT") {
            setItems((prev) => [row, ...prev.filter((i) => i.id !== row.id)].slice(0, 30))
            if (!row.read_at) setUnread((u) => u + 1)
          } else {
            // UPDATE (ex: lida em outro device) → reconcilia contador.
            setItems((prev) => prev.map((i) => (i.id === row.id ? row : i)))
            refreshCount()
          }
        },
      )
      .subscribe()
    return () => { active = false; channel.unsubscribe() }
  }, [supabaseToken, userId, refreshCount])

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !loaded) {
      const data = await getNotifications(30)
      setItems(data)
      setLoaded(true)
    }
  }

  async function onItemClick(n: NotificationItem) {
    setOpen(false)
    if (!n.read_at) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)))
      setUnread((u) => Math.max(0, u - 1))
      markNotificationRead(n.id).catch(() => {})
    }
    router.push(hrefFor(n))
  }

  async function onMarkAll() {
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })))
    setUnread(0)
    await markAllNotificationsRead().catch(() => {})
  }

  // Agrupa em Hoje / Anteriores (estrutura sem poluir com cor).
  const groups = useMemo(() => {
    const today = dayKey(new Date().toISOString())
    const hoje: NotificationItem[] = []
    const antes: NotificationItem[] = []
    for (const n of items) (dayKey(n.created_at) === today ? hoje : antes).push(n)
    return [
      { key: "hoje", label: "Hoje", rows: hoje },
      { key: "antes", label: "Anteriores", rows: antes },
    ].filter((g) => g.rows.length > 0)
  }, [items])

  const badge = unread > 99 ? "99+" : String(unread)

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notificações${unread ? ` · ${unread} não lidas` : ""}`}
        className="relative size-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
      >
        <Bell className="size-5" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[9px] font-semibold flex items-center justify-center ring-2 ring-white tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[380px] max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 h-12 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-900">Notificações</span>
            {unread > 0 && (
              <button onClick={onMarkAll} className="text-xs text-slate-400 hover:text-slate-900 font-medium inline-flex items-center gap-1 transition-colors">
                <Check className="size-3.5" /> Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-[440px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-12 flex flex-col items-center text-center">
                <span className="size-10 rounded-full bg-slate-100 grid place-items-center mb-3">
                  <Bell className="size-5 text-slate-300" strokeWidth={1.75} />
                </span>
                <p className="text-sm font-medium text-slate-500">{loaded ? "Tudo em dia" : "Carregando…"}</p>
                {loaded && <p className="text-xs text-slate-400 mt-0.5">Avisos de agenda e atendimento aparecem aqui.</p>}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
                  {g.rows.map((n) => {
                    const Icon = ICONS[n.type] ?? Bell
                    const isUnread = !n.read_at
                    return (
                      <button
                        key={n.id}
                        onClick={() => onItemClick(n)}
                        className={`w-full text-left px-4 py-2.5 border-b border-slate-100 last:border-b-0 transition-colors ${
                          isUnread ? "bg-primary-50/50 hover:bg-primary-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className={`size-4 shrink-0 ${isUnread ? "text-primary-600" : "text-slate-300"}`} strokeWidth={2.25} />
                          <span className={`text-sm truncate ${isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-500"}`}>
                            {n.title}
                          </span>
                          {isUnread && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
                          <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums">{timeAgo(n.created_at)}</span>
                        </span>
                        {n.body && <span className="block text-xs text-slate-400 truncate mt-0.5 pl-6">{n.body}</span>}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
