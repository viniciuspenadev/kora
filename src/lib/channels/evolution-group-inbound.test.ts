import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { EvolutionMessageData } from "@/types/chat"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const fetchGroupMetadata = vi.fn(async () => ({ id: "120363001@g.us", subject: "Equipe Blue", participants: [] }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ fetchGroupMetadata }) }))
const { recordEvolutionGroupMessage } = await import("./evolution-group-inbound")

const groupJid = "120363001@g.us"
const timestamp = 1780000000
const extracted = { contentType: "text", content: "Olá, equipe", mediaMimeType: null, mediaFileName: null }
const instance = (id: string) => ({ id, tenant_id: "blue", provider: "baileys",
  evolution_url: "https://evolution.test", evolution_key: "test", instance_name: id })
const inbound = (id = "wa-1") => ({
  key: { id, remoteJid: groupJid, participant: "123456789@lid", fromMe: false },
  pushName: "Pessoa no grupo", messageTimestamp: timestamp,
  message: { conversation: "Olá, equipe" },
}) as EvolutionMessageData

beforeEach(() => {
  vi.clearAllMocks()
  db.reset({ chat_conversations: [], chat_messages: [], chat_contacts: [] })
})

describe("entrada isolada de grupo Evolution", () => {
  it("cria o grupo só para gestão e registra o remetente sem criar contato ou fluxo", async () => {
    await recordEvolutionGroupMessage(instance("blue-number"), inbound(), extracted)
    expect(db.tables.chat_conversations).toHaveLength(1)
    expect(db.tables.chat_conversations[0]).toMatchObject({ tenant_id: "blue", instance_id: "blue-number",
      is_group: true, group_jid: groupJid, group_name: "Equipe Blue", group_access_mode: "management",
      group_live_enabled: true, contact_id: null, pipeline_id: null, stage_id: null,
      last_message_preview: "Pessoa no grupo: Olá, equipe", last_message_dir: "in" })
    expect(db.tables.chat_messages[0]).toMatchObject({ tenant_id: "blue", sender_type: "contact",
      group_participant_jid: "123456789@lid", whatsapp_msg_id: "wa-1",
      metadata: { group_push_name: "Pessoa no grupo" } })
    expect(db.tables.chat_contacts).toHaveLength(0)
  })

  it("mantém fios separados por instância mesmo no mesmo grupo", async () => {
    await recordEvolutionGroupMessage(instance("blue-number"), inbound(), extracted)
    await recordEvolutionGroupMessage(instance("second-number"), inbound(), extracted)
    expect(db.tables.chat_conversations.map(c => c.instance_id)).toEqual(["blue-number", "second-number"])
    expect(new Set(db.tables.chat_messages.map(m => m.conversation_id)).size).toBe(2)
    expect(db.tables.chat_contacts).toHaveLength(0)
  })

  it("prefere o fio ativo a um histórico resolvido do mesmo JID", async () => {
    db.tables.chat_conversations.push({ id: "resolved", tenant_id: "blue", instance_id: "blue-number",
      is_group: true, group_jid: groupJid, status: "resolved", group_live_enabled: false })
    db.tables.chat_conversations.push({ id: "active", tenant_id: "blue", instance_id: "blue-number",
      is_group: true, group_jid: groupJid, status: "open", group_live_enabled: true })
    await recordEvolutionGroupMessage(instance("blue-number"), inbound(), extracted)
    expect(db.tables.chat_messages[0].conversation_id).toBe("active")
    expect(db.tables.chat_conversations).toHaveLength(2)
    expect(fetchGroupMetadata).not.toHaveBeenCalled()
  })
})
