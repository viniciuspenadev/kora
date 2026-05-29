"use client"

import { useState, useTransition } from "react"
import { Loader2, AlertCircle, Copy, Check, Trash2 } from "lucide-react"
import { createInvite, deleteInvite } from "@/lib/actions/admin"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"

const inputCls =
  "w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

export function InviteForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    const fd = new FormData(e.currentTarget)
    const formEl = e.currentTarget

    startTransition(async () => {
      const result = await createInvite(fd)
      if (result?.error) {
        setError(result.error)
        return
      }
      formEl.reset()
    })
  }

  return (
    <SectionCard title="Novo convite" description="Gera link único pro destinatário entrar no tenant escolhido.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-4">
            <FormRow label="Tenant" required>
              <select
                name="tenant_id"
                required
                disabled={tenants.length === 0}
                className={`${inputCls} disabled:opacity-50`}
              >
                <option value="">{tenants.length === 0 ? "Nenhum tenant" : "Selecione"}</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </FormRow>
          </div>
          <div className="sm:col-span-5">
            <FormRow label="E-mail" required>
              <input name="email" type="email" required className={inputCls} />
            </FormRow>
          </div>
          <div className="sm:col-span-3">
            <FormRow label="Papel" required>
              <select name="role" defaultValue="agent" className={inputCls}>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="agent">Atendente</option>
              </select>
            </FormRow>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-lg bg-danger-bg border border-red-200 px-3 py-2">
            <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
            <p className="text-xs text-red-800">{error}</p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || tenants.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Gerar convite
          </button>
        </div>
      </form>
    </SectionCard>
  )
}

export function CopyInviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const url = `${window.location.origin}/invite/${token}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg transition-colors ${
        copied
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-white border border-slate-200 hover:bg-slate-50 text-slate-700"
      }`}
    >
      {copied
        ? <><Check className="size-3.5" /> Copiado</>
        : <><Copy  className="size-3.5" /> Copiar link</>}
    </button>
  )
}

export function DeleteInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm("Apagar este convite?")) return
    startTransition(async () => {
      await deleteInvite(inviteId)
    })
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      aria-label="Apagar convite"
      className="size-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors flex items-center justify-center disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  )
}
