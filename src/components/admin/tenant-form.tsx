"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, ArrowLeft, ArrowRight, Building2, Check, CreditCard, Loader2, Mail, Settings2 } from "lucide-react"
import { createTenant } from "@/lib/actions/admin"
import { SectionCard } from "@/components/ui/section-card"
import { SimpleSelect } from "@/components/ui/select"

export type SignupPlan = { id: string; name: string; price_cents: number; trial_days: number; trial_activation_mode: string; included_modules: string[]; limits: Record<string, number | null> | null }
const inputCls = "mt-1.5 w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
const buttonCls = "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
function slugify(s: string) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) }

export function TenantForm({ plans }: { plans: SignupPlan[] }) {
  const router = useRouter()
  const form = useRef<HTMLFormElement>(null)
  const requestId = useRef<string | null>(null)
  const submitted = useRef<FormData | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [owner, setOwner] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")
  const [mode, setMode] = useState<"manual" | "gateway">("manual")
  const [access, setAccess] = useState("authorized")
  const [pending, startTransition] = useTransition()
  const [attempted, setAttempted] = useState(false)
  const plan = plans.find(p => p.id === planId)
  const accessLabel = mode === "manual" ? (access === "authorized" ? "Autorizado após o aceite do convite" : "Aguarda aprovação no Godmode")
    : plan?.trial_days ? (plan.trial_activation_mode === "auto" ? "Teste de " + plan.trial_days + " dias a partir da criação" : "Teste sujeito à aprovação no Godmode") : "Contratação pendente"

  function next() {
    if (!form.current?.reportValidity()) return
    if (step === 0 && !/^\d{10,13}$/.test(phone.replace(/\D/g, ""))) { setError("Confira o telefone com DDD."); return }
    setError(""); setStep(s => Math.min(2, s + 1))
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (step < 2) { next(); return }
    setError("")
    requestId.current ??= crypto.randomUUID()
    if (!submitted.current) {
      const fd = new FormData()
      Object.entries({ request_id: requestId.current, name, slug, owner_name: owner, owner_email: email, owner_phone: phone,
        plan_id: planId, billing_mode: mode, access: mode === "gateway" ? "plan" : access }).forEach(([key, value]) => fd.set(key, value))
      submitted.current = fd
    }
    setAttempted(true)
    startTransition(async () => {
      try {
        const result = await createTenant(submitted.current!)
        if (result.error) {
          setError(result.error)
          if (result.canEdit) { setAttempted(false); submitted.current=null; requestId.current=null; setStep(0) }
          return
        }
        if (result.tenantId) router.push("/admin/tenants/" + result.tenantId + "/cobranca?cadastro=" + (result.inviteSent ? "enviado" : "envio-pendente"))
      } catch { setError("Não foi possível confirmar a resposta. Tente novamente para recuperar este mesmo cadastro.") }
    })
  }

  return <form ref={form} onSubmit={submit} className="space-y-6" aria-busy={pending}>
    <ol aria-label="Etapas do cadastro" className="grid grid-cols-3 gap-2">
      {["Dados", "Plano e cobrança", "Revisão"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined}
        className={"flex items-center gap-2 rounded-lg border px-3 py-3 text-xs sm:text-sm " + (step === index ? "border-primary/30 bg-primary/5 text-primary font-semibold" : "border-slate-200 bg-white text-slate-500")}>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100">{index < step ? <Check className="size-3.5" /> : index + 1}</span>{label}
      </li>)}
    </ol>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        {step === 0 && <SectionCard title="Empresa e responsável" icon={Building2} description="O responsável recebe um convite para definir a senha ou entrar com sua conta existente.">
          <fieldset disabled={pending || attempted} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Nome da empresa
              <input autoFocus required minLength={2} maxLength={120} value={name} onChange={e => { setName(e.target.value); if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value)) }} className={inputCls} autoComplete="organization" /></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Identificador da empresa
              <input required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" value={slug} onChange={e => setSlug(e.target.value)} className={inputCls} />
              <span className="mt-1 block text-xs font-normal text-slate-500">Letras minúsculas, números e hífens. Deve ser único.</span></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Nome do responsável
              <input required minLength={2} maxLength={120} value={owner} onChange={e => setOwner(e.target.value)} className={inputCls} autoComplete="name" /></label>
            <label className="text-sm font-medium text-slate-700">E-mail
              <input required type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className={inputCls} autoComplete="email" /></label>
            <label className="text-sm font-medium text-slate-700">Telefone
              <input required type="tel" minLength={10} maxLength={20} value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} autoComplete="tel" /></label>
          </fieldset>
        </SectionCard>}
        {step === 1 && <SectionCard title="Plano e cobrança" icon={Settings2} description="Escolha como a empresa será atendida financeiramente.">
          <div className="space-y-5">
            <div><p className="mb-2 text-sm font-semibold">Plano</p><SimpleSelect ariaLabel="Plano" value={planId} onChange={setPlanId} disabled={pending || attempted} options={plans.map(p => ({value:p.id,label:p.name}))} placeholder="Selecione um plano" /></div>
            {plan && <p className="text-sm text-slate-500">{plan.included_modules.length} módulos no plano · limites conforme o catálogo vigente.</p>}
            <fieldset disabled={pending || attempted} className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-sm font-semibold">Modalidade</legend>
              {([['manual','Manual','Pagamento combinado com a equipe.'],['gateway','Gateway','Cliente conclui a contratação no Kora.']] as const).map(([value,label,hint]) =>
                <label key={value} className={"cursor-pointer rounded-xl border p-4 " + (mode === value ? 'border-primary bg-primary/5' : 'border-slate-200')}>
                  <span className="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="accent-primary" />{label}</span>
                  <span className="mt-2 block text-xs text-slate-500">{hint}</span></label>)}
            </fieldset>
            {mode === 'manual' && <div><p className="mb-2 text-sm font-semibold">Condição de acesso</p><SimpleSelect ariaLabel="Condição de acesso" value={access} onChange={setAccess} disabled={pending || attempted} options={[{value:'authorized',label:'Autorizar após o aceite'},{value:'pending',label:'Aguardar aprovação no Godmode'}]} /></div>}
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{accessLabel}. O cadastro não gera fatura nem confirma pagamento.</p>
          </div>
        </SectionCard>}
        {step === 2 && <SectionCard title="Confira o cadastro" icon={Check} description="A empresa será criada com o plano escolhido e um convite para o responsável.">
          <dl className="space-y-4 text-sm">{[['Empresa',name],['Identificador',slug],['Responsável',owner],['E-mail',email],['Telefone',phone],['Acesso',accessLabel]].map(([label,value]) =>
            <div key={label} className="grid gap-1 sm:grid-cols-[130px_minmax(0,1fr)]"><dt className="text-slate-500">{label}</dt><dd className="break-words font-medium text-slate-900">{value}</dd></div>)}</dl>
          <div className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-600 flex items-start gap-2"><Mail className="size-4 mt-0.5 shrink-0" /><p>O convite vale por 7 dias. O responsável completa os dados da empresa e conecta o WhatsApp nas integrações, conforme o plano.</p></div>
        </SectionCard>}
        {error && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle className="size-4 shrink-0 mt-0.5" />{error}</div>}
        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4">
          <button type="button" disabled={step === 0 || pending || attempted} onClick={() => setStep(s => s - 1)} className={buttonCls + " border border-slate-200 bg-white text-slate-700"}><ArrowLeft className="size-4" />Voltar</button>
          <button type="submit" disabled={pending || !planId} className={buttonCls + " bg-primary text-white hover:bg-primary-700"}>
            {pending ? <><Loader2 className="size-4 animate-spin" />Criando…</> : step === 2 ? (attempted ? 'Tentar novamente' : 'Criar cliente e enviar convite') : <>Continuar<ArrowRight className="size-4" /></>}
          </button>
        </div>
        {attempted && error && <p className="text-xs text-slate-500">Os dados desta tentativa foram preservados para recuperar o mesmo cadastro. Para corrigir os dados, confira primeiro se a empresa já aparece na lista de clientes.</p>}
      </div>
      <aside className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-label="Resumo do cadastro">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CreditCard className="size-4 text-primary" />Resumo</div>
        <p className="font-semibold text-slate-900">{plan?.name ?? 'Selecione um plano'}</p>
        <p className="text-2xl font-bold tabular-nums text-slate-900">{((plan?.price_cents ?? 0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}<span className="text-xs font-normal text-slate-500"> / mês no catálogo</span></p>
        <dl className="space-y-3 border-t border-slate-100 pt-4 text-sm"><div><dt className="text-slate-500">Cobrança</dt><dd className="mt-1 font-medium">{mode === 'manual' ? 'Manual' : 'Gateway · contratação pelo cliente'}</dd></div><div><dt className="text-slate-500">Acesso</dt><dd className="mt-1">{accessLabel}</dd></div></dl>
        <p className="text-xs leading-relaxed text-slate-500">{mode === 'manual' ? 'Faturas e recebimentos internos podem ser registrados depois, por iniciativa da equipe.' : 'Dados fiscais e forma de pagamento serão informados pelo responsável no fluxo seguro de contratação.'}</p>
      </aside>
    </div>
  </form>
}
