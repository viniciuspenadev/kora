import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const user = { id: "00000000-0000-4000-8000-000000000001", tenantId: "blue", role: "owner" }
const groupId = "00000000-0000-4000-8000-000000000002"
const agentId = "00000000-0000-4000-8000-000000000003"
const otherId = "00000000-0000-4000-8000-000000000004"
const jid = "120363001@g.us"
const send = vi.fn()
const metadata = vi.fn()
const allowed = vi.fn()
vi.mock("@/auth", () => ({ auth: async () => ({ user }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ sendGroupText: send, fetchGroupMetadata: metadata }) }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: allowed }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { saveGroupAccess, sendGroupText, getGroupParticipants, getGroupAccessRoster, markGroupRead } = await import("./groups")
const { reconcileConversationAccess } = await import("./conversation-access")
const { assignConversation, transferConversation, updateConversationStatus } = await import("./chat")
const member = (id: string, role = "agent") => ({ user_id: id, tenant_id: "blue", role, active: true, instance_ids: ["number-a"], profiles: { full_name: "Equipe" } })
beforeEach(() => {
  vi.clearAllMocks(); user.id = "00000000-0000-4000-8000-000000000001"
  db.reset({
    tenant_users: [member(user.id, "owner"), member(agentId), { ...member(otherId), instance_ids: ["number-b"] }],
    chat_conversations: [{ id: groupId, tenant_id: "blue", is_group: true, group_live_enabled: true,
      group_access_mode: "management", group_jid: jid, instance_id: "number-a", participants: [],
      assigned_to: null, department_id: null, updated_at: "2026-09-23T20:00:00Z" }],
    whatsapp_instances: [{ id: "number-a", tenant_id: "blue", provider: "baileys", status: "connected", settings: { groups_pilot_enabled: true } }],
    chat_messages: [], group_user_state: [], tenant_departments: [],
  })
  send.mockResolvedValue({ messageId: "wa-out" })
  metadata.mockResolvedValue({ id: jid, subject: "Grupo", participants: [{ id: "123456@lid", phoneNumber: "5511987654321@s.whatsapp.net" }] })
  allowed.mockResolvedValue(undefined)
})

