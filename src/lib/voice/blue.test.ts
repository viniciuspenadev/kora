import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { ViewerScope } from "@/lib/visibility"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { encryptSecret } from "@/lib/crypto/secrets"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/visibility", () => ({ getViewerScope: vi.fn(), canViewConversation: vi.fn() }))
const db = new MemoryDb()
let moduleOn = false
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => moduleOn }))
const { voiceAllowed, voiceConfigForInstance, voiceTarget, voiceInstanceIdsForViewer, voiceStatus, voiceRequest } = await import("./blue")

const scope = (patch: Partial<ViewerScope> = {}) => ({
  tenantId: "blue", userId: "agent", isAdmin: false, instanceIds: null,
  ...patch,
} as ViewerScope)

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.example.test")
  vi.stubEnv("EVOLUTION_API_KEY", "global-key")
  vi.stubEnv("BLUE_VOICE_ENABLED", "false")
  vi.stubEnv("VOICE_EVOLUTION_ALLOWED_ORIGINS", "")
  vi.stubEnv("VOICE_USE_INSTANCE_CONFIG", "true")
  vi.mocked(getViewerScope).mockResolvedValue(scope())
  vi.mocked(canViewConversation).mockReturnValue(true)
  moduleOn = false
  db.reset({ tenant_users: [
    { tenant_id: "blue", user_id: "agent", active: true, voice_instance_ids: ["number-a"] },
    { tenant_id: "other", user_id: "agent", active: true, voice_instance_ids: ["number-b"] },
  ] })
})

const line = (id = "number-a", patch = {}) => ({ id, tenant_id: "blue", provider: "baileys",
  instance_name: `instance-${id}`, evolution_url: "https://evolution.example.test", evolution_key: "line-key", ...patch })

it("resolve cada nome e chave cadastrados; ENV global só preenche configuração ausente", () => {
  const a = voiceConfigForInstance(line())!
  const b = voiceConfigForInstance(line("number-b", { evolution_key: "key-b" }))!
  expect(a.instanceName).toBe("instance-number-a")
  expect(a.key).toBe("line-key")
  expect(b.instanceName).toBe("instance-number-b")
  expect(b.key).toBe("key-b")
  expect(voiceConfigForInstance(line("number-c", { evolution_url: null, evolution_key: null }))?.key).toBe("global-key")
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"))
  expect(voiceConfigForInstance(line("number-d", { evolution_key: encryptSecret("encrypted-line-key") }))?.key).toBe("encrypted-line-key")
  expect(voiceConfigForInstance(line("number-e", { evolution_key: "enc:v1:invalid" }))).toBeNull()
})

it("Meta, nomes inválidos e destinos fora da lista não recebem credenciais de voz", () => {
  expect(voiceConfigForInstance(line("meta", { provider: "meta_cloud" }))).toBeNull()
  expect(voiceConfigForInstance(line("bad", { instance_name: "../another" }))).toBeNull()
  for (const url of ["https://untrusted.test", "http://evolution.example.test", "https://user:pass@evolution.example.test", "https://evolution.example.test/path"]) {
    expect(voiceConfigForInstance(line("bad", { evolution_url: url }))).toBeNull()
  }
  vi.stubEnv("VOICE_EVOLUTION_ALLOWED_ORIGINS", "https://second.example.test")
  expect(voiceConfigForInstance(line("second", { evolution_url: "https://second.example.test" }))?.key).toBe("line-key")
  expect(voiceConfigForInstance(line("second", { evolution_url: "https://second.example.test", evolution_key: null }))).toBeNull()
})

it("lista de botões respeita concessões por número; administrador vê números Baileys configurados", async () => {
  moduleOn = true
  const instances = [line(), line("number-b"), line("meta", { provider: "meta_cloud" })]
  expect(await voiceInstanceIdsForViewer(scope(), instances)).toEqual(["number-a"])
  expect(await voiceInstanceIdsForViewer(scope({ isAdmin: true }), instances)).toEqual(["number-a", "number-b"])
  expect(await voiceInstanceIdsForViewer(scope({ instanceIds: ["number-b"] }), instances)).toEqual([])
})

