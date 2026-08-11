"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import {
  Loader2, LogOut, Monitor, Puzzle, ShieldCheck, ShieldOff, Smartphone,
} from "lucide-react"
import {
  listUserDevices, revokeUserDevice, revokeOtherDevices,
  revokeExtensionDevice, type UserDevicesResult, type UserDevice, type DeviceSession,
} from "@/lib/actions/devices"
import { revokeMySession } from "@/lib/actions/profile"
import { DangerConfirm } from "@/components/ui/danger-confirm"

// ═══════════════════════════════════════════════════════════════
// Dispositivos unificados (device trust F4)
// ═══════════════════════════════════════════════════════════════
// UM card por dispositivo físico: navegador ou extensão, com as sessões dentro,
// o selo de confiança (30d) e revogação em CASCATA (confiança + sessões +
// tokens). Substitui as duas listas antigas (sessões soltas + extensão).
// Usado no Perfil próprio e na ficha do membro (admin).

export function UserDevices({ userId }: { userId?: string }) {
  const [data, setData] = useState<UserDevicesResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDevice, setConfirmDevice] = useState<UserDevice | null>(null)
  const [confirmOthers, setConfirmOthers] = useState(false)
  const [pending, startTransition] = useTransition()
  const self = !userId

  const load = useCallback(() => {
    listUserDevices(userId)
      .then(setData)
      .catch((e) => setError((e as Error).message))
  }, [userId])

  useEffect(() => { load() }, [load])

  function revokeDevice(d: UserDevice) {
    startTransition(async () => {
      const r = await revokeUserDevice(d.id, userId)
      if (r?.error) { setError(r.error); return }
      setConfirmDevice(null)
      load()
    })
  }

  function revokeOthers() {
    startTransition(async () => {
      const r = await revokeOtherDevices()
      if (r?.error) { setError(r.error); return }
      setConfirmOthers(false)
      load()
    })
  }

  function revokeLegacySession(id: string) {
    startTransition(async () => {
      await revokeMySession(id)
      load()
    })
  }

  function revokeLegacyToken(id: string) {
    startTransition(async () => {
      await revokeExtensionDevice(id)
      load()
    })
  }

  if (error) {
    return <p className="text-sm text-red-700 bg-danger-bg border border-red-100 rounded-xl px-4 py-3">{error}</p>
  }
  if (data === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 px-1 py-2">
        <Loader2 className="size-4 animate-spin" /> Carregando dispositivos…
      </div>
    )
  }

  const empty = data.devices.length === 0 && data.legacySessions.length === 0 && data.legacyExtTokens.length === 0

  return (
    <div className="space-y-3">
      {self && data.devices.length > 1 && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmOthers(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-danger-bg hover:text-danger hover:border-red-200 transition-colors disabled:opacity-50"
          >
            <LogOut className="size-3.5" /> Sair de todos os outros
          </button>
        </div>
      )}

      {empty && (
        <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          Nenhum dispositivo registrado ainda. Eles aparecem aqui a partir do próximo login.
        </p>
      )}

      {data.devices.map((d) => (
        <DeviceCard
          key={d.id}
          device={d}
          self={self}
          pending={pending}
          onRevoke={() => setConfirmDevice(d)}
        />
      ))}

      {(data.legacySessions.length > 0 || data.legacyExtTokens.length > 0) && (
        <div className="pt-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Acessos antigos (antes da identificação de dispositivo)
          </p>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {data.legacySessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <Monitor className="size-4 text-slate-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-600 truncate">
                    Sessão {s.current ? "(esta)" : ""} · {s.ip ?? "IP desconhecido"}
                  </p>
                  <p className="text-[11px] text-slate-400">{timeAgo(s.lastSeenAt)}</p>
                </div>
                {self && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => revokeLegacySession(s.id)}
                    className="shrink-0 text-[11px] font-semibold text-red-600 hover:bg-red-50 px-2 py-1 rounded-md disabled:opacity-50"
                  >
                    Sair
                  </button>
                )}
              </div>
            ))}
            {data.legacyExtTokens.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <Puzzle className="size-4 text-slate-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-600 truncate">Extensão · {t.label}</p>
                  <p className="text-[11px] text-slate-400">
                    {t.lastUsedAt ? `último uso ${timeAgo(t.lastUsedAt)}` : "nunca usada"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => revokeLegacyToken(t.id)}
                  className="shrink-0 text-[11px] font-semibold text-red-600 hover:bg-red-50 px-2 py-1 rounded-md disabled:opacity-50"
                >
                  Revogar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <DangerConfirm
        open={!!confirmDevice}
        title={confirmDevice?.current ? "Desconectar ESTE dispositivo?" : "Desconectar dispositivo?"}
        body={
          <>
            <b>{confirmDevice?.label}</b> perde a confiança, as sessões e o acesso da
            extensão de uma vez. O próximo login nele vai pedir código por e-mail.
            {confirmDevice?.current && <> <b>Você está usando este dispositivo agora</b> — sua sessão cai em instantes.</>}
          </>
        }
        confirmLabel="Desconectar"
        onConfirm={() => { if (confirmDevice) revokeDevice(confirmDevice) }}
        onClose={() => setConfirmDevice(null)}
      />

      <DangerConfirm
        open={confirmOthers}
        title="Sair de todos os outros dispositivos?"
        body={<>Derruba as sessões, revoga a confiança dos outros aparelhos e desconecta a extensão em todos. Só este dispositivo continua logado. Use se algo pareceu estranho.</>}
        confirmLabel="Sair de todos"
        onConfirm={revokeOthers}
        onClose={() => setConfirmOthers(false)}
      />
    </div>
  )
}

