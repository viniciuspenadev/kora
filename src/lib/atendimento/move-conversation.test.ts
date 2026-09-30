import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>, writes: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  failWrite: false, failHistory: false, race: false, visible: true,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/visibility", () => ({ canViewConversation: () => db.visible }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from(table: string) {
  const filters: Array<[string, unknown]> = []; let patch: Record<string, unknown> | undefined
  let insert: Record<string, unknown> | undefined
  const run = () => {
    if (insert) { db.writes.push({ table, patch: insert }); return { data: null, error: db.failHistory ? { message: "history unavailable" } : null } }
    if (patch && db.race) db.rows.chat_conversations[0].updated_at = "concurrent"
    const row = db.rows[table]?.find(r => filters.every(([k, v]) => r[k] === v))
    if (patch && db.failWrite) return { data: null, error: { message: "write failed" } }
    if (row && patch) { db.writes.push({ table, patch }); Object.assign(row, patch) }
    return { data: row ? { ...row } : null, error: null }
  }
  const builder = { select: () => builder, eq: (k: string, v: unknown) => { filters.push([k, v]); return builder },
    update: (p: Record<string, unknown>) => { patch = p; return builder }, insert: (p: Record<string, unknown>) => { insert = p; return builder },
    maybeSingle: async () => run(), then: (resolve: (r: unknown) => void) => Promise.resolve(run()).then(resolve) }
  return builder
} } }))
const { moveAttendanceConversation } = await import("./move-conversation")
const input = { tenantId: "t1", conversationId: "c1", stageId: "s2", position: 2, scope: {} as never }
beforeEach(() => {
  db.rows = {
    chat_conversations: [{ id: "c1", tenant_id: "t1", pipeline_id: "p1", stage_id: "s1", updated_at: "old", archived_at: null, is_group: false,
      assigned_to: "a1", department_id: "d1", status: "resolved", follow_up_at: "tomorrow", instance_id: "wa1", active_deal_id: "deal1", lost_reason: "old reason" }],
    pipeline_stages: [{ id: "s2", tenant_id: "t1", pipeline_id: "p2", name: "Boas-vindas", show_in_kanban: true, is_triage: false, is_won: false, is_lost: false }],
    pipelines: [{ id: "p2", tenant_id: "t1", name: "Pós-venda", active: true }],
  }; db.writes = []; db.failWrite = false; db.failHistory = false; db.race = false; db.visible = true
})
describe("movimentação do atendimento", () => {
  it("troca quadro e etapa juntos preservando atendimento, canal, lembrete e negócio", async () => {
    const result = await moveAttendanceConversation(input)
    expect(db.rows.chat_conversations[0]).toMatchObject({ pipeline_id: "p2", stage_id: "s2", status: "resolved", assigned_to: "a1", department_id: "d1", instance_id: "wa1", follow_up_at: "tomorrow", active_deal_id: "deal1", lost_reason: null })
    expect(result.patch).toHaveProperty("stage_entered_at")
    expect(db.writes.map(w => w.table)).toEqual(["chat_conversations", "chat_messages"])
    expect(db.writes[1].patch).toMatchObject({ is_private_note: true, metadata: { from_pipeline_id: "p1", from_stage_id: "s1", to_pipeline_id: "p2", to_stage_id: "s2" } })
  })
  it("reordenação não reinicia idade nem repete histórico ou resultado legado", async () => {
    Object.assign(db.rows.chat_conversations[0], { pipeline_id: "p2", stage_id: "s2", stage_entered_at: "yesterday", won_at: "won" })
    await moveAttendanceConversation(input)
    expect(db.rows.chat_conversations[0]).toMatchObject({ stage_entered_at: "yesterday", won_at: "won" })
    expect(db.writes).toHaveLength(1)
  })
  it("nem uma etapa legada Ganho promove contato ou escreve negócio", async () => {
    db.rows.pipeline_stages[0].is_won = true
    await moveAttendanceConversation(input)
    expect(db.writes.every(w => ["chat_conversations", "chat_messages"].includes(w.table))).toBe(true)
    expect(String(db.writes[1].patch.content)).not.toContain("Negócio ganho")
  })
  it.each(["tenant", "visibility", "pipeline", "hidden", "archived"])("recusa destino/acesso inválido: %s", async kind => {
    if (kind === "tenant") db.rows.pipeline_stages[0].tenant_id = "t2"
    if (kind === "visibility") db.visible = false
    if (kind === "pipeline") db.rows.pipelines[0].active = false
    if (kind === "hidden") db.rows.pipeline_stages[0].show_in_kanban = false
    if (kind === "archived") db.rows.chat_conversations[0].archived_at = "yesterday"
    await expect(moveAttendanceConversation(input)).rejects.toThrow()
    expect(db.writes).toHaveLength(0)
  })
  it("falha de persistência não gera histórico ou falso sucesso", async () => {
    db.failWrite = true
    await expect(moveAttendanceConversation(input)).rejects.toThrow("Não foi possível mover")
    expect(db.writes).toHaveLength(0)
  })
  it("rejeita revisão obsoleta antes de escrever", async () => {
    await expect(moveAttendanceConversation({ ...input, expectedUpdatedAt: "stale" })).rejects.toThrow("atualizada")
    expect(db.writes).toHaveLength(0)
  })
  it("concorrência entre leitura e escrita não sobrescreve outra operação", async () => {
    db.race = true
    await expect(moveAttendanceConversation(input)).rejects.toThrow("mudou")
    expect(db.writes).toHaveLength(0)
  })
  it("falha do histórico retorna aviso sem esconder a movimentação persistida", async () => {
    db.failHistory = true
    const result = await moveAttendanceConversation(input)
    expect(result.warning).toContain("histórico")
    expect(db.rows.chat_conversations[0].stage_id).toBe("s2")
  })
})