describe("grupo: ações reais e revogação de acesso", () => {
  it("envia assinatura do autor no grupo e persiste o snapshot", async () => {
    db.tables.tenant_config = [{ tenant_id: "blue", agent_signature: { enabled: true, departments: {}, agents: {} } }]
    db.tables.profiles = [{ id: user.id, full_name: "Ana" }]
    const result = await sendGroupText(groupId, "Olá")
    expect(send).toHaveBeenCalledWith(jid, "*Ana*\n\nOlá")
    expect(result.content).toBe("*Ana*\n\nOlá")
    expect(db.tables.chat_messages[0].metadata.agent_signature.name).toBe("Ana")
  })
  it("identifica contato cadastrado sem criar nem atualizar registros", async () => {
    db.tables.chat_contacts = [{ id: "contato-1", tenant_id: "blue", whatsapp_id: "5511987654321@s.whatsapp.net", custom_name: "Nome no Kora", push_name: "Nome WhatsApp" }]
    const { participants } = await getGroupParticipants(groupId)
    expect(participants[0].contact).toEqual({ id: "contato-1", name: "Nome no Kora" })
    expect(participants[0].contactAmbiguous).toBe(false)
    expect(db.tables.chat_contacts).toHaveLength(1)
    expect(db.writes).toHaveLength(0)
  })
  it("reconhece a identidade secundária de um contato mesclado", async () => {
    db.tables.chat_contacts = [{ id: "merged", tenant_id: "blue", whatsapp_id: "5511988887777@s.whatsapp.net", custom_name: "Contato mesclado" }]
    db.tables.contact_identities = [{ tenant_id: "blue", channel: "whatsapp", external_id: "5511987654321@s.whatsapp.net", contact_id: "merged" }]
    expect((await getGroupParticipants(groupId)).participants[0].contact?.id).toBe("merged")
  })
  it("reconhece telefone exato e não escolhe arbitrariamente entre duplicados", async () => {
    db.tables.chat_contacts = [{ id: "phone", tenant_id: "blue", phone_number: "5511987654321", custom_name: "Cadastro manual" }]
    expect((await getGroupParticipants(groupId)).participants[0].contact?.id).toBe("phone")
    db.tables.chat_contacts.push({ id: "duplicate", tenant_id: "blue", phone_number: "5511987654321" })
    expect((await getGroupParticipants(groupId)).participants[0]).toMatchObject({ contact: null, contactAmbiguous: true })
  })
  it("não revela cadastro de outro tenant nem contato inacessível ao agente", async () => {
    db.tables.chat_contacts = [{ id: "foreign", tenant_id: "other", whatsapp_id: "5511987654321@s.whatsapp.net", custom_name: "Outra empresa" }]
    expect((await getGroupParticipants(groupId)).participants[0].contact).toBeNull()
    db.tables.chat_contacts.push({ id: "private", tenant_id: "blue", whatsapp_id: "5511987654321@s.whatsapp.net", custom_name: "Carteira privada" })
    db.tables.chat_conversations[0].group_access_mode = "number_team"; user.id = agentId
    expect((await getGroupParticipants(groupId)).participants[0].contact).toBeNull()
    db.tables.chat_contacts[1].owner_id = agentId
    expect((await getGroupParticipants(groupId)).participants[0].contact?.id).toBe("private")
  })
  it("não tenta adivinhar nono dígito nem converter LID em telefone", async () => {
    db.tables.chat_contacts = [{ id: "similar", tenant_id: "blue", whatsapp_id: "551187654321@s.whatsapp.net" }, { id: "opaque", tenant_id: "blue", phone_number: "123456" }]
    expect((await getGroupParticipants(groupId)).participants[0].contact).toBeNull()
    metadata.mockResolvedValue({ id: jid, participants: [{ id: "123456@lid" }] })
    expect((await getGroupParticipants(groupId)).participants[0].contact).toBeNull()
  })
  it("falha de consulta não é apresentada como contato não cadastrado", async () => {
    db.errors.contact_identities = "indisponível"
    await expect(getGroupParticipants(groupId)).rejects.toThrow("conferir os contatos")
  })
  it("ações de atendimento individual não transferem nem concluem grupos", async () => {
    await expect(assignConversation(groupId, agentId)).rejects.toThrow("Conversa não encontrada")
    await expect(transferConversation(groupId, { mode: "agent", agentId })).rejects.toThrow("Conversa não encontrada")
    await expect(updateConversationStatus(groupId, "resolved")).rejects.toThrow("Conversa não encontrada")
    expect(db.writes).toHaveLength(0)
    expect(db.tables.chat_conversations[0].group_access_mode).toBe("management")
  })
  it("mantém o JID do grupo e a autoria ao enviar", async () => {
    await sendGroupText(groupId, "Olá")
    expect(send).toHaveBeenCalledWith(jid, "Olá")
    expect(db.tables.chat_messages).toMatchObject([{ conversation_id: groupId, tenant_id: "blue", sender_id: user.id, whatsapp_msg_id: "wa-out" }])
  })
  it("barra envio após revogação durante a consulta da conta", async () => {
    user.id = agentId
    Object.assign(db.tables.chat_conversations[0], { group_access_mode: "selected", participants: [agentId] })
    allowed.mockImplementation(async () => { db.tables.chat_conversations[0].participants = [] })
    await expect(sendGroupText(groupId, "Olá")).rejects.toThrow("sem acesso")
    expect(send).not.toHaveBeenCalled()
  })
  it("concede e revoga mantendo servidor e reconciliação da tela em acordo", async () => {
    await saveGroupAccess(groupId, { mode: "selected", userIds: [agentId] })
    user.id = agentId
    expect((await reconcileConversationAccess([groupId])).visibleIds).toEqual([groupId])
    await markGroupRead(groupId)
    expect(db.tables.group_user_state[0]).toMatchObject({ conversation_id: groupId, user_id: agentId })
    user.id = db.tables.tenant_users[0].user_id
    await saveGroupAccess(groupId, { mode: "management" })
    user.id = agentId
    expect((await reconcileConversationAccess([groupId])).visibleIds).toEqual([])
    await expect(sendGroupText(groupId, "Bloqueado")).rejects.toThrow("sem acesso")
    await expect(getGroupParticipants(groupId)).rejects.toThrow("sem acesso")
    await expect(markGroupRead(groupId)).rejects.toThrow("sem acesso")
    expect(send).not.toHaveBeenCalled()
  })
  it("agente autorizado não pode ampliar as permissões", async () => {
    db.tables.chat_conversations[0].group_access_mode = "number_team"; user.id = agentId
    await expect(saveGroupAccess(groupId, { mode: "number_team" })).rejects.toThrow("gestão")
    await expect(getGroupAccessRoster(groupId)).rejects.toThrow("gestão")
    expect(db.writes).toHaveLength(0)
  })
  it("seleção não permite convidar atendente de outro número", async () => {
    await expect(saveGroupAccess(groupId, { mode: "selected", userIds: [otherId] })).rejects.toThrow("não atende este número")
    expect(db.writes).toHaveLength(0)
  })
  it("identidade LID nunca é transformada em telefone ou contato", async () => {
    metadata.mockResolvedValue({ id: jid, participants: [{ id: "123456@lid" }] })
    expect((await getGroupParticipants(groupId)).participants).toEqual([{ jid: "123456@lid", phone: null, isAdmin: false, contact: null, contactAmbiguous: false }])
    expect(db.writes).toHaveLength(0)
  })
  it("descarta participantes carregados após revogação", async () => {
    user.id = agentId; db.tables.chat_conversations[0].group_access_mode = "number_team"
    metadata.mockImplementation(async () => { db.tables.tenant_users[1].active = false; return { id: jid, participants: [] } })
    await expect(getGroupParticipants(groupId)).rejects.toThrow("não está ativo")
  })
  it("mudança concorrente de acesso não é sobrescrita silenciosamente", async () => {
    db.beforeWrite = () => { db.tables.chat_conversations[0].updated_at = "2026-09-23T21:00:00Z" }
    await expect(saveGroupAccess(groupId, { mode: "number_team" })).rejects.toThrow("atualizado")
    expect(db.tables.chat_conversations[0].group_access_mode).toBe("management")
  })
  it("não envia com piloto desligado", async () => {
    db.tables.whatsapp_instances[0].settings.groups_pilot_enabled = false
    await expect(sendGroupText(groupId, "Olá")).rejects.toThrow("não está disponível")
    expect(send).not.toHaveBeenCalled()
  })
  it("isola tenants mesmo para gestão", async () => {
    db.tables.chat_conversations[0].tenant_id = "outro"
    await expect(getGroupParticipants(groupId)).rejects.toThrow("sem acesso")
    await expect(sendGroupText(groupId, "Olá")).rejects.toThrow("sem acesso")
    expect(metadata).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
  it.each([null, { mode: "invalid" }, { mode: "selected", userIds: "not-array" }, { mode: "selected", userIds: [otherId], departmentId: 42 }])("rejeita entrada inválida sem escrita: %j", async input => {
    await expect(saveGroupAccess(groupId, input as Parameters<typeof saveGroupAccess>[1])).rejects.toThrow()
    expect(db.writes).toHaveLength(0)
  })
})
