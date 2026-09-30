"use client"
import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CreditCard, Mail, Loader2, ArrowRightLeft } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { changeBillingMode, resumeBillingModeChange, cancelBillingModeSchedule } from "@/lib/actions/admin-billing-mode"
import { resendOwnerInvite } from "@/lib/actions/admin-onboarding"
import { reconcileHistoricalBillingEvent } from "@/lib/actions/admin-historical-billing"

type Change = { id: string; from_mode: string; to_mode: string; effective_on: string }
type ReviewEvent = { id: string; event_type: string; payment_id: string | null; received_at: string }
export function BillingModePanel({ tenantId, mode, snapshot, pendingChange, paidUntil, openInvoices, ownerPending, lifecycle, hasSubscription, reviewEvents }: {
  tenantId: string; mode: string; snapshot: Record<string, unknown>; pendingChange: Change | null;
  paidUntil: string | null; openInvoices: number; ownerPending: boolean; lifecycle: string;
  hasSubscription: boolean; reviewEvents: ReviewEvent[];
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const operation = useRef<string | null>(null)
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo'}).format(new Date())
  const afterPaid = paidUntil ? new Date(new Date(paidUntil + 'T12:00:00Z').getTime() + 86_400_000).toISOString().slice(0,10) : today
  const minimum = afterPaid > today ? afterPaid : today
  const [date, setDate] = useState(minimum)
  const target = mode === 'manual' ? 'gateway' : 'manual'
  const access = ({active:'Autorizado',trialing:'Em teste',trial_ended:'Contratação pendente',pending_approval:'Aguarda aprovação',suspended:'Suspenso',deactivated:'Desativado'} as Record<string,string>)[lifecycle] ?? lifecycle
  const btn = "inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
  function act(fn: () => Promise<{error?: string; completed?: boolean; sent?: boolean}>, success: string) {
    setMessage('')
    start(async () => { try { const r=await fn(); setMessage(r.error ?? (r.sent === false ? 'Convite renovado. O envio de e-mail ainda está pendente; confira a configuração de e-mail.' : success)); if (!r.error) { operation.current=null; setEditing(false); setAcknowledged(false) } router.refresh() }
      catch {setMessage('Não foi possível confirmar a resposta. Recarregue para conferir a operação.')} })
  }
  return <div className="space-y-5 mb-5">
    <SectionCard title="Cadastro, acesso e cobrança" icon={CreditCard} description="Cada estado representa uma etapa independente da conta.">
      <dl className="grid gap-4 sm:grid-cols-3 text-sm">
        <div><dt className="text-slate-500">Cadastro</dt><dd className="mt-1 font-semibold">{ownerPending ? 'Convite do responsável pendente' : 'Responsável vinculado'}</dd></div>
        <div><dt className="text-slate-500">Acesso</dt><dd className="mt-1 font-semibold">{access}</dd></div>
        <div><dt className="text-slate-500">Cobrança</dt><dd className="mt-1 font-semibold">{mode === 'manual' ? 'Manual' : hasSubscription ? 'Gateway · assinatura vinculada' : 'Gateway · contratação pendente'}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {ownerPending && <button disabled={pending} className={btn} onClick={() => act(() => resendOwnerInvite(tenantId),'Convite encaminhado ao serviço de e-mail.')}><Mail className="size-4" />Reenviar convite</button>}
        {!pendingChange && <button disabled={pending} className={btn} onClick={() => setEditing(!editing)}><ArrowRightLeft className="size-4" />Alterar modalidade</button>}
        {pending && <Loader2 className="size-4 animate-spin self-center" />}
      </div>
      {mode === 'gateway' && !hasSubscription && <p className="mt-3 text-xs text-slate-500">O responsável conclui a contratação em Configurações → Assinatura, usando o próprio acesso.</p>}
      {pendingChange && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">{pendingChange.from_mode === 'manual' ? 'Mudança agendada' : 'Cancelamento externo em confirmação'} · {pendingChange.to_mode === 'manual' ? 'Manual' : 'Gateway'}</p>
        <p className="mt-1">Vigência: {pendingChange.effective_on.split('-').reverse().join('/')}.</p>
        <div className="mt-3 flex gap-2 flex-wrap"><button className={btn} disabled={pending} onClick={() => act(() => resumeBillingModeChange(tenantId,pendingChange.id),'Operação conferida. A modalidade abaixo mostra o estado atual.')}>Retomar / conferir</button>
          {pendingChange.from_mode === 'manual' && <button className={btn} disabled={pending} onClick={() => act(() => cancelBillingModeSchedule(tenantId,pendingChange.id),'Agendamento cancelado.')}>Cancelar agendamento</button>}</div>
      </div>}
      {editing && !pendingChange && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
        <h3 className="text-sm font-semibold">Mudar para {target === 'manual' ? 'cobrança manual' : 'gateway'}</h3>
        <p className="text-sm text-slate-600">{target === 'manual' ? 'A recorrência externa será cancelada. O acesso ficará autorizado e será administrado no Godmode. Faturas anteriores permanecem no histórico.' : 'Na vigência, a conta passa a aguardar contratação pelo responsável. Até lá, o acesso e a cobrança manual continuam vigentes. O cliente pagará ao contratar.'}</p>
        <p className="text-sm text-slate-600">{paidUntil ? 'Período pago até '+paidUntil.split('-').reverse().join('/') : 'Sem período pago registrado'} · {openInvoices} faturas pendentes.</p>
        {target === 'gateway' && <label className="block text-sm font-medium">Início da modalidade<input type="date" required min={minimum} value={date} onChange={e => setDate(e.target.value)} className="mt-2 block rounded-lg border border-slate-200 bg-white px-3 py-2" /></label>}
        <label className="flex gap-2 text-sm text-slate-700"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="accent-primary" />Conferi a vigência, o acesso e as faturas. Eventos do contrato anterior poderão exigir conciliação pela equipe.</label>
        <button disabled={pending || !acknowledged || (target==='gateway' && (openInvoices>0 || date<minimum))} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => {
          operation.current ??= crypto.randomUUID()
          act(() => changeBillingMode(tenantId,{requestId:operation.current!,mode:target,effectiveOn:target==='manual'?today:date,snapshot}),'Mudança registrada. Confira a modalidade e a vigência atualizadas.')
        }}>Confirmar mudança</button>
        {target === 'gateway' && openInvoices > 0 && <p className="text-xs text-amber-800">Concilie as faturas pendentes antes de agendar.</p>}
      </div>}
      {message && <p role="status" className="mt-4 text-sm text-slate-700">{message}</p>}
    </SectionCard>
    {reviewEvents.length > 0 && <SectionCard title="Eventos do contrato anterior" description="Conciliação financeira necessária. Estes eventos não alteram o acesso da conta.">
      <ul className="divide-y divide-slate-100 text-sm">{reviewEvents.map(e => <li key={e.id} className="py-3 break-words"><span className="font-medium">{e.event_type}</span> · {e.payment_id ?? 'Assinatura'}<span className="block text-xs text-slate-500">{new Date(e.received_at).toLocaleString('pt-BR')}</span><button disabled={pending} className={btn+' mt-2'} onClick={() => act(() => reconcileHistoricalBillingEvent(tenantId,e.id),'Conciliação concluída e auditada. Acesso preservado.')}>Conciliar com o gateway</button></li>)}</ul>
    </SectionCard>}
  </div>
}
