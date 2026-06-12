"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Bell, CalendarCheck, CalendarX, CalendarClock, UserCheck, Sun, Check } from "lucide-react"
import { getRealtimeClient } from "@/lib/realtime"
import {
  getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  type NotificationItem,
} from "@/lib/actions/notifications"

// ═══════════════════════════════════════════════════════════════
// Sininho — "plano do atendente" (docs/agenda-design.md §6.2)
// ═══════════════════════════════════════════════════════════════
// Feed in-app via Realtime (canal por destinatário). Badge = não-lidas
// (mesma linguagem da bolinha do inbox: abrir/clicar zera). Genérico:
// hoje só agenda produz, mas qualquer `type` futuro aparece aqui.

const ICONS: Record<string, React.ReactNode> = {
  appt_created:     <CalendarClock className="size-4 text-primary-600" />,
  appt_reminder:    <CalendarClock className="size-4 text-primary-600" />,
  appt_confirmed:   <CalendarCheck className="size-4 text-emerald-600" />,
  appt_canceled:    <CalendarX className="size-4 text-red-600" />,
  appt_rescheduled: <CalendarClock className="size-4 text-amber-600" />,
  appt_reschedule_help: <CalendarClock className="size-4 text-amber-600" />,
  appt_no_show:     <CalendarX className="size-4 text-amber-600" />,
  daily_briefing:   <Sun className="size-4 text-amber-500" />,
  transfer_received: <UserCheck className="size-4 text-primary-600" />,
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
  if (p.conversation_id) return `/inbox?c=${p.conversation_id}`
  if (p.appointment_id) return "/agenda"
  return "/agenda"
}

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
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-900">Notificações</span>
            {unread > 0 && (
              <button onClick={onMarkAll} className="text-xs text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1">
                <Check className="size-3.5" /> Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {loaded ? "Nada por aqui ainda 🎉" : "Carregando…"}
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  className={`w-full text-left flex gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${n.read_at ? "" : "bg-primary-50/40"}`}
                >
                  <span className="mt-0.5 shrink-0">{ICONS[n.type] ?? <Bell className="size-4 text-slate-400" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{n.title}</span>
                      {!n.read_at && <span className="size-1.5 rounded-full bg-primary-600 shrink-0" />}
                    </span>
                    {n.body && <span className="block text-xs text-slate-500 truncate mt-0.5">{n.body}</span>}
                    <span className="block text-[11px] text-slate-400 mt-0.5">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
