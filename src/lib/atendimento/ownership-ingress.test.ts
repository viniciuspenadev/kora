// Regression coverage from independent audit reproductions.
// No real credentials, external network, database or provider calls.
import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
let manualAdmin=true
const dispatch = vi.fn(async (_input: any) => ({ status: "no_action" }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "agent", tenantId: "t", role: "owner" } }) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async () => {} }))
vi.mock("@/lib/visibility", async original => ({...await original<typeof import("@/lib/visibility")>(),
  getViewerScope: async()=>({tenantId:"t",userId:"agent",isAdmin:manualAdmin,viewAll:false,instanceIds:null,departmentId:"sales",seePool:true,supervisesDepartments:[]}),
  assertContactAccess:async()=>{}, memberAttendsNumber:()=>true,
}))
vi.mock("@/lib/providers", () => ({ getProvider: () => { throw new Error("Network/provider not allowed") } }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: async () => {}, atendimentoBloqueado: () => false,
  checkTenantStatus: async () => ({ canSpend: true, canAccess: true }), gastoBloqueado: () => false }))
vi.mock("@/lib/modules", () => ({ requireModule: async () => {}, hasModule: async () => true, hasModulePro: async () => false }))
vi.mock("@/lib/llm/active", () => ({ tenantAiActive: async () => true }))
vi.mock("@/lib/ai-v2/dispatch", () => ({ routeAutomationTurn: dispatch,
  channelDispatchesAI: (channel: string | null) => ["whatsapp", "site", "instagram", "meta_cloud"].includes(channel ?? "whatsapp") }))
vi.mock("@/lib/contacts/identity", () => ({ resolveOrCreateContact: async () => ({ id: "contact", created: false }),
  adoptRecipientJid: async () => {}, syncContactIdentities: async () => {} }))
vi.mock("@/lib/whatsapp/provisioning", () => ({}))
vi.mock("@/lib/crypto/secrets", () => ({ decryptSecret: () => null }))
vi.mock("@/lib/media/transcode", () => ({}))
vi.mock("@/lib/atendimento/followup", () => ({ moveFollowUpOwner: async () => {} }))
vi.mock("@/lib/instagram/api", () => ({}))
vi.mock("@/lib/instagram/rich-render", () => ({}))
vi.mock("@/lib/contacts/avatar", () => ({}))
vi.mock("@/lib/instagram/automation-quota", () => ({}))
vi.mock("@/lib/variables/registry", () => ({}))
vi.mock("@/lib/ai-v2/http-guard", () => ({}))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }), getClientIp: () => "local" }))
vi.mock("@/lib/site/domain-guard", () => ({ isOriginAllowed: () => true }))
vi.mock("@/lib/limits", () => ({ requireLimit: async () => {} }))
vi.mock("@/lib/notifications", () => ({ createNotification: async () => {} }))

const { createManualConversation } = await import("@/lib/actions/chat")
const { processInstagramWebhook } = await import("@/lib/channels/instagram-inbound")
const { findOrReopenConversation } = await import("@/lib/conversation-dedup")
const { bumpConversationInbound } = await import("@/lib/channels/inbound-bump")
const { routeUnprocessedInbound } = await import("@/lib/atendimento/unprocessed-inbound")
const { POST: submitLead } = await import("@/app/api/site/lead/route")
const conv = () => db.tables.chat_conversations[0]
const input = { tenantId: "t", contactId: "contact", instanceId: "n", channel: "whatsapp" }
const ig = (message: any) => ({ object: "instagram", entry: [{ id: "account", messaging: [{
  sender: { id: "igsid" }, recipient: { id: "account" }, timestamp: Date.now(), message: { mid: "new-mid", ...message },
}] }] })

beforeEach(() => {
  manualAdmin=true; dispatch.mockClear()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network not allowed") }))
  // Intentionally force actual legacyBump fallback; its reopen behavior equals SQL.
  ;(db as any).rpc = async () => ({ error: { message: "Local test: force legacy fallback" } })
  db.reset({
    chat_conversations: [{ id: "c", tenant_id: "t", contact_id: "contact", instance_id: "n", channel: "whatsapp",
      assigned_to: "agent", department_id: "sales", status: "resolved", ai_handling: false,
      metadata: { ai_routed: { via: "manual" }, attendance_cycle: "old-cycle" },
      updated_at: "2026-01-02T00:00:00Z", resolved_at: "2026-01-02T00:00:00Z", unread_count: 0 }],
    chat_contacts: [{ id: "contact", tenant_id: "t", owner_id: "agent", whatsapp_id: "5511999999999@s.whatsapp.net", custom_name: "Cliente", metadata: {} }],
    tenant_users: [{ tenant_id: "t", user_id: "agent", active: true, role: "agent", instance_ids: ["n"], department_id: "sales" }],
    whatsapp_instances: [{ id: "n", tenant_id: "t", provider: "baileys" }],
    tenant_config: [{ tenant_id: "t", handoff_binding: "carteira" }],
    channel_connections: [{ id: "conn", tenant_id: "t", channel: "instagram", external_account_id: "account", status: "active", access_token: null }],
    studio_flow_runs: [], studio_flows: [], chat_messages: [],
    tenants: [{ id: "t", slug: "test", active: true }], site_widget_config: [{ tenant_id: "t", enabled: true }],
  })
})