// ── Card de um dispositivo ──────────────────────────────────────
function DeviceCard({
  device: d, self, pending, onRevoke,
}: {
  device: UserDevice
  self: boolean
  pending: boolean
  onRevoke: () => void
}) {
  const Icon = d.kind === "extension" ? Puzzle : /iphone|android/i.test(d.label) ? Smartphone : Monitor
  const online = d.sessions.some((s) => s.active)

  return (
    <div className={`rounded-xl border bg-white ${d.current ? "border-primary-200 ring-1 ring-primary-200/50" : "border-slate-200"}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`size-10 shrink-0 rounded-lg flex items-center justify-center ${d.current ? "bg-primary-50 text-primary-600" : "bg-slate-100 text-slate-400"}`}>
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-2">
            {d.kind === "extension" ? `Extensão · ${d.label}` : d.label}
            {d.current && (
              <span className="text-[10px] font-semibold text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded-full shrink-0">
                Este dispositivo
              </span>
            )}
            {online && !d.current && <span className="size-1.5 rounded-full bg-green-500 shrink-0" title="Ativo agora" />}
          </p>
          <p className="text-[11px] text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
            {d.trustedUntil ? (
              <>
                <ShieldCheck className="size-3 text-emerald-500 shrink-0" />
                Confiável até {shortDate(d.trustedUntil)}
              </>
            ) : (
              <>
                <ShieldOff className="size-3 text-slate-300 shrink-0" />
                Sem confiança — o próximo login pede código
              </>
            )}
            {d.lastSeenAt && <> · visto {timeAgo(d.lastSeenAt)}</>}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onRevoke}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 px-2 py-1 rounded-md disabled:opacity-50"
        >
          <LogOut className="size-3" /> Desconectar
        </button>
      </div>

      {(d.sessions.length > 0 || d.extTokens.length > 0) && (
        <div className="border-t border-slate-100 px-4 py-2 space-y-1">
          {d.sessions.map((s) => <SessionRow key={s.id} s={s} />)}
          {d.extTokens.map((t) => (
            <p key={t.id} className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Puzzle className="size-3 shrink-0" />
              Acesso da extensão · {t.lastUsedAt ? `último uso ${timeAgo(t.lastUsedAt)}` : "nunca usado"}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({ s }: { s: DeviceSession }) {
  return (
    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full shrink-0 ${s.active ? "bg-green-500" : "bg-slate-300"}`} />
      Sessão{s.current ? " atual" : ""} · {s.ip ?? "IP desconhecido"} · {timeAgo(s.lastSeenAt)}
    </p>
  )
}

// ── Helpers ─────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}
