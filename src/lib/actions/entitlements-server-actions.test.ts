import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireModule: vi.fn(),
  hasModule: vi.fn(),
  from: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/modules", () => ({
  requireModule: mocks.requireModule,
  hasModule: mocks.hasModule,
}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: mocks.from },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createKeywordTrigger } from "@/lib/actions/keyword-triggers"
import { updateAutomationConfig } from "@/lib/actions/automation"
import { updateStudioConfig } from "@/lib/actions/studio/config"
import { dispatchAutomations } from "@/lib/automation/dispatch"
import { evaluateKeywordTriggers } from "@/lib/automation/keyword-engine"
import { sendChannelText } from "@/lib/channels/reply"

const owner = {
  user: { id: "user-1", tenantId: "tenant-1", role: "owner" },
}

describe("entitlements nas Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(owner)
    mocks.hasModule.mockResolvedValue(false)
    mocks.requireModule.mockRejectedValue(new Error("Módulo não habilitado"))
  })

  it("nega chamada direta de gatilho sem módulo antes de tocar no banco", async () => {
    await expect(createKeywordTrigger({
      name: "Teste",
      patterns: ["oi"],
      match_type: "contains",
      case_sensitive: false,
      response_text: "Olá",
      apply_tag_id: null,
      cooldown_min: 0,
      enabled: true,
      pause_when_assigned: false,
    })).rejects.toThrow("Módulo não habilitado")

    expect(mocks.requireModule).toHaveBeenCalledWith("keyword_triggers")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("nega atualização direta de automação sem o módulo correspondente", async () => {
    await expect(updateAutomationConfig({ welcome_enabled: true })).resolves.toEqual({
      error: "Recurso não habilitado nesta conta.",
    })

    expect(mocks.requireModule).toHaveBeenCalledWith("welcome_message")
    expect(mocks.requireModule).not.toHaveBeenCalledWith("business_hours")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("nega configuração direta do Studio antes de qualquer query", async () => {
    await expect(updateStudioConfig({
      ai_enabled: true,
      ai_name: "Kora",
      ai_tone: "formal",
      ai_language: "pt-BR",
      identity_text: null,
      communication_style_text: null,
      anti_patterns_text: null,
    })).rejects.toThrow("Módulo não habilitado")

    expect(mocks.requireModule).toHaveBeenCalledWith("ai_studio")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("não executa configuração antiga de automação depois do downgrade", async () => {
    await dispatchAutomations({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      instance: {},
    })

    expect(mocks.hasModule).toHaveBeenCalledWith("tenant-1", "business_hours")
    expect(mocks.hasModule).toHaveBeenCalledWith("tenant-1", "welcome_message")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("não executa gatilho antigo depois do módulo ser removido", async () => {
    await expect(evaluateKeywordTriggers({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      text: "oi",
      instance: {},
    })).resolves.toBe(false)

    expect(mocks.hasModule).toHaveBeenCalledWith("tenant-1", "keyword_triggers")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("bloqueia envio direto no Instagram após remoção do módulo", async () => {
    await expect(sendChannelText({
      channel: "instagram",
      phoneNumber: "",
      externalId: "igsid-1",
      tenantId: "tenant-1",
    }, "oi", {} as never)).rejects.toThrow("Instagram Direct não habilitado")

    expect(mocks.hasModule).toHaveBeenCalledWith("tenant-1", "instagram_direct")
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("forceFlowId não ignora a licença do Studio", () => {
    const source = readFileSync("src/lib/ai-v2/run.ts", "utf8")
    expect(source).toContain('if (!(await hasModule(tenantId, "ai_studio")))')
    expect(source).not.toMatch(/hasModule\(tenantId, "ai_studio"\)[^\n]*forceFlowId/)
  })
})
