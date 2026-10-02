import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const notify = vi.fn(async () => {})
vi.mock("@/lib/notifications", () => ({ createNotification: notify }))

const { claimOutreach, settleOutreach, warnOutreachCapHit,
  OUTREACH_PHONE_WINDOW_HOURS, OUTREACH_TENANT_HOURLY_CAP } = await import("./guard")
const { outreachPhoneKey, outreachKeysForContact } = await import("./phone-key")

beforeEach(() => { db.reset({ outreach_log: [], tenant_users: [] }); notify.mockClear() })

describe("chave do número", () => {
  it("celular BR com e sem o 9º dígito é a mesma pessoa", () => {
    expect(outreachPhoneKey("5547998124471")).toBe("554798124471")
    expect(outreachPhoneKey("554798124471")).toBe("554798124471")
  })
  it("fixo e número de fora passam iguais", () => {
    expect(outreachPhoneKey("554733482290")).toBe("554733482290")
    expect(outreachPhoneKey("14155552671")).toBe("14155552671")
    // 13 dígitos sem o 9 depois do DDD não é celular com 9 — não mexe.
    expect(outreachPhoneKey("5547898124471")).toBe("5547898124471")
  })
  it("chaves do contato: telefone, secundário e JID de número; @lid não é telefone", () => {
    const keys = outreachKeysForContact({
      phone_number: "(47) 99812-4471", phone_secondary: "+55 11 94017-5730", whatsapp_id: "5547998124471@s.whatsapp.net",
    })
    expect(keys.sort()).toEqual(["551140175730", "554798124471"])
    expect(outreachKeysForContact({ whatsapp_id: "12345@lid" })).toEqual([])
  })
})

describe("claimOutreach", () => {
  it("manda a pergunta ao banco com os limites da política", async () => {
    let args: Record<string, unknown> = {}
    db.rpcs.claim_outreach = (a) => { args = a; return { data: [{ log_id: "l1", allowed: true, reason: null, first_cap_hit: false }], error: null } }
    const claim = await claimOutreach({ tenantId: "t", phoneE164: "5547998124471", origin: "site", flowId: "f", sourceConversationId: "c" })
    expect(claim).toEqual({ logId: "l1", allowed: true, reason: null, firstCapHit: false })
    expect(args).toMatchObject({
      p_tenant_id: "t", p_phone_e164: "5547998124471", p_phone_key: "554798124471", p_origin: "site",
      p_flow_id: "f", p_source_conversation_id: "c", p_window_hours: OUTREACH_PHONE_WINDOW_HOURS,
      p_tenant_hourly_cap: OUTREACH_TENANT_HOURLY_CAP,
    })
  })
  it("recusa do banco vem com o motivo e o aviso da 1ª recusa por teto", async () => {
    db.rpcs.claim_outreach = () => ({ data: [{ log_id: "l2", allowed: false, reason: "tenant_hourly_cap", first_cap_hit: true }], error: null })
    expect(await claimOutreach({ tenantId: "t", phoneE164: "5547998124471", origin: "site" }))
      .toEqual({ logId: "l2", allowed: false, reason: "tenant_hourly_cap", firstCapHit: true })
  })
  it("FAIL-CLOSED: sem a função no banco, nada sai", async () => {
    const claim = await claimOutreach({ tenantId: "t", phoneE164: "5547998124471", origin: "site" })
    expect(claim).toEqual({ logId: null, allowed: false, reason: "guard_unavailable", firstCapHit: false })
  })
  it("FAIL-CLOSED: resposta torta do banco também não libera", async () => {
    db.rpcs.claim_outreach = () => ({ data: [{ log_id: "l3", allowed: "yes" }], error: null })
    expect((await claimOutreach({ tenantId: "t", phoneE164: "5547998124471", origin: "site" })).allowed).toBe(false)
  })
  it("motivo desconhecido vira guard_unavailable (nunca um texto livre do banco)", async () => {
    db.rpcs.claim_outreach = () => ({ data: [{ log_id: "l4", allowed: false, reason: "qualquer_coisa", first_cap_hit: false }], error: null })
    expect((await claimOutreach({ tenantId: "t", phoneE164: "5547998124471", origin: "site" })).reason).toBe("guard_unavailable")
  })
  it("número que não é número nem chega ao banco", async () => {
    const spy = vi.fn(() => ({ data: [{ log_id: "x", allowed: true }], error: null }))
    db.rpcs.claim_outreach = spy
    expect((await claimOutreach({ tenantId: "t", phoneE164: "abc", origin: "site" })).allowed).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe("settleOutreach", () => {
  it("acerta só a reserva em aberto, com a conversa", async () => {
    db.reset({ outreach_log: [
      { id: "l1", tenant_id: "t", outcome: "claimed" },
      { id: "l2", tenant_id: "t", outcome: "sent" },
      { id: "l1", tenant_id: "outro", outcome: "claimed" },
    ] })
    await settleOutreach("t", "l1", "sent", { conversationId: "wa" })
    await settleOutreach("t", "l2", "failed")
    const [mine, done, other] = db.tables.outreach_log
    expect(mine).toMatchObject({ outcome: "sent", conversation_id: "wa" })
    expect(mine.settled_at).toBeTruthy()
    expect(done.outcome).toBe("sent")       // já acertada: não vira failed
    expect(other.outcome).toBe("claimed")   // outra empresa: intocada
  })
  it("erro do banco não derruba quem chamou", async () => {
    db.errors.outreach_log = "fora do ar"
    await expect(settleOutreach("t", "l1", "sent")).resolves.toBeUndefined()
  })
})

describe("aviso do disjuntor", () => {
  it("vai para donos e admins ativos, uma vez cada", async () => {
    db.reset({ tenant_users: [
      { tenant_id: "t", user_id: "dono", role: "owner", active: true },
      { tenant_id: "t", user_id: "adm", role: "admin", active: true },
      { tenant_id: "t", user_id: "agente", role: "agent", active: true },
      { tenant_id: "t", user_id: "ex", role: "admin", active: false },
      { tenant_id: "outro", user_id: "x", role: "owner", active: true },
    ] })
    await warnOutreachCapHit("t")
    const recipients = notify.mock.calls.map((c) => (c as unknown as [{ recipientId: string }])[0].recipientId).sort()
    expect(recipients).toEqual(["adm", "dono"])
  })
})
