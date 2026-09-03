import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryDb } from '@/test/supabase-memory'
vi.mock('server-only', () => ({}))
const db = new MemoryDb()
let duringAvailability = () => {}
const agent = vi.fn()
const llm = vi.fn()
vi.mock('@/lib/llm/openai',()=>({runChat:llm}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: db }))
vi.mock('@/auth', () => ({ auth: async () => null }))
vi.mock('@/lib/modules', () => ({ hasModule: async () => true }))
vi.mock('@/lib/atendimento/events', () => ({ logConversationEvent: async () => {} }))
vi.mock('@/lib/commercial/entries', () => ({ emitCommercialEvent: async () => {} }))
vi.mock('@/lib/ai-v2/agent', () => ({ runAgentTurn: agent }))
vi.mock('@/lib/ai-v2/flow/data-sources', () => ({resolveConnectedSources:()=>({tools:[],toolConfig:{}})}))
vi.mock('@/lib/ai-v2/flow/router', () => ({}))
vi.mock('@/lib/ai-v2/flow/schedule', () => ({}))
vi.mock('@/lib/ai-v2/flow/outreach', () => ({}))
vi.mock('@/lib/ai-v2/flow/dossier', () => ({ extractDossier: async () => [] }))
vi.mock('@/lib/atendimento/availability', () => ({ checkDestinationAvailability: async () => { duringAvailability(); return { available: true } } }))
vi.mock('@/lib/ai-v2/capabilities', () => ({ ...Object.fromEntries(['SEND_MESSAGE','UPDATE_CONTACT','SEARCH_KNOWLEDGE','CHECK_AVAILABILITY','SCHEDULE_APPOINTMENT','RESCHEDULE_APPOINTMENT','CONSULT_APPOINTMENTS','CONSULT_DEALS','CONSULT_QUOTES','SEND_QUOTE','CONFIRM_IDENTITY'].map(k=>[k,k.toLowerCase()])), ensureCapabilitiesRegistered: () => {}, toolsForAgent:()=>[], assemblePlaybooks:()=>'', getCapability: () => transferCapability, TRANSFER: 'transfer', HTTP_REQUEST: 'http', TAG: 'tag', MOVE_STAGE: 'move_stage' }))
const { transferCapability } = await import('@/lib/ai-v2/capabilities/transfer')
const { runFlow } = await import('@/lib/ai-v2/flow/runtime')
const { StudioControlChangedError } = await import('@/lib/ai-v2/control-error')
const { updateFlowRun } = await import('@/lib/ai-v2/flow/run-state')
const conv = () => db.tables.chat_conversations[0]
const storedRun = () => db.tables.studio_flow_runs[0]
const execution = () => ({ ctx: { tenantId:'t', conversationId:'c', contact:{id:'contact'}, conversationMetadata:structuredClone(conv().metadata), departments:[], instance:{},history:[] }, model:'test',persona:{},history:[],incomingText:'Maria' } as any)
const flow = (type:string, config:any={}) => ({id:'old-flow',tenant_id:'t',version:1,graph:{nodes:[{id:'old-node',type,config}],edges:[]}} as any)
const oldRun = () => structuredClone(storedRun()) as any
function replaceGeneration() {
  conv().metadata = {attendance_cycle:'new-cycle'}
  conv().updated_at = 'new-time'
  Object.assign(storedRun(), {flow_id:'new-flow',current_node_id:'new-node',status:'waiting',variables:{new_generation:true},updated_at:'new-time'})
}
beforeEach(() => {
  duringAvailability=()=>{}; agent.mockReset()
  db.reset({chat_conversations:[{id:'c',tenant_id:'t',status:'open',assigned_to:null,contact_id:'contact',instance_id:null,metadata:{attendance_cycle:'old-cycle'},updated_at:'old-time',ai_handling:true}],studio_flow_runs:[{id:'stable-run',tenant_id:'t',conversation_id:'c',flow_id:'old-flow',current_node_id:'old-node',status:'active',variables:{old_generation:true},call_stack:[]}],chat_contacts:[{id:'contact',tenant_id:'t',owner_id:null}],chat_messages:[]})
})
it('cancelamento da transferência preserva a execução nova',async()=>{
  duringAvailability=replaceGeneration
  await expect(runFlow(execution(),flow('transfer',{target:'pool'}),oldRun())).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().status).toBe('waiting')
  expect(storedRun().variables.new_generation).toBe(true)
  expect(conv().metadata.attendance_cycle).toBe('new-cycle')
})
it('retorno atrasado da IA preserva fluxo e variáveis novos',async()=>{
  agent.mockImplementationOnce(async()=>{replaceGeneration();return {status:'no_action',sentMessage:false}})
  await expect(runFlow(execution(),flow('ai_agent'),oldRun())).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().flow_id).toBe('new-flow')
  expect(storedRun().current_node_id).toBe('new-node')
  expect(storedRun().variables.new_generation).toBe(true)
})
it('coleta retomada após tomada humana não altera a ficha',async()=>{
  storedRun().status='waiting';storedRun().variables={'collect:old-node:key':'nome'}
  const ctx=execution(), r=oldRun()
  conv().metadata={ai_routed:{via:'human_reply'}};conv().assigned_to='human'
  await expect(runFlow(ctx,flow('collect',{fields:[{question:'Nome?',saveAs:'nome',mapTo:'name'}]}),r)).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(db.tables.chat_contacts[0].custom_name).toBeUndefined()
})

