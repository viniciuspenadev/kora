import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Envio direto ao armazenamento: as duas pontas do servidor (autorizar antes, conferir depois).
vi.mock("server-only", () => ({}))
const TENANT = "0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5", OTHER_TENANT = "11111111-1111-4111-8111-111111111111"
const CONV = "22222222-2222-4222-8222-222222222222", OTHER_CONV = "33333333-3333-4333-8333-333333333333"
// A faxina roda no máximo uma vez por hora por conversa: cada teste dela usa uma conversa própria.
const SWEEP_A = "44444444-4444-4444-8444-444444444444", SWEEP_B = "55555555-5555-4555-8555-555555555555"
const MB = 1024 * 1024

const db = new MemoryDb(), sendMedia = vi.fn(), transcode = vi.fn()
const user = { id: "agent", tenantId: TENANT, role: "agent" }
let canView = true
vi.mock("@/auth", () => ({ auth: async () => ({ user }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/visibility", () => ({ getViewerScope: async () => ({ tenantId: user.tenantId, userId: user.id, isAdmin: false }), canViewConversation: () => canView }))
vi.mock("@/lib/atendimento/attendance-claim", () => ({ prepareHumanReply: vi.fn(), claimAfterAcceptedReply: vi.fn() }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ providerName: "baileys", sendMedia, sendVoiceNote: vi.fn(), sendText: vi.fn() }) }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: vi.fn(), checkTenantStatus: vi.fn(), atendimentoBloqueado: () => false }))
vi.mock("@/lib/contacts/identity", () => ({ adoptRecipientJid: vi.fn() }))
vi.mock("@/lib/media/transcode", () => ({ transcodeForMeta: transcode }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { authorizeChatUpload, sendUploadedChatMedia } = await import("./chat")

// Armazenamento de mentira: o que "subiu" fica em `stored` (caminho → tamanho, tipo, começo do arquivo).
interface Stored { size: number; contentType: string; head: Uint8Array }
const stored = new Map<string, Stored>()
const bucket = {
  createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { token: `tok:${path}`, path, signedUrl: "https://test.invalid/up" }, error: null })),
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://test.invalid/${path}` }, error: null })),
  info: vi.fn(async (path: string) => stored.has(path)
    ? { data: { size: stored.get(path)!.size, contentType: stored.get(path)!.contentType }, error: null }
    : { data: null, error: { message: "not found" } }),
  remove: vi.fn(async (paths: string[]) => { paths.forEach((p) => stored.delete(p)); return { error: null } }),
  upload: vi.fn(async (path: string, buf: Uint8Array, o: { contentType: string }) => { stored.set(path, { size: buf.length, contentType: o.contentType, head: buf }); return { error: null } }),
  download: vi.fn(async (path: string) => ({ data: new Blob([new Uint8Array(stored.get(path)!.head)]), error: null })),
  list: vi.fn(async (folder: string) => ({ data: [...stored.keys()].filter((p) => p.startsWith(`${folder}/`)).map((p) => ({ name: p.slice(folder.length + 1) })), error: null })),
}
db.storage = { from: () => bucket } as never
vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  const hit = stored.get(decodeURIComponent(new URL(url).pathname.slice(1)))
  return hit ? new Response(new Uint8Array(hit.head), { status: 206 }) : new Response(null, { status: 404 })
}))

const text = (s: string) => new TextEncoder().encode(s)
const PDF = text("%PDF-1.7 fixture"), MP4 = Uint8Array.from([0, 0, 0, 0x20, ...text("ftypisom"), 0, 0, 0, 0]), EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0])
const pathAt = (name: string, at = Date.now(), conv = CONV, tenant = TENANT) => `${tenant}/${conv}/u_${at}_abcd1234_${name}`
const put = (path: string, head: Uint8Array, contentType: string, size = head.length) => { stored.set(path, { size, contentType, head }); return path }

beforeEach(() => {
  vi.clearAllMocks(); stored.clear(); canView = true
  const conv = (id: string, tenant: string) => ({ id, tenant_id: tenant, is_group: false, contact_id: "contact", instance_id: "number", assigned_to: "agent",
    participants: [], department_id: null, channel: "whatsapp", last_inbound_at: new Date().toISOString(),
    chat_contacts: { phone_number: "5511999999999", bsuid: null }, whatsapp_instances: { provider: "baileys" } })
  db.reset({ tenant_config: [{ tenant_id: TENANT, agent_signature: { enabled: false, departments: {}, agents: {} } }], profiles: [{ id: "agent", full_name: "Ana" }],
    chat_conversations: [conv(CONV, TENANT), conv(OTHER_CONV, OTHER_TENANT), conv(SWEEP_A, TENANT), conv(SWEEP_B, TENANT)],
    whatsapp_instances: [{ id: "number", tenant_id: TENANT, provider: "baileys" }], chat_messages: [] })
  sendMedia.mockResolvedValue({ messageId: "wa-media" })
})

