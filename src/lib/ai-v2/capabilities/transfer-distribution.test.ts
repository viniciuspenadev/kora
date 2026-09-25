import { beforeEach, expect, it, vi } from "vitest"
vi.mock("server-only",()=>({}))
const send=vi.fn(), rpc=vi.fn()
let rows:Record<string,any>[]=[]
let conversation:Record<string,any>
const db={rpc,from:(table:string)=>{
  const filters:Array<(r:any)=>boolean>=[];let patch:any,insert:any,single=false
  const q:any={select:()=>q,eq:(key:string,value:any)=>{filters.push(r=>key.includes("->>")?r[key.split("->>")[0]]?.[key.split("->>")[1]]===value:r[key]===value);return q},
    update:(p:any)=>{patch=p;return q},insert:(r:any)=>{insert=r;return q},maybeSingle:()=>{single=true;return q},
    then:(resolve:any)=>Promise.resolve().then(()=>{const all=table==="chat_messages"?rows:[conversation];
      let matched=all.filter(r=>filters.every(f=>f(r)));if(patch)matched.forEach(r=>Object.assign(r,structuredClone(patch)))
      if(insert){rows.push(insert);matched=[insert]}
      return {data:structuredClone(single?matched[0]??null:matched),error:null}
    }).then(resolve)};return q}}
vi.mock("@/lib/supabase",()=>({supabaseAdmin:db}))
vi.mock("@/lib/channels/reply",()=>({sendChannelText:send}))
vi.mock("@/lib/atendimento/availability",()=>({checkDestinationAvailability:async()=>({available:true,reason:null})}))
vi.mock("@/lib/ai-v2/outbound",()=>({sendBotText:vi.fn()}))
const {transferToSelectedAgents,deliverPresentation}=await import("./transfer-distribution")
const agent="00000000-0000-0000-0000-000000000001"
const ctx:any={tenantId:"tenant",conversationId:"conv",contact:{phone_number:"test"},instance:{},departments:[],
 conversationMetadata:{},transferExecution:{flowId:"flow",nodeId:"node",runKey:"run"}}
beforeEach(()=>{
 send.mockReset().mockResolvedValue({messageId:"provider-id"});rpc.mockReset()
 rows=[{id:"message",tenant_id:"tenant",conversation_id:"conv",content:"Olá Agente",status:"pending",metadata:{delivery_state:"ready",transfer_receipt:"receipt"}}]
 conversation={id:"conv",tenant_id:"tenant",assigned_to:agent,status:"open",metadata:{ai_routed:{receipt_id:"receipt"}},updated_at:"initial"}
})
it("reserva de envio concorrente transmite uma única apresentação",async()=>{
 await Promise.all([deliverPresentation(ctx,"message","receipt",agent),deliverPresentation(ctx,"message","receipt",agent)])
 expect(send).toHaveBeenCalledTimes(1);expect(rows[0].status).toBe("sent")
})
it("timeout mantém atribuição e não permite reenvio automático",async()=>{
 send.mockRejectedValueOnce(new Error("timeout"))
 await deliverPresentation(ctx,"message","receipt",agent);await deliverPresentation(ctx,"message","receipt",agent)
 expect(send).toHaveBeenCalledTimes(1);expect(conversation.assigned_to).toBe(agent)
 expect(rows[0].metadata.delivery_state).toBe("unknown");expect(rows[0].status).toBe("failed")
})
it("mudança humana cancela a apresentação antes do provider",async()=>{
 conversation.metadata.ai_routed={via:"human_reply"}
 await deliverPresentation(ctx,"message","receipt",agent)
 expect(send).not.toHaveBeenCalled();expect(rows[0].metadata.delivery_state).toBe("cancelled")
})
it("simulação captura o texto sem chamar provider",async()=>{
 const captured:any[]=[]
 await deliverPresentation({...ctx,dryRun:true,captured},"message","receipt",agent)
 expect(send).not.toHaveBeenCalled();expect(captured).toEqual([{kind:"text",content:"Olá Agente"}])
})
it("não envia quando o banco não confirma atribuição",async()=>{
 rpc.mockResolvedValue({data:null,error:{code:"XX000"}})
 await expect(transferToSelectedAgents(ctx,{agentIds:[agent],roundRobin:true,handoffMessage:"Olá {{agente}}",waitMessage:null,whenUnavailable:"queue"},{assigned_to:null})).rejects.toThrow("confirmar a distribuição")
 expect(send).not.toHaveBeenCalled()
})
it("envia somente após confirmação e usa texto congelado no banco",async()=>{
 rpc.mockImplementation(async()=>{expect(send).not.toHaveBeenCalled();return{data:{message_id:"message",receipt_id:"receipt",assigned_to:agent},error:null}})
 const result=await transferToSelectedAgents(ctx,{agentIds:[agent],roundRobin:true,handoffMessage:"Olá {{agente}}",waitMessage:null,whenUnavailable:"queue"},{assigned_to:null})
 expect(result.ok).toBe(true);expect(send.mock.calls[0][1]).toBe("Olá Agente")
})
it("destino de outro tenant não é carregado pelo envio",async()=>{
 rows[0].tenant_id="other"
 await deliverPresentation(ctx,"message","receipt",agent)
 expect(send).not.toHaveBeenCalled()
})
