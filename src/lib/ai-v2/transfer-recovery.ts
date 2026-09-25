import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { filterServiceableTenants } from "@/lib/auth/tenant-serviceable"
import { deliverPresentation } from "./capabilities/transfer-distribution"
import type { ExecCtx } from "./capabilities/types"

/** Recovery only: ready messages are claimed once; ambiguous sends never retry. */
export async function recoverTransferPresentations(): Promise<number> {
  const cutoff = new Date(Date.now()-5*60_000).toISOString()
  const {data:stale,error:staleError}=await supabaseAdmin.from("chat_messages")
    .select("id,tenant_id,metadata").eq("metadata->>delivery_state","sending").not("metadata->>transfer_receipt","is",null)
    .lt("metadata->>claimed_at",cutoff).limit(20)
  if(staleError) throw new Error("Falha ao consultar apresentações em processamento.")
  for(const m of stale??[]) await supabaseAdmin.from("chat_messages")
    .update({status:"failed",metadata:{...m.metadata,delivery_state:"unknown"}})
    .eq("tenant_id",m.tenant_id).eq("id",m.id).eq("metadata->>delivery_state","sending")
  const {data:pending,error}=await supabaseAdmin.from("chat_messages")
    .select("id,tenant_id,conversation_id,metadata").eq("metadata->>delivery_state","ready")
    .eq("metadata->>simulation","false").order("created_at",{ascending:true}).limit(20)
  if(error) throw new Error("Falha ao consultar apresentações pendentes.")
  const {serviceable,degraded}=await filterServiceableTenants((pending??[]).map(m=>m.tenant_id))
  if(degraded) throw new Error("Não foi possível conferir as contas das apresentações pendentes.")
  let checked=0
  for(const m of pending??[]) {
    if(!serviceable.has(m.tenant_id)||!await hasModule(m.tenant_id,"ai_studio")) {
      await supabaseAdmin.from("chat_messages").update({status:"failed",metadata:{...m.metadata,delivery_state:"cancelled",reason:"studio_unavailable"}})
        .eq("tenant_id",m.tenant_id).eq("id",m.id).eq("metadata->>delivery_state","ready")
      continue
    }
    const {data:c,error:convError}=await supabaseAdmin.from("chat_conversations")
      .select("id,channel,instance_id,assigned_to,metadata,chat_contacts(*)")
      .eq("tenant_id",m.tenant_id).eq("id",m.conversation_id).maybeSingle()
    if(convError||!c) continue
    const contact=Array.isArray(c.chat_contacts)?c.chat_contacts[0]:c.chat_contacts
    if(!contact) continue
    let instance:ExecCtx["instance"]={}
    if(c.instance_id) {
      const {data:i,error:instError}=await supabaseAdmin.from("whatsapp_instances")
        .select("provider,evolution_url,evolution_key,instance_name,meta_phone_number_id,meta_access_token,meta_business_account_id,meta_app_secret")
        .eq("tenant_id",m.tenant_id).eq("id",c.instance_id).maybeSingle()
      if(instError||!i) continue
      instance=i
    }
    // Receipt agent, not current owner: a manual change must cancel the old intro.
    const {data:receipt,error:receiptError}=await supabaseAdmin.from("chat_messages").select("metadata")
      .eq("tenant_id",m.tenant_id).eq("conversation_id",m.conversation_id).eq("id",m.metadata.transfer_receipt).maybeSingle()
    if(receiptError||!receipt) continue
    await deliverPresentation({tenantId:m.tenant_id,conversationId:c.id,contact: contact as unknown as ExecCtx["contact"],instance,
      departments:[],channel:c.channel,conversationMetadata:c.metadata},m.id,m.metadata.transfer_receipt,receipt.metadata.assigned_to??null)
    checked++
  }
  return checked
}