describe("authorizeChatUpload — antes de subir", () => {
  it("autoriza UM caminho dentro da pasta da conversa, com o tipo decidido pelo servidor", async () => {
    const r = await authorizeChatUpload(CONV, { name: "Orçamento nº 12.pdf", size: 3 * MB, type: "application/pdf" })
    expect(r).toMatchObject({ ok: true, kind: "document", bucket: "chat-attachments", contentType: "application/pdf" })
    if (!("ok" in r)) throw new Error("recusou")
    expect(r.path).toMatch(new RegExp(`^${TENANT}/${CONV}/u_\\d{13}_[a-f0-9]{8}_Or_amento_n__12\\.pdf$`))
    expect(r.endpoint).toMatch(/\/storage\/v1\/upload\/resumable\/sign$/)
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(r.path)
  })

  it("recusa o que a regra única recusa — sem emitir autorização", async () => {
    expect(await authorizeChatUpload(CONV, { name: "virus.exe", size: 1000, type: "application/pdf" })).toMatchObject({ error: expect.stringContaining("segurança") })
    expect(await authorizeChatUpload(CONV, { name: "vazio.pdf", size: 0, type: "application/pdf" })).toEqual({ error: "Arquivo vazio." })
    expect(await authorizeChatUpload(CONV, { name: "filme.mp4", size: 60 * MB, type: "video/mp4", asDocument: true })).toMatchObject({ error: expect.stringContaining("máximo") })
    expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it("vídeo acima do limite: oferece documento; como documento, autoriza", async () => {
    const video = { name: "obra.mp4", size: 24 * MB, type: "video/mp4" }
    expect(await authorizeChatUpload(CONV, video)).toMatchObject({ offerDocument: true })
    expect(await authorizeChatUpload(CONV, { ...video, asDocument: true })).toMatchObject({ ok: true, kind: "document", contentType: "video/mp4" })
  })

  it("conversa de outro cliente, fora da visão do atendente ou com janela fechada: nada é emitido", async () => {
    expect(await authorizeChatUpload(OTHER_CONV, { name: "a.pdf", size: 1000, type: "application/pdf" })).toEqual({ error: "Conversa não encontrada." })
    expect(await authorizeChatUpload("../outra", { name: "a.pdf", size: 1000, type: "application/pdf" })).toEqual({ error: "Conversa não encontrada." })
    canView = false
    expect(await authorizeChatUpload(CONV, { name: "a.pdf", size: 1000, type: "application/pdf" })).toMatchObject({ error: expect.stringContaining("Sem permissão") })
    canView = true
    db.tables.chat_conversations[0].last_inbound_at = new Date(Date.now() - 3 * 24 * 3600_000).toISOString()
    db.tables.chat_conversations[0].whatsapp_instances.provider = "meta_cloud"
    expect(await authorizeChatUpload(CONV, { name: "a.pdf", size: 1000, type: "application/pdf" })).toMatchObject({ error: expect.stringContaining("Janela") })
    expect(bucket.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe("faxina de envios abandonados", () => {
  const HOURS = 3600_000
  const file = { name: "a.pdf", size: 1000, type: "application/pdf" }

  it("apaga só o que é abandonado, antigo e sem mensagem em NENHUMA conversa do cliente", async () => {
    const abandoned = put(pathAt("abandonado.pdf", Date.now() - 4 * HOURS, SWEEP_A), PDF, "application/pdf")
    const moved     = put(pathAt("movido.pdf", Date.now() - 4 * HOURS, SWEEP_A), PDF, "application/pdf")
    const recent    = put(pathAt("recente.pdf", Date.now() - 10 * 60_000, SWEEP_A), PDF, "application/pdf")
    const received  = put(`${TENANT}/${SWEEP_A}/1700000000000_recebido-do-cliente.pdf`, PDF, "application/pdf")
    // A mensagem que usa `moved` hoje mora em OUTRA conversa do mesmo cliente.
    db.tables.chat_messages.push({ id: "m1", tenant_id: TENANT, conversation_id: CONV, metadata: { storage_path: moved } })
    await authorizeChatUpload(SWEEP_A, file)
    await vi.waitFor(() => expect(bucket.remove).toHaveBeenCalled())
    expect(bucket.remove).toHaveBeenCalledTimes(1)
    expect(bucket.remove).toHaveBeenCalledWith([abandoned])
    expect([moved, recent, received].every((path) => stored.has(path))).toBe(true)
  })

  it("se a consulta das mensagens falhar, não apaga nada", async () => {
    const abandoned = put(pathAt("abandonado.pdf", Date.now() - 4 * HOURS, SWEEP_B), PDF, "application/pdf")
    db.errors.chat_messages = "timeout"
    await authorizeChatUpload(SWEEP_B, file)
    await vi.waitFor(() => expect(bucket.list).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(bucket.remove).not.toHaveBeenCalled()
    expect(stored.has(abandoned)).toBe(true)
  })
})

describe("sendUploadedChatMedia — depois de subir", () => {
  it("confere o arquivo guardado e entrega; a mensagem aponta para o caminho", async () => {
    const path = put(pathAt("contrato.pdf"), PDF, "application/pdf", 3 * MB)
    const r = await sendUploadedChatMedia(CONV, { path, name: "contrato.pdf", caption: "Segue o contrato" })
    expect(r).toMatchObject({ id: expect.any(String), content: "Segue o contrato" })
    expect(sendMedia).toHaveBeenCalledWith("5511999999999", expect.stringContaining(path), "document", "Segue o contrato", "contrato.pdf", undefined)
    expect(db.tables.chat_messages[0]).toMatchObject({ content_type: "document", media_mime_type: "application/pdf", status: "sent", metadata: { storage_path: path, file_size: 3 * MB } })
    expect(stored.has(path)).toBe(true)
    // Só o começo do arquivo foi lido — o arquivo inteiro nunca volta ao servidor.
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ headers: { Range: "bytes=0-4095" } })
    expect(bucket.download).not.toHaveBeenCalled()
  })

  it("um caminho vira no máximo UMA mensagem", async () => {
    const path = put(pathAt("foto.pdf"), PDF, "application/pdf")
    await sendUploadedChatMedia(CONV, { path, name: "foto.pdf" })
    expect(await sendUploadedChatMedia(CONV, { path, name: "foto.pdf" })).toEqual({ error: "Este arquivo já foi enviado." })
    expect(sendMedia).toHaveBeenCalledTimes(1)
    expect(stored.has(path)).toBe(true) // a mensagem enviada continua com o arquivo
  })

  it("caminho que não é desta conversa deste cliente não é tocado", async () => {
    const foreign = put(pathAt("a.pdf", Date.now(), OTHER_CONV, OTHER_TENANT), PDF, "application/pdf")
    const legacy = put(`${TENANT}/${CONV}/1700000000000_antigo.pdf`, PDF, "application/pdf")
    for (const path of [foreign, legacy, `${TENANT}/${CONV}/../${OTHER_CONV}/u_${Date.now()}_abcd1234_a.pdf`, `${TENANT}/${CONV}/u_${Date.now()}_abcd1234_a/b.pdf`]) {
      expect(await sendUploadedChatMedia(CONV, { path, name: "a.pdf" })).toEqual({ error: "Arquivo não encontrado. Envie de novo." })
    }
    expect(bucket.remove).not.toHaveBeenCalled()
    expect(bucket.info).not.toHaveBeenCalled()
    expect(sendMedia).not.toHaveBeenCalled()
  })

  it("recusa e APAGA: prazo vencido, conteúdo que não bate, tipo trocado, tamanho acima do aceito, nome trocado", async () => {
    const cases: [string, string, Parameters<typeof sendUploadedChatMedia>[1], RegExp][] = [
      ["prazo", put(pathAt("velho.pdf", Date.now() - 31 * 60_000), PDF, "application/pdf"), { path: "", name: "velho.pdf" }, /expirou/],
      ["programa renomeado", put(pathAt("boleto.pdf"), EXE, "application/pdf"), { path: "", name: "boleto.pdf" }, /segurança/],
      ["ZIP que não é ZIP", put(pathAt("fotos.zip"), PDF, "application/zip"), { path: "", name: "fotos.zip" }, /não corresponde/],
      ["página disfarçada de XML", put(pathAt("nfe.xml"), text("<html><script>alert(1)</script></html>"), "text/xml"), { path: "", name: "nfe.xml" }, /segurança/],
      ["guardado com tipo não autorizado", put(pathAt("pagina.pdf"), PDF, "text/html"), { path: "", name: "pagina.pdf" }, /não corresponde/],
      ["vídeo maior que o declarado", put(pathAt("obra.mp4"), MP4, "video/mp4", 24 * MB), { path: "", name: "obra.mp4" }, /documento/],
      ["nome trocado na confirmação", put(pathAt("planilha.pdf"), PDF, "application/pdf"), { path: "", name: "planilha.xlsx" }, /não corresponde ao autorizado/],
    ]
    for (const [label, path, input, message] of cases) {
      const r = await sendUploadedChatMedia(CONV, { ...input, path })
      expect(r, label).toMatchObject({ error: expect.stringMatching(message) })
      expect(stored.has(path), label).toBe(false)
    }
    expect(sendMedia).not.toHaveBeenCalled()
    expect(db.tables.chat_messages).toHaveLength(0)
  })

  it("o que já ia antes continua indo: PNG salvo como .jpg e relatório HTML exportado como .xls", async () => {
    const png = put(pathAt("print.jpg"), Uint8Array.from([0x89, ...text("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]), "image/jpeg")
    expect(await sendUploadedChatMedia(CONV, { path: png, name: "print.jpg" })).toMatchObject({ id: expect.any(String) })
    const xls = put(pathAt("relatorio.xls"), text("<html><table><tr><td>Total</td></tr></table></html>"), "application/vnd.ms-excel")
    expect(await sendUploadedChatMedia(CONV, { path: xls, name: "relatorio.xls" })).toMatchObject({ id: expect.any(String) })
    expect(sendMedia.mock.calls.map((call) => call[2])).toEqual(["image", "document"])
  })

  it("vídeo acima do limite passa quando a pessoa escolheu documento", async () => {
    const path = put(pathAt("obra.mp4"), MP4, "video/mp4", 24 * MB)
    expect(await sendUploadedChatMedia(CONV, { path, name: "obra.mp4", asDocument: true })).toMatchObject({ id: expect.any(String) })
    expect(sendMedia).toHaveBeenCalledWith("5511999999999", expect.any(String), "document", undefined, "obra.mp4", undefined)
  })

  it("arquivo que não chegou e falha ao conferir: não envia nem apaga às cegas", async () => {
    expect(await sendUploadedChatMedia(CONV, { path: pathAt("sumiu.pdf"), name: "sumiu.pdf" })).toMatchObject({ error: expect.stringContaining("não chegou") })
    const path = put(pathAt("a.pdf"), PDF, "application/pdf")
    db.errors.chat_messages = "timeout"
    expect(await sendUploadedChatMedia(CONV, { path, name: "a.pdf" })).toMatchObject({ error: expect.stringContaining("conferir") })
    expect(stored.has(path)).toBe(true)
    expect(sendMedia).not.toHaveBeenCalled()
  })

  it("perdeu a visão da conversa entre autorizar e confirmar: recusa e apaga", async () => {
    const path = put(pathAt("a.pdf"), PDF, "application/pdf")
    canView = false
    expect(await sendUploadedChatMedia(CONV, { path, name: "a.pdf" })).toMatchObject({ error: expect.stringContaining("Sem permissão") })
    expect(stored.has(path)).toBe(false)
    expect(sendMedia).not.toHaveBeenCalled()
  })

  it("canal Oficial: formato não aceito é convertido e o original sai do armazenamento", async () => {
    db.tables.chat_conversations[0].whatsapp_instances.provider = "meta_cloud"
    transcode.mockResolvedValue({ buffer: Buffer.from(MP4), mime: "video/mp4", ext: "mp4" })
    const path = put(pathAt("clipe.mov"), MP4, "video/quicktime")
    expect(await sendUploadedChatMedia(CONV, { path, name: "clipe.mov" })).toMatchObject({ id: expect.any(String) })
    const converted = path.replace(/\.mov$/, "_tc.mp4")
    expect(stored.has(path)).toBe(false)
    expect(stored.has(converted)).toBe(true)
    expect(sendMedia).toHaveBeenCalledWith("5511999999999", expect.stringContaining(converted), "video", undefined, "clipe.mp4", undefined)
    expect(db.tables.chat_messages[0]).toMatchObject({ media_mime_type: "video/mp4", metadata: { storage_path: converted } })
  })
})
