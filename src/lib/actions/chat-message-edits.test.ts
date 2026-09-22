import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), scope: vi.fn(), canView: vi.fn(), allowed: vi.fn(), edit: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock("@/lib/visibility", () => ({ getViewerScope: mocks.scope, canViewConversation: mocks.canView }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: mocks.allowed }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ editText: mocks.edit }) }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }))
import { editSentMessage } from "./chat-message-edits"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const input = { messageId: id(1), operationId: id(2), previousContent: "antes", previousEditedAt: null, text: "depois" }
let message: Record<string, unknown>, conversation: Record<string, unknown>, operationStatus: string
const filters: Array<[string, string, unknown]> = []
beforeEach(() => {
  vi.clearAllMocks(); filters.length = 0; operationStatus = "pending"
  message = { id: id(1), conversation_id: id(3), sender_id: id(4), sender_type: "agent", content: "antes", edited_at: null,
    status: "sent", content_type: "text", created_at: new Date(Date.now() - 60_000).toISOString(), whatsapp_msg_id: "wa", is_private_note: false, metadata: {} }
  conversation = { id: id(3), instance_id: id(6), channel: "whatsapp", status: "open", is_group: false }
  mocks.scope.mockResolvedValue({ tenantId: id(5), userId: id(4) }); mocks.canView.mockReturnValue(true)
  mocks.allowed.mockResolvedValue(undefined); mocks.edit.mockResolvedValue({ editedAt: new Date().toISOString() })
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "reserve_chat_message_edit") return { data: { acquired: true }, error: null }
    operationStatus = "confirmed"; message = { ...message, content: "depois", edited_at: new Date().toISOString() }
    return { data: { status: "confirmed" }, error: null }
  })
  mocks.from.mockImplementation((table: string) => {
    let update: Record<string, unknown> | undefined
    const finish = () => {
      if (update && table === "chat_message_edits" && operationStatus === "pending") operationStatus = String(update.status)
      return { data: table === "chat_messages" ? { ...message } : table === "chat_conversations" ? { ...conversation }
        : table === "whatsapp_instances" ? { provider: "baileys" } : { status: operationStatus }, error: null }
    }
    const query = { select: () => query, update: (value: Record<string, unknown>) => { update = value; return query },
      eq: (column: string, value: unknown) => { filters.push([table, column, value]); return query },
      maybeSingle: async () => finish(), then: (resolve: (value: ReturnType<typeof finish>) => unknown) => Promise.resolve(finish()).then(resolve) }
    return query
  })
})

describe("edit server orchestration", () => {
  it("scopes every table and confirms before returning the patched content", async () => {
    expect(await editSentMessage(input)).toMatchObject({ message: { id: id(1), content: "depois" } })
    for (const table of ["chat_messages", "chat_conversations", "whatsapp_instances", "chat_message_edits"])
      expect(filters).toContainEqual([table, "tenant_id", id(5)])
    expect(mocks.edit).toHaveBeenCalledTimes(1)
  })
  it("denies revoked membership", async () => {
    mocks.scope.mockRejectedValue(new Error("inactive"))
    expect(await editSentMessage(input)).toHaveProperty("error"); expect(mocks.edit).not.toHaveBeenCalled()
  })
  it("denies conversation outside visibility", async () => {
    mocks.canView.mockReturnValue(false)
    expect(await editSentMessage(input)).toHaveProperty("error"); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rechecks visibility after reservation", async () => {
    mocks.canView.mockReturnValueOnce(true).mockReturnValue(false)
    expect(await editSentMessage(input)).toHaveProperty("error"); expect(mocks.edit).not.toHaveBeenCalled()
    expect(operationStatus).toBe("failed")
  })
  it("rejects other authors even when conversation is visible", async () => {
    message.sender_id = id(99)
    expect(await editSentMessage(input)).toHaveProperty("error"); expect(mocks.edit).not.toHaveBeenCalled()
  })
  it("does not send when reservation fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "missing_migration" } })
    expect(await editSentMessage(input)).toHaveProperty("error"); expect(mocks.edit).not.toHaveBeenCalled()
  })
  it("duplicate request checks status without retrying provider", async () => {
    mocks.rpc.mockResolvedValue({ data: { acquired: false }, error: null })
    expect(await editSentMessage(input)).toMatchObject({ uncertain: true }); expect(mocks.edit).not.toHaveBeenCalled()
  })
  it("timeout remains uncertain without leaking provider error", async () => {
    mocks.edit.mockRejectedValue(new Error("SECRET customer payload"))
    const result = await editSentMessage(input)
    expect(result).toMatchObject({ uncertain: true }); expect(JSON.stringify(result)).not.toContain("SECRET")
    expect(operationStatus).toBe("uncertain"); expect(mocks.edit).toHaveBeenCalledTimes(1)
  })
  it("webhook confirmation wins over a failed HTTP response", async () => {
    mocks.edit.mockImplementation(async () => { operationStatus = "confirmed"; message.content = "depois"; throw new Error("late error") })
    expect(await editSentMessage(input)).toMatchObject({ message: { content: "depois" } })
    expect(operationStatus).toBe("confirmed")
  })
})
