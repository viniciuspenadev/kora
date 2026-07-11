"use client"

import { useState, useTransition } from "react"
import { Loader2, AlertCircle, Building2, UserPlus } from "lucide-react"
import { createTenant } from "@/lib/actions/admin"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"

const inputCls =
  "w-full h-9 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

const inputReadOnlyCls =
  "w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-mono text-slate-500 cursor-not-allowed"

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}

export function TenantForm() {
  const [error, setError] = useState("")
  const [name, setName]   = useState("")
  const [pending, startTransition] = useTransition()
  const slug = slugify(name)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    const fd = new FormData(e.currentTarget)
    fd.set("slug", slug)

    startTransition(async () => {
      const result = await createTenant(fd)
      if (result?.error) setError(result.error)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <SectionCard icon={Building2} title="Empresa" description="Dados da organização que vai usar o Kora.">
        <div className="space-y-4">
          <FormRow label="Nome" required>
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Acme Atendimento Ltda."
              className={inputCls}
            />
          </FormRow>

          <FormRow label="Slug" hint="Identifica o cliente nas URLs. Gerado a partir do nome.">
            <input value={slug} readOnly placeholder="gerado-automaticamente" className={inputReadOnlyCls} />
          </FormRow>

          <FormRow label="Plano">
            <select name="plan" defaultValue="trial" className={inputCls}>
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </FormRow>
        </div>
      </SectionCard>

      <SectionCard icon={UserPlus} title="Owner" description="Primeiro usuário do cliente. Pode fazer login imediatamente.">
        <div className="space-y-4">
          <FormRow label="Nome do owner" required>
            <input name="owner_name" required className={inputCls} />
          </FormRow>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormRow label="E-mail" required>
              <input name="owner_email" type="email" required className={inputCls} />
            </FormRow>
            <FormRow label="Senha inicial" required hint="Mínimo 8 caracteres.">
              <input name="owner_password" type="password" required minLength={8} className={inputCls} />
            </FormRow>
          </div>
        </div>
      </SectionCard>

      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-danger-bg border border-red-200 px-4 py-3">
          <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !name}
          className="inline-flex items-center justify-center gap-2 h-10 px-5 bg-primary hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {pending ? <><Loader2 className="size-4 animate-spin" /> Criando…</> : "Criar cliente"}
        </button>
      </div>
    </form>
  )
}