it('CAS da persistência recusa substituição entre leitura e escrita', async () => {
  const r=oldRun()
  db.beforeWrite=(table)=>{ if(table==='studio_flow_runs') replaceGeneration() }
  await expect(updateFlowRun('t', r, {status:'done'})).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().variables.new_generation).toBe(true)
  expect(storedRun().status).toBe('waiting')
})
it('execução encerrada não pode ser ressuscitada por resposta antiga', async () => {
  const r=oldRun(); storedRun().status='done'
  await expect(updateFlowRun('t', r, {status:'waiting'})).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().status).toBe('done')
})
it('novo disparo sem mudança da conversa ainda invalida o snapshot antigo', async () => {
  const r=oldRun(); storedRun().variables={__run_generation:'new'}
  await expect(updateFlowRun('t', r, {status:'done'})).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().variables.__run_generation).toBe('new')
})

it.each(["pool", "department"])("agente transfere para %s com mensagem e encerra run",async target=>{
  const {runAgentTurn:realAgent}=await vi.importActual<typeof import("@/lib/ai-v2/agent")>("@/lib/ai-v2/agent")
  const input=execution(); input.ctx.channel="site";input.ctx.departments=[{id:"sales",name:"Sales"}]
  llm.mockResolvedValueOnce({usage:{inputTokens:1,outputTokens:1},text:null,toolCalls:[{id:"tc",name:"transfer",arguments:JSON.stringify({target,department:"Sales",handoff_message:"Vou transferir.",byAI:false})}]})
  agent.mockImplementationOnce(realAgent)
  const result=await runFlow(input,flow("ai_agent"),oldRun())
  expect(result.status).toBe("routed"); expect(storedRun().status).toBe("done")
  expect(conv().metadata.ai_routed.via).toBe("studio_transfer")
})
it("agente propaga cancelamento sem transformá-lo em resposta de erro",async()=>{
  const {runAgentTurn:realAgent}=await vi.importActual<typeof import("@/lib/ai-v2/agent")>("@/lib/ai-v2/agent")
  duringAvailability=replaceGeneration
  llm.mockResolvedValueOnce({usage:{inputTokens:1,outputTokens:1},text:null,toolCalls:[{id:"tc",name:"transfer",arguments:JSON.stringify({target:"pool",byAI:false})}]})
  agent.mockImplementationOnce(realAgent)
  await expect(runFlow(execution(),flow("ai_agent"),oldRun())).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().variables.new_generation).toBe(true)
})

it("duas persistências do mesmo estado têm um único vencedor mesmo sem mudar status",async()=>{
  const first=oldRun(),second=oldRun()
  await updateFlowRun("t",first,{current_node_id:"next"})
  await expect(updateFlowRun("t",second,{current_node_id:"obsolete"})).rejects.toBeInstanceOf(StudioControlChangedError)
  expect(storedRun().current_node_id).toBe("next")
})
it("mutação de variável aninhada não modifica o snapshot já persistido",async()=>{
  const r=oldRun(),vars={nested:{value:1}}
  await updateFlowRun("t",r,{variables:vars})
  vars.nested.value=2
  await updateFlowRun("t",r,{variables:vars})
  expect(storedRun().variables.nested.value).toBe(2)
})
