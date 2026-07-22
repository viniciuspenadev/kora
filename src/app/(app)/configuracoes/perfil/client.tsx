"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Camera, Trash2, Loader2, Check, KeyRound, MonitorSmartphone, ShieldCheck,
} from "lucide-react"
import type { MyProfile } from "@/lib/actions/profile"
import {
  uploadMyAvatar, removeMyAvatar, changeMyPassword,
} from "@/lib/actions/profile"
import { UserDevices } from "@/components/app/user-devices"

interface Props {
  profile: MyProfile
}

export function ProfileClient({ profile }: Props) {
  const router = useRouter()

  return (
    <div className="min-h-full bg-canvas">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Meu perfil</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sua foto, senha e os dispositivos conectados à sua conta.</p>
        </div>

        <AvatarCard profile={profile} onChange={() => router.refresh()} />
        <PasswordCard />

        {/* Dispositivos unificados (device trust F4): navegadores + extensão,
            agrupados por aparelho, com confiança de 30d e revogação em cascata. */}
        <section className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <MonitorSmartphone className="size-4 text-slate-400" />
            <h2 className="text-sm font-bold text-slate-900">Dispositivos</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Aparelhos que já acessaram sua conta — navegador e extensão juntos. Desconectar
            revoga a confiança: o próximo login naquele aparelho pede código por e-mail.
          </p>
          <UserDevices />
        </section>
      </div>
    </div>
  )
}

// ── Foto ────────────────────────────────────────────────────────
function AvatarCard({ profile, onChange }: { profile: MyProfile; onChange: () => void }) {
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
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          {showImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/me/avatar?v=${version}`}
              alt="Foto de perfil"
              onError={() => setImgError(true)}
              className="size-16 rounded-full object-cover ring-2 ring-white shadow"
            />
          ) : (
            <div className="size-16 rounded-full bg-gradient-to-br from-white to-slate-200 flex items-center justify-center ring-1 ring-inset ring-slate-200/70">
              <span className="text-xl font-bold text-slate-400">{initial}</span>
            </div>
          )}
          {pending && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <Loader2 className="size-5 text-white animate-spin" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate">{profile.name || "—"}</p>
          <p className="text-xs text-slate-400 truncate">{profile.email}</p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Camera className="size-3.5" /> {hasAvatar ? "Trocar foto" : "Enviar foto"}
            </button>
            {hasAvatar && (
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> Remover
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onFile}
        />
      </div>
      <p className="text-[11px] text-slate-400 mt-3">JPG, PNG ou WebP, até 5MB.</p>
    </section>
  )
}

// ── Senha ───────────────────────────────────────────────────────
function PasswordCard() {
  const [pending, startTransition] = useTransition()
  const [cur, setCur] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

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
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="size-4 text-slate-400" />
        <h2 className="text-sm font-bold text-slate-900">Senha</h2>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Senha atual" type="password" value={cur} onChange={setCur} autoComplete="current-password" />
        <Input label="Nova senha" type="password" value={next} onChange={setNext} autoComplete="new-password" hint="Mínimo 8 caracteres, com pelo menos uma letra e um número." />
        <Input label="Confirmar nova senha" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />

        {error && <p className="text-xs text-red-600">{error}</p>}
        {done && (
          <p className="text-xs text-green-700 inline-flex items-center gap-1.5">
            <Check className="size-3.5" /> Senha atualizada. Os outros dispositivos foram desconectados.
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !cur || !next || !confirm}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
          Atualizar senha
        </button>
      </form>
    </section>
  )
}

// ── Helpers ─────────────────────────────────────────────────────
function Input({
  label, type = "text", value, onChange, autoComplete, hint,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  hint?: string
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-3 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

