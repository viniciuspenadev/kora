"use server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { asaas } from "@/lib/asaas/client"
import { revalidatePath } from "next/cache"

export async function reconcileHistoricalBillingEvent(tenantId: string, eventId: string): Promise<{error?: string}> {
  const session=await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  const {data:event,error}=await supabaseAdmin.from("asaas_webhook_events").select("id,event_type,payment_id")
    .eq("tenant_id",tenantId).eq("id",eventId).eq("billing_review_required",true).maybeSingle()
  if (error || !event) return {error:"Evento pendente não encontrado."}
  if (["SUBSCRIPTION_DELETED","SUBSCRIPTION_INACTIVATED","SUBSCRIPTION_UPDATED"].includes(event.event_type)) {
    const {error:ackError}=await supabaseAdmin.rpc("concluir_revisao_evento_informativo",{p_tenant:tenantId,p_event:eventId,p_actor:session.user.id})
    if (ackError) return {error:"Não foi possível concluir a revisão."}
  } else {
    if (!event.payment_id) return {error:"Evento sem pagamento. A conciliação exige análise financeira."}
    try {
      const payment=await asaas.get<{id:string;customer:string;subscription:string;status:string;value:number;billingType:string;dueDate:string;confirmedDate?:string;paymentDate?:string;refunds?:{value:number;status:string;dateCreated?:string}[]}>(`/payments/${encodeURIComponent(event.payment_id)}`)
      if (payment.id!==event.payment_id || !["CONFIRMED","RECEIVED","REFUNDED","CHARGEBACK_REQUESTED"].includes(payment.status)
        || !Number.isFinite(payment.value) || payment.value<=0 || !payment.customer || !payment.subscription) return {error:"O gateway ainda não confirma um estado financeiro conciliável. A revisão permanece pendente."}
      if (["CONFIRMED","RECEIVED"].includes(payment.status) && payment.refunds?.some(r=>r.status==='DONE')) return {error:"Estorno parcial exige análise dos valores. A revisão foi preservada."}
      const valueCents=Math.round(payment.value*100)
      if (!Number.isSafeInteger(valueCents)) return {error:"Valor financeiro inválido."}
      const parseGatewayDate = (value?: string) => {
        if (!value || !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(value)) return null
        const date=new Date((value.length===10 ? value+'T00:00:00' : value.replace(' ','T'))+'-03:00')
        return Number.isFinite(date.getTime()) ? date.toISOString() : null
      }
      const paymentAt=parseGatewayDate(payment.confirmedDate ?? payment.paymentDate)
      const reversalAt=payment.refunds?.filter(r=>r.status==='DONE').map(r=>parseGatewayDate(r.dateCreated)).filter((d):d is string=>!!d).sort().at(-1) ?? null
      if (!paymentAt || !/^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate) || (payment.status==='REFUNDED' && !reversalAt)) return {error:"O gateway não informou as datas necessárias. A revisão foi preservada."}
      // Chargebacks require the dated event that proves the debit, not the date of payment.
      if (payment.status==='CHARGEBACK_REQUESTED') return {error:"Chargeback requer conciliação com a evidência datada da contestação. A revisão foi preservada."}
      const {error:ledgerError}=await supabaseAdmin.rpc("conciliar_evento_gateway_historico",{
        p_tenant:tenantId,p_event:eventId,p_actor:session.user.id,p_payment:payment.id,p_customer:payment.customer,
        p_subscription:payment.subscription,p_status:payment.status,p_value:valueCents,p_method:payment.billingType?.toLowerCase() ?? null,
        p_due:payment.dueDate,p_payment_at:paymentAt,p_reversal_at:reversalAt,
      })
      if (ledgerError) return {error:"O contrato, a fatura ou o histórico requerem análise. Nenhum estado de acesso foi alterado."}
    } catch {return {error:"Não foi possível confirmar o pagamento no gateway. A revisão permanece pendente."}}
  }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}
