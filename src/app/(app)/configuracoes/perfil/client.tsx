"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Camera, Trash2, Loader2, Check, KeyRound, MonitorSmartphone, ShieldCheck,
  Shield, Monitor, Clock, Eye, EyeOff, Crown,
} from "lucide-react"
import type { MyProfile } from "@/lib/actions/profile"
import { uploadMyAvatar, removeMyAvatar, changeMyPassword } from "@/lib/actions/profile"
import { UserDevices } from "@/components/app/user-devices"

export interface ProfileSecurity {
  passwordChangedAt: string | null
  deviceCount:       number
  currentAgent:      string | null
  lastSeenAt:        string | null
}

function relTime(iso: string | null): string {
  if (!iso) return "—"
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1)  return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} ${d === 1 ? "dia" : "dias"}`
}

/** "Chrome no Windows" a partir do user-agent — sem biblioteca, só o que dá pra afirmar. */
function prettyAgent(ua: string | null): string {
  if (!ua) return "—"
  const browser = /Edg\//.test(ua) ? "Edge"
                : /OPR\//.test(ua) ? "Opera"
                : /Chrome\//.test(ua) ? "Chrome"
                : /Firefox\//.test(ua) ? "Firefox"
                : /Safari\//.test(ua) ? "Safari" : "Navegador"
  const os = /Windows/.test(ua) ? "Windows"
           : /iPhone|iPad/.test(ua) ? "iOS"
           : /Android/.test(ua) ? "Android"
           : /Mac OS/.test(ua) ? "macOS"
           : /Linux/.test(ua) ? "Linux" : null
  return os ? `${browser} no ${os}` : browser
}

export function ProfileClient({ profile, role, security }: {
  profile:  MyProfile
  role:     string
  security: ProfileSecurity
}) {
  const router = useRouter()

  return (
    // Página INTEIRA (pedido do dono): sem `max-w-2xl` — a tela dividia espaço com a
    // coluna de Configurações e ainda se espremia no meio, sobrando canvas dos dois lados.
    <div className="min-h-full bg-canvas px-4 sm:px-6 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Meu perfil</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Gerencie suas informações pessoais, senha e dispositivos conectados.
        </p>
      </div>

      <AvatarCard profile={profile} role={role} onChange={() => router.refresh()} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat icon={Shield}  tint="text-primary-600 bg-primary/10"
          title="Senha ativa"
          sub={security.passwordChangedAt ? `Atualizada ${relTime(security.passwordChangedAt)}` : "Nunca atualizada aqui"} />
        <Stat icon={Monitor} tint="text-emerald-600 bg-emerald-50"
          title={`${security.deviceCount} ${security.deviceCount === 1 ? "dispositivo" : "dispositivos"}`}
          sub="conectados" />
        <Stat icon={MonitorSmartphone} tint="text-violet-600 bg-violet-50"
          title="Sessão atual" sub={prettyAgent(security.currentAgent)} />
        <Stat icon={Clock}   tint="text-amber-600 bg-amber-50"
          title="Último acesso" sub={relTime(security.lastSeenAt)} />
      </div>

      <PasswordCard />

      {/* Dispositivos unificados (device trust F4): navegadores + extensão, agrupados por
          aparelho, com confiança de 30d e revogação em cascata. */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <MonitorSmartphone className="size-4 text-primary-600" />
          <h2 className="text-sm font-bold text-slate-900">Dispositivos e sessões</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Aparelhos que já acessaram sua conta — navegador e extensão juntos. Desconectar
          revoga a confiança: o próximo login naquele aparelho pede código por e-mail.
        </p>
        <UserDevices />
        <p className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="size-3.5 shrink-0" />
          Não reconheceu algum dispositivo? Troque sua senha — isso desconecta todas as outras sessões.
        </p>
      </section>
    </div>
  )
}

function Stat({ icon: Icon, tint, title, sub }: {
  icon: typeof Shield; tint: string; title: string; sub: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-slate-900 truncate">{title}</p>
        <p className="text-[11px] text-slate-400 truncate">{sub}</p>
      </div>
    </div>
  )
}

// ── Foto ────────────────────────────────────────────────────────
function AvatarCard({ profile, role, onChange }: {
  profile: MyProfile; role: string; onChange: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [hasAvatar, setHasAvatar] = useState(profile.hasAvatar)
  const [version, setVersion] = useState(0)
  const [imgError, setImgError] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = profile.name?.[0]?.toUpperCase() ?? "U"
  const showImg = hasAvatar && !imgError

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const fd = new FormData()
    fd.set("file", file)
    startTransition(async () => {
      const res = await uploadMyAvatar(fd)
      if (res.error) { setError(res.error); return }
      setHasAvatar(true); setImgError(false); setVersion((v) => v + 1)
      onChange()
    })
    e.target.value = ""
  }

  function remove() {
    setError(null)
    startTransition(async () => {
      await removeMyAvatar()
      setHasAvatar(false)
      onChange()
    })
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="relative shrink-0">
          {showImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/me/avatar?v=${version}`}
              alt="Foto de perfil"
              onError={() => setImgError(true)}
              className="size-20 rounded-full object-cover ring-2 ring-white shadow"
            />
          ) : (
            <div className="size-20 rounded-full bg-gradient-to-br from-white to-slate-200 flex items-center justify-center ring-1 ring-inset ring-slate-200/70">
              <span className="text-2xl font-bold text-slate-400">{initial}</span>
            </div>
          )}
          {pending && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <Loader2 className="size-5 text-white animate-spin" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-slate-900 truncate">{profile.name || "—"}</p>
          <p className="text-[13px] text-slate-400 truncate">{profile.email}</p>
          <span className="mt-2 inline-flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] font-semibold bg-primary/10 text-primary-700">
            <Crown className="size-3" /> {role}
          </span>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50 transition-colors">
              <Camera className="size-3.5" /> {hasAvatar ? "Trocar foto" : "Enviar foto"}
            </button>
            {hasAvatar && (
              <button type="button" disabled={pending} onClick={remove}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                <Trash2 className="size-3.5" /> Remover foto
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">JPG, PNG ou WebP, até 5MB.</p>
        </div>

        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp"
          className="hidden" onChange={onFile} />
      </div>
    </section>
  )
}

// ── Senha ───────────────────────────────────────────────────────
/** As MESMAS regras que o servidor aplica. Se divergirem, a tela aprova e o envio recusa. */
const RULES = [
  { id: "len",  label: "Mínimo de 8 caracteres",              ok: (v: string) => v.length >= 8 },
  { id: "mix",  label: "Inclua pelo menos uma letra e um número", ok: (v: string) => /[a-zA-Z]/.test(v) && /\d/.test(v) },
  { id: "weak", label: "Não use informações fáceis de adivinhar",
    ok: (v: string) => v.length > 0 && !/^(1234|senha|password|qwerty|admin|kora)/i.test(v) },
]

function PasswordCard() {
  const [pending, startTransition] = useTransition()
  const [cur, setCur] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const passed = RULES.filter((r) => r.ok(next)).length
  const strength = next.length === 0 ? 0 : Math.min(3, passed)
  const strengthLabel = ["", "Fraca", "Média", "Forte"][strength]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setDone(false)
    if (next !== confirm) { setError("A nova senha e a confirmação não conferem."); return }
    startTransition(async () => {
      const res = await changeMyPassword(cur, next)
      if (res.error) { setError(res.error); return }
      setCur(""); setNext(""); setConfirm(""); setDone(true)
    })
  }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary-600" />
        <h2 className="text-sm font-bold text-slate-900">Senha</h2>
      </div>
      <p className="text-xs text-slate-500 mt-0.5 mb-4">Mantenha sua conta segura usando uma senha forte e única.</p>

      <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3 items-start">
        <div className="space-y-3">
          <Input label="Senha atual" value={cur} onChange={setCur} autoComplete="current-password" />
          <div>
            <Input label="Nova senha" value={next} onChange={setNext} autoComplete="new-password" />
            {next.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className={`text-[11px] font-semibold shrink-0 ${
                  strength === 3 ? "text-emerald-600" : strength === 2 ? "text-amber-600" : "text-red-600"}`}>
                  Força: {strengthLabel}
                </span>
                <span className="flex-1 flex gap-1">
                  {[1, 2, 3].map((i) => (
                    <span key={i} className={`h-1 flex-1 rounded-full ${
                      i <= strength
                        ? strength === 3 ? "bg-emerald-500" : strength === 2 ? "bg-amber-500" : "bg-red-500"
                        : "bg-slate-200"}`} />
                  ))}
                </span>
              </div>
            )}
          </div>
          <Input label="Confirmar nova senha" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </div>

        {/* Checklist AO VIVO: marca conforme digita, em vez de só reprovar no envio. */}
        <ul className="space-y-2 lg:pt-6">
          {RULES.map((r) => {
            const ok = next.length > 0 && r.ok(next)
            return (
              <li key={r.id} className="flex items-center gap-2 text-[13px]">
                <Check className={`size-4 shrink-0 rounded-full p-0.5 ${
                  ok ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-300"}`} />
                <span className={ok ? "text-slate-700" : "text-slate-400"}>{r.label}</span>
              </li>
            )
          })}
        </ul>

        <div className="lg:col-span-2 space-y-3">
          {error && <p className="text-xs text-red-600">{error}</p>}
          {done && (
            <p className="text-xs text-green-700 inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Senha atualizada. Os outros dispositivos foram desconectados.
            </p>
          )}
          <button type="submit" disabled={pending || !cur || !next || !confirm}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Atualizar senha
          </button>
        </div>
      </form>
    </section>
  )
}

// ── Helpers ─────────────────────────────────────────────────────
/** Campo de senha com olho pra revelar — some no blur nunca: quem revelou, revelou. */
function Input({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 pl-3 pr-10 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200"
        />
        <button type="button" onClick={() => setShow((s) => !s)} tabIndex={-1}
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-2 top-1/2 -translate-y-1/2 size-7 grid place-items-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  )
}
