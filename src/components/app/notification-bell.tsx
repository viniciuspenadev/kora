"use client"

import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Bell, CalendarCheck, CalendarX, CalendarClock, UserCheck, Sun, Check, X, Loader2, Gauge, type LucideIcon } from "lucide-react"
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
  ig_quota_warning:     Gauge,
  ig_quota_exhausted:   Gauge,
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
  // Destino explícito do produtor (ex: cota → /configuracoes/uso). Só caminho interno:
  // o payload vem do banco, então URL absoluta seria um open-redirect de graça.
  if (typeof p.url === "string" && p.url.startsWith("/") && !p.url.startsWith("//")) return p.url
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
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notificações${unread ? ` · ${unread} não lidas` : ""}`}
        className={`relative inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl border px-2 transition-colors ${
          open
            ? "border-primary-200 bg-primary-50 text-primary-700"
            : "border-transparent text-nav-dim hover:border-nav-line hover:bg-nav-hover hover:text-nav-strong"
        }`}
      >
        <Bell className="size-[18px]" strokeWidth={1.8} />
        {unread > 0 && (
          <>
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500 ring-2 ring-nav sm:hidden" />
            <span className="hidden h-5 min-w-5 items-center justify-center rounded-md bg-red-50 px-1.5 text-[10px] font-bold text-red-700 tabular-nums sm:inline-flex">
              {badge}
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Central de notificações"
          className="fixed inset-x-3 top-[4.25rem] z-50 w-auto overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_-18px_rgba(15,23,42,0.35)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[400px]"
        >
          <div className="flex min-h-14 items-center gap-3 border-b border-slate-100 px-4">
            <span className="size-8 rounded-lg border border-slate-100 bg-slate-50 text-slate-600 grid place-items-center shrink-0">
              <Bell className="size-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Notificações</p>
              <p className="text-[10px] text-slate-400">{unread > 0 ? `${unread} ${unread === 1 ? "não lida" : "não lidas"}` : "Tudo acompanhado"}</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              {unread > 0 && (
                <button onClick={onMarkAll} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900">
                  <Check className="size-3.5" /> <span className="hidden min-[360px]:inline">Marcar como lidas</span>
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar notificações"
                className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 sm:hidden">
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto overscroll-contain sm:max-h-[480px]">
            {items.length === 0 ? (
              <div className="px-5 py-14 flex flex-col items-center text-center">
                <span className="size-10 rounded-xl border border-slate-100 bg-slate-50 grid place-items-center mb-3">
                  {loaded ? <Check className="size-4 text-emerald-600" /> : <Loader2 className="size-4 animate-spin text-slate-400" />}
                </span>
                <p className="text-sm font-semibold text-slate-700">{loaded ? "Tudo em dia" : "Carregando notificações"}</p>
                <p className="text-xs text-slate-400 mt-1">{loaded ? "Novos avisos de agenda e atendimento aparecerão aqui." : "Só um instante…"}</p>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key}>
                  <p className="px-4 pt-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
                  {g.rows.map((n) => {
                    const Icon = ICONS[n.type] ?? Bell
                    const isUnread = !n.read_at
                    return (
                      <button
                        key={n.id}
                        onClick={() => onItemClick(n)}
                        className={`group w-full border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 ${
                          isUnread ? "bg-primary-50/35 hover:bg-primary-50/70" : "hover:bg-slate-50/80"
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <span className={`mt-0.5 size-8 rounded-lg border grid place-items-center shrink-0 ${
                            isUnread ? "border-primary-100 bg-white text-primary-600" : "border-slate-100 bg-slate-50 text-slate-400"
                          }`}>
                            <Icon className="size-3.5" strokeWidth={2} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className={`min-w-0 flex-1 truncate text-sm ${isUnread ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>
                                {n.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{timeAgo(n.created_at)}</span>
                            </span>
                            {n.body && <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-slate-400">{n.body}</span>}
                          </span>
                          {isUnread && <span className="mt-2 size-1.5 rounded-full bg-primary shrink-0" />}
                        </span>
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