it("conversa seleciona a própria instância; consulta e autorização nunca atravessam tenant", async () => {
  moduleOn = true
  db.tables.chat_conversations = [{ id: "conversation-a", tenant_id: "blue", instance_id: "number-a", assigned_to: "agent",
    channel: "whatsapp", is_group: false, chat_contacts: { tenant_id: "blue", phone_number: "+55 (11) 99999-0000" } }]
  db.tables.whatsapp_instances = [line("number-a", { tenant_id: "other", evolution_key: "other-key" }), line()]
  const target = await voiceTarget("conversation-a")
  expect(target.config.instanceName).toBe("instance-number-a")
  expect(target.config.key).toBe("line-key")
  expect(target.number).toBe("5511999990000")
  db.tables.whatsapp_instances = [line("number-a", { tenant_id: "other" })]
  await expect(voiceTarget("conversation-a")).rejects.toThrow("Voz não configurada")
  db.tables.chat_conversations[0].tenant_id = "other"
  await expect(voiceTarget("conversation-a")).rejects.toThrow("Conversa não encontrada")
})

it("piloto antigo só vale para a identidade exata; configuração por instância remove o desvio", () => {
  vi.stubEnv("BLUE_VOICE_ENABLED", "true")
  vi.stubEnv("BLUE_VOICE_INSTANCE_ID", "number-a")
  vi.stubEnv("BLUE_VOICE_INSTANCE_NAME", "instance-number-a")
  vi.stubEnv("BLUE_VOICE_URL", "https://pilot.example.test")
  vi.stubEnv("BLUE_VOICE_API_KEY", "pilot-key")
  vi.stubEnv("VOICE_USE_INSTANCE_CONFIG", "false")
  expect(voiceConfigForInstance(line())?.url.origin).toBe("https://pilot.example.test")
  expect(voiceConfigForInstance(line("number-b"))?.url.origin).toBe("https://evolution.example.test")
  expect(voiceConfigForInstance(line("number-a", { instance_name: "different-instance" }))?.url.origin).toBe("https://evolution.example.test")
  vi.stubEnv("VOICE_USE_INSTANCE_CONFIG", "true")
  expect(voiceConfigForInstance(line())?.url.origin).toBe("https://evolution.example.test")
})

it("status 404 mantém discagem desligada; requisição não segue redirecionamento com chave", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 404, json: async () => ({}) })
  vi.stubGlobal("fetch", fetchMock)
  try {
    const config = voiceConfigForInstance(line())!
    expect(await voiceStatus(config)).toEqual({ enabled: false, ready: false, call: null })
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error")
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ enabled: true, ready: true, call: null }) })
    expect((await voiceStatus(config)).ready).toBe(true)
    await voiceRequest(config, "media-ticket", "POST")
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe("https://evolution.example.test/voice/media-ticket/instance-number-a")
  } finally { vi.unstubAllGlobals() }
})

it("módulo desligado nega inclusive proprietário", async () => {
  expect(await voiceAllowed(scope({ isAdmin: true }), "number-a")).toBe(false)
})

it("owner/admin pode ligar com módulo ativo; atendente exige concessão no mesmo tenant", async () => {
  moduleOn = true
  expect(await voiceAllowed(scope({ isAdmin: true }), "number-a")).toBe(true)
  expect(await voiceAllowed(scope(), "number-a")).toBe(true)
  expect(await voiceAllowed(scope(), "number-b")).toBe(false)
})

it("restrição de números que atende e conta inativa negam a ligação", async () => {
  moduleOn = true
  expect(await voiceAllowed(scope({ instanceIds: ["number-b"] }), "number-a")).toBe(false)
  db.tables.tenant_users[0].active = false
  expect(await voiceAllowed(scope(), "number-a")).toBe(false)
})
