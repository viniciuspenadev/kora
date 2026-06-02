"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider, type MetaBusinessProfile } from "@/lib/providers/meta-cloud-provider"
import { revalidatePath } from "next/cache"

const PAGE = "/integracoes/whatsapp-oficial"

type Result = { ok: boolean; error?: string; id?: string }

/** Resolve o provider Meta da instância oficial do tenant logado (owner/admin). */
async function tenantMetaProvider(): Promise<{ provider: MetaCloudProvider } | { error: string }> {
  const session = await auth()
  if (!session) return { error: "Não autenticado." }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Acesso restrito a administradores." }

  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", session.user.tenantId)
    .eq("provider", "meta_cloud")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_phone_number_id || !inst.meta_access_token) {
    return { error: "Instância oficial não configurada." }
  }
  return {
    provider: new MetaCloudProvider({
      meta_phone_number_id:     inst.meta_phone_number_id,
      meta_business_account_id: inst.meta_business_account_id ?? "",
      meta_access_token:        inst.meta_access_token,
      meta_app_secret:          inst.meta_app_secret ?? "",
    }),
  }
}

/** Conta as variáveis {{n}} no corpo. */
function countVars(body: string): number {
  const set = new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, "")))
  return set.size
}

export async function createOfficialTemplate(input: {
  name: string
  category: "MARKETING" | "UTILITY"
  language: string
  body: string
  samples: string[]
}): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }

  const name = input.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
  if (!name) return { ok: false, error: "Informe um nome." }
  const body = input.body.trim()
  if (!body) return { ok: false, error: "Informe o corpo da mensagem." }

  const nVars = countVars(body)
  const samples = input.samples.slice(0, nVars).map((s) => s.trim())
  if (samples.length < nVars || samples.some((s) => !s)) {
    return { ok: false, error: "Preencha um exemplo para cada variável." }
  }

  try {
    const res = await r.provider.createTemplate({
      name,
      category: input.category,
      language: input.language,
      body,
      bodyExamples: nVars > 0 ? samples : undefined,
    })
    revalidatePath(PAGE)
    return { ok: true, id: res.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deleteOfficialTemplate(name: string): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }
  try {
    await r.provider.deleteTemplate(name)
    revalidatePath(PAGE)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function updateOfficialProfile(profile: Partial<MetaBusinessProfile>): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }

  // Só manda campos editáveis e não-vazios (a foto é tratada à parte no futuro).
  const payload: Partial<MetaBusinessProfile> = {}
  if (profile.about !== undefined) payload.about = profile.about
  if (profile.description !== undefined) payload.description = profile.description
  if (profile.address !== undefined) payload.address = profile.address
  if (profile.email !== undefined) payload.email = profile.email
  if (profile.vertical !== undefined) payload.vertical = profile.vertical
  if (profile.websites) payload.websites = profile.websites.filter((w) => w.trim()).slice(0, 2)

  try {
    await r.provider.updateBusinessProfile(payload)
    revalidatePath(PAGE)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export interface InboxTemplate {
  name:     string
  language: string
  body:     string
  varCount: number
}

/** Templates APROVADOS do tenant — pro seletor do composer quando a janela fecha. */
export async function getInboxTemplates(): Promise<InboxTemplate[]> {
  const r = await tenantMetaProvider()
  if ("error" in r) return []
  try {
    const tpls = await r.provider.listTemplates()
    return tpls
      .filter((t) => t.status === "APPROVED")
      .map((t) => {
        const body = t.components?.find((c) => c.type === "BODY")?.text ?? ""
        const varCount = new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m.replace(/\D/g, ""))).size
        return { name: t.name, language: t.language, body, varCount }
      })
  } catch {
    return []
  }
}

export async function sendOfficialTest(input: {
  phone: string
  mode: "text" | "template"
  text?: string
  template?: string
  language?: string
}): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }

  const phone = input.phone.replace(/\D/g, "")
  if (phone.length < 12) return { ok: false, error: "Use o número completo com DDI (ex: 5511999999999)." }

  try {
    if (input.mode === "template") {
      if (!input.template) return { ok: false, error: "Selecione um template." }
      const res = await r.provider.sendTemplate(phone, input.template, input.language ?? "pt_BR")
      return { ok: true, id: res.messageId }
    }
    const text = (input.text ?? "").trim()
    if (!text) return { ok: false, error: "Escreva a mensagem." }
    const res = await r.provider.sendText(phone, text)
    return { ok: true, id: res.messageId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