it("início manual reabre para o atendente sem ligar Studio", async () => {
  const result = await createManualConversation({ contactId: "contact" })
  expect(result).toMatchObject({ id: "c", reused: true, reopened: true })
  expect(conv()).toMatchObject({ assigned_to: "agent", ai_handling: false, status: "open" })
  expect(dispatch).not.toHaveBeenCalled()
})
it("formulário reabre para o responsável sem ligar Studio", async () => {
  const response = await submitLead({ json: async () => ({ slug: "test", answers: { phone: "5511999999999", name: "Cliente" } }) } as any)
  expect(response.status).toBe(200)
  expect(conv()).toMatchObject({ assigned_to: "agent", ai_handling: false, status: "open" })
  expect(dispatch).not.toHaveBeenCalled()
})
it("IG sem WhatsApp despacha usando transporte próprio", async () => {
  Object.assign(conv(), { channel: "instagram", instance_id: null })
  db.tables.whatsapp_instances = []
  await processInstagramWebhook(ig({ text: "Olá" }))
  expect(db.tables.chat_messages.some(m => m.whatsapp_msg_id === "new-mid")).toBe(true)
  expect(conv()).toMatchObject({ assigned_to: null, ai_handling: true, status: "open" })
  expect(dispatch).toHaveBeenCalledOnce()
  expect(dispatch.mock.calls[0][0].instance).toEqual({})
})
it("IG sem legenda entrega ao responsável quando não há execução ativa", async () => {
  Object.assign(conv(), { channel: "instagram", instance_id: null })
  await processInstagramWebhook(ig({ attachments: [{ type: "image", payload: {} }] }))
  expect(db.tables.chat_messages.some(m => m.whatsapp_msg_id === "new-mid")).toBe(true)
  expect(conv()).toMatchObject({ assigned_to: "agent", ai_handling: false, status: "open" })
  expect(dispatch).not.toHaveBeenCalled()
})
it("IG transporta o sinal de retorno", async () => {
  Object.assign(conv(), { channel: "instagram", instance_id: null })
  await processInstagramWebhook(ig({ text: "Olá" }))
  expect(dispatch).toHaveBeenCalledOnce()
  expect(dispatch.mock.calls[0][0].signals.isReopened).toBe(true)
})

it("resolução entre dedup e bump passa pela reabertura completa", async () => {
  conv().status = "open"
  expect((await findOrReopenConversation(input)).found).toBe("active")
  conv().status = "resolved"
  await bumpConversationInbound({ tenantId: "t", conversationId: "c", preview: "Olá" })
  expect(conv()).toMatchObject({ status: "open", ai_handling: true, assigned_to: null })
  expect(conv().metadata.attendance_cycle).not.toBe("old-cycle")
  expect(conv().metadata.ai_routed).toBeUndefined()
})
it("mídia sem texto preserva execução esperando entrada", async () => {
  Object.assign(conv(), { status: "open", assigned_to: null, metadata: {}, ai_handling: true })
  db.tables.studio_flow_runs = [{ id: "run", tenant_id: "t", conversation_id: "c", flow_id:"f", variables:{}, status: "waiting" }]
  db.tables.studio_flows=[{id:"f",tenant_id:"t",status:"published",active:true}]
  await routeUnprocessedInbound("t", "c")
  expect(conv()).toMatchObject({ ai_handling: true, assigned_to: null })
  expect(db.tables.studio_flow_runs[0].status).toBe("waiting")
})

it("erro ao consultar execução não autoriza entrega da conversa", async () => {
  Object.assign(conv(), {status:"open",assigned_to:null,metadata:{},ai_handling:true})
  db.errors.studio_flow_runs="offline"
  await expect(routeUnprocessedInbound("t","c")).rejects.toThrow("execução")
  expect(conv().ai_handling).toBe(true)
})

it("reabrir manualmente não concede acesso a conversa restrita", async()=>{
  manualAdmin=false; conv().assigned_to="other"
  await expect(createManualConversation({contactId:"contact"})).rejects.toThrow("Conversa não encontrada")
  expect(conv().status).toBe("resolved"); expect(conv().assigned_to).toBe("other")
})
it("formulário novo aplica responsável existente",async()=>{
  db.tables.chat_conversations=[]
  const response=await submitLead({json:async()=>({slug:"test",answers:{phone:"5511999999999",name:"Cliente"}})} as any)
  expect(response.status).toBe(200)
  expect(conv()).toMatchObject({assigned_to:"agent",ai_handling:false})
})
it("mídia com fluxo pausado entrega ao responsável",async()=>{
  Object.assign(conv(),{status:"open",assigned_to:null,ai_handling:true,metadata:{}})
  db.tables.studio_flow_runs=[{id:"run",tenant_id:"t",conversation_id:"c",flow_id:"f",variables:{},status:"waiting"}]
  db.tables.studio_flows=[{id:"f",tenant_id:"t",status:"published",active:false}]
  await routeUnprocessedInbound("t","c")
  expect(conv()).toMatchObject({assigned_to:"agent",ai_handling:false})
  expect(db.tables.studio_flow_runs[0].status).toBe("done")
})
