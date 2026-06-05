"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  MetaCloudProvider,
  type MetaBusinessProfile, type MetaTemplate, type TemplateAnalytics,
} from "@/lib/providers/meta-cloud-provider"
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { parseVars, type TemplateVar } from "@/lib/whatsapp/template-vars"
import { upsertTemplateCache } from "@/lib/channels/template-cache"
import { revalidatePath } from "next/cache"

const PAGE = "/integracoes/whatsapp-oficial"
const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v25.0"}`

type Result = { ok: boolean; error?: string; id?: string }

/**
 * Embedded Signup — o cliente conectou a WABA dele no popup da Meta. Recebe o `code`
 * + WABA + phone_number_id do frontend, troca por token, assina o webhook, registra
 * o número e cria/atualiza a instância `meta_cloud` do tenant (token CIFRADO).
 * Gate: owner/admin + módulo `whatsapp_official` habilitado pro tenant.
 */
export async function connectWhatsAppOfficial(input: {
  code:          string
  wabaId:        string
  phoneNumberId: string
}): Promise<Result> {
  const session = await auth()
  if (!session) return { ok: false, error: "Não autenticado." }
  if (!["owner", "admin"].includes(session.user.role)) return { ok: false, error: "Acesso restrito a administradores." }
  const tenantId = session.user.tenantId

  const modules = await getEnabledModuleSlugs(tenantId)
  if (!modules.has("whatsapp_official")) {
    return { ok: false, error: "Módulo WhatsApp Oficial não está habilitado para sua conta." }
  }

  const appId     = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return { ok: false, error: "Integração Meta não configurada no servidor." }
  if (!input.code || !input.wabaId || !input.phoneNumberId) return { ok: false, error: "Dados do cadastro incompletos." }

  try {
    // 1. code → access_token (token de usuário de sistema da integração)
    const tokenJson = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(input.code)}`,
    ).then((r) => r.json()) as { access_token?: string; error?: { message?: string } }
    if (!tokenJson.access_token) {
      return { ok: false, error: `Falha ao obter o token da Meta: ${tokenJson.error?.message ?? "sem token"}` }
    }
    const accessToken = tokenJson.access_token
    const authH = { Authorization: `Bearer ${accessToken}` }

    // 2. assina o app na WABA (passa a receber os webhooks dessa conta)
    const subRes = await fetch(`${GRAPH}/${input.wabaId}/subscribed_apps`, { method: "POST", headers: authH })
    if (!subRes.ok) {
      const j = await subRes.json().catch(() => ({})) as { error?: { message?: string } }
      return { ok: false, error: `Falha ao assinar o webhook na WABA: ${j.error?.message ?? subRes.status}` }
    }

    // 3. registra o número na Cloud API (PIN de verificação em 2 etapas). "Já
    //    registrado" não é erro — segue (fire-and-forget).
    const pin = String(Math.floor(100000 + Math.random() * 900000))
    await fetch(`${GRAPH}/${input.phoneNumberId}/register`, {
      method:  "POST",
      headers: { ...authH, "Content-Type": "application/json" },
      body:    JSON.stringify({ messaging_product: "whatsapp", pin }),
    }).catch(() => {})

    // 4. info do número (pra exibir)
    const info = await fetch(
      `${GRAPH}/${input.phoneNumberId}?fields=display_phone_number,verified_name`, { headers: authH },
    ).then((r) => r.json()).catch(() => ({})) as { display_phone_number?: string; verified_name?: string }

    // 5. cria/atualiza a instância meta_cloud do tenant — token CIFRADO
    const row = {
      tenant_id:                tenantId,
      provider:                 "meta_cloud",
      meta_phone_number_id:     input.phoneNumberId,
      meta_business_account_id: input.wabaId,
      meta_access_token:        encryptSecret(accessToken),
      phone_number:             info.display_phone_number ?? null,
      instance_name:            info.verified_name || `Oficial ${info.display_phone_number ?? input.phoneNumberId}`,
      status:                   "connected",
      updated_at:               new Date().toISOString(),
    }

    const { data: existing } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider", "meta_cloud")
      .maybeSingle()

    const { error } = existing
      ? await supabaseAdmin.from("whatsapp_instances").update(row).eq("id", existing.id)
      : await supabaseAdmin.from("whatsapp_instances").insert(row)
    if (error) return { ok: false, error: error.message }

    revalidatePath(PAGE)
    revalidatePath("/integracoes")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

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
      meta_access_token:        decryptSecret(inst.meta_access_token),
      meta_app_secret:          decryptSecret(inst.meta_app_secret) ?? "",
    }),
  }
}

/** Variáveis NOMEADAS: minúsculas, números e _, começando por letra (regra da Meta). */
function validateNamedVars(vars: TemplateVar[]): string | null {
  for (const v of vars) {
    if (!/^[a-z][a-z0-9_]*$/.test(v.key)) {
      return `Variável "${v.key}" inválida. Use minúsculas, números e _ começando por letra (ex: nome, numero_pedido).`
    }
  }
  return null
}

/**
 * Valida as regras da Meta pra variáveis POSICIONAIS no corpo (senão a Graph rejeita
 * com erro cru). Retorna mensagem PT-BR ou null. Regras: sequenciais 1..n, não
 * começar/terminar com variável, não usar duas seguidas.
 */
function validateTemplateVars(body: string): string | null {
  const nums = (body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((m) => parseInt(m.replace(/\D/g, ""), 10))
  if (nums.length === 0) return null
  const distinct = Array.from(new Set(nums)).sort((a, b) => a - b)
  for (let i = 0; i < distinct.length; i++) {
    if (distinct[i] !== i + 1) {
      return "As variáveis precisam ser sequenciais começando em {{1}} (ex: {{1}}, {{2}}). Ajuste a numeração."
    }
  }
  const trimmed = body.trim()
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed)) return "O texto não pode COMEÇAR com uma variável. Coloque algum texto antes do {{1}}."
  if (/\{\{\s*\d+\s*\}\}$/.test(trimmed)) return "O texto não pode TERMINAR com uma variável. Coloque algum texto depois da última."
  if (/\}\}\s*\{\{/.test(body)) return "Não use duas variáveis seguidas — coloque um texto entre elas."
  return null
}

export interface TemplateButton { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string; phone?: string }

/** Shape comum de criação/edição (edição só acrescenta `templateId`). */
export interface TemplateInput {
  name: string
  category: "MARKETING" | "UTILITY"
  language: string
  parameterFormat?: "NAMED" | "POSITIONAL"   // seleção do usuário; vai à Meta como parameter_format
  headerText?:    string
  headerExample?: string
  body: string
  examples: Record<string, string>   // key da variável (número OU nome) → exemplo
  footer?:  string
  buttons?: TemplateButton[]
}

/** Opts já validados/normalizados, no shape que `createTemplate`/`editTemplate` aceitam. */
type BuildableTemplate = {
  name:     string
  category: "MARKETING" | "UTILITY"
  language: string
  parameterFormat: "NAMED" | "POSITIONAL"
  headerText?:    string
  headerExample?: string
  body:           string
  bodyExamples?:  Record<string, string>
  footer?:        string
  buttons?:       TemplateButton[]
}

/**
 * Valida + normaliza o input de template (regras da Meta), compartilhado por
 * `createOfficialTemplate` e `editOfficialTemplate`. Retorna `{ error }` em falha
 * OU `{ build }` com os opts prontos pra `provider.createTemplate/editTemplate`.
 */
function validateTemplateInput(input: TemplateInput): { error: string } | { build: BuildableTemplate } {
  const name = input.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
  if (!name) return { error: "Informe um nome." }
  const body = input.body.trim()
  if (!body) return { error: "Informe o corpo da mensagem." }

  const vars = parseVars(body)

  // O formato é a SELEÇÃO do usuário, enviada à Meta como `parameter_format` (o
  // default da API é POSITIONAL). Fallback infere do conteúdo p/ chamadas legadas.
  const parameterFormat: "NAMED" | "POSITIONAL" =
    vars.length === 0 ? "POSITIONAL"
    : input.parameterFormat ?? (vars.some((v) => v.named) ? "NAMED" : "POSITIONAL")

  // Conteúdo precisa bater com o formato — a Meta rejeita divergência ("Invalid parameter").
  if (parameterFormat === "NAMED" && vars.some((v) => !v.named))
    return { error: "Tipo Nome selecionado, mas há variável numerada ({{1}}). Use nomes (ex: {{nome}})." }
  if (parameterFormat === "POSITIONAL" && vars.some((v) => v.named))
    return { error: "Tipo Número selecionado, mas há variável nomeada ({{nome}}). Use {{1}}, {{2}}…" }

  // Validação por tipo (nomeado: nomes válidos; posicional: sequência/posição).
  const varErr = parameterFormat === "NAMED" ? validateNamedVars(vars) : validateTemplateVars(body)
  if (varErr) return { error: varErr }

  // Cada variável precisa de um exemplo.
  const examples = input.examples ?? {}
  for (const v of vars) {
    if (!examples[v.key]?.trim()) return { error: `Preencha o exemplo da variável {{${v.key}}}.` }
  }

  // Cabeçalho de texto: se tiver variável, exige exemplo.
  const headerText = input.headerText?.trim() || undefined
  if (headerText && parseVars(headerText).length > 0 && !input.headerExample?.trim()) {
    return { error: "Preencha o exemplo da variável do cabeçalho." }
  }

  // Botões: valida texto + url/telefone conforme o tipo.
  const buttons = (input.buttons ?? []).filter((b) => b.text.trim())
  for (const b of buttons) {
    if (b.type === "URL" && !b.url?.trim()) return { error: `Botão "${b.text}": informe a URL.` }
    if (b.type === "PHONE_NUMBER" && !b.phone?.trim()) return { error: `Botão "${b.text}": informe o telefone.` }
  }

  return {
    build: {
      name,
      category: input.category,
      language: input.language,
      parameterFormat,
      headerText,
      headerExample: input.headerExample?.trim() || undefined,
      body,
      bodyExamples: vars.length > 0 ? examples : undefined,
      footer: input.footer?.trim() || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
    },
  }
}

export async function createOfficialTemplate(input: TemplateInput): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }

  const v = validateTemplateInput(input)
  if ("error" in v) return { ok: false, error: v.error }

  try {
    const res = await r.provider.createTemplate(v.build)
    revalidatePath(PAGE)
    return { ok: true, id: res.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Edita um template existente (mesmas regras de validação da criação). `name` e
 * `language` são imutáveis na Meta — o provider não os envia no body. owner/admin.
 */
export async function editOfficialTemplate(input: TemplateInput & { templateId: string }): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }
  if (!input.templateId) return { ok: false, error: "Template inválido." }

  const v = validateTemplateInput(input)
  if ("error" in v) return { ok: false, error: v.error }

  try {
    await r.provider.editTemplate(input.templateId, v.build)
    revalidatePath(PAGE)
    return { ok: true, id: input.templateId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Detalhes completos de um template pelo ID (tela de edição/auditoria). owner/admin. */
export async function getOfficialTemplate(
  templateId: string,
): Promise<{ ok: boolean; template?: MetaTemplate; error?: string }> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }
  try {
    const template = await r.provider.getTemplate(templateId)
    return { ok: true, template }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Analytics (enviadas/entregues/lidas/cliques) de UM template nos últimos `days`
 * dias. Calcula a janela unix e delega ao provider. owner/admin.
 */
export async function getOfficialTemplateAnalytics(
  templateId: string, days = 30,
): Promise<{ ok: boolean; analytics?: TemplateAnalytics; error?: string }> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }

  const end   = Math.floor(Date.now() / 1000)
  const start = end - days * 86400
  try {
    const analytics = await r.provider.getTemplateAnalytics([templateId], start, end)
    return { ok: true, analytics }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Exclui UMA versão de idioma de um template (pelo ID + nome). owner/admin. */
export async function deleteOfficialTemplateById(templateId: string, name: string): Promise<Result> {
  const r = await tenantMetaProvider()
  if ("error" in r) return { ok: false, error: r.error }
  try {
    await r.provider.deleteTemplateById(templateId, name)
    revalidatePath(PAGE)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Sincroniza o cache local (`wa_templates`) com o que a Graph lista pra WABA do
 * tenant. Best-effort por item: uma falha de cache não derruba o resto. owner/admin.
 */
export async function syncTemplatesCache(): Promise<Result> {
  const session = await auth()
  if (!session) return { ok: false, error: "Não autenticado." }
  if (!["owner", "admin"].includes(session.user.role)) return { ok: false, error: "Acesso restrito a administradores." }
  return syncTemplatesCacheFor(session.user.tenantId)
}

/**
 * Núcleo do sync (SEM auth) — seguro pra chamar de dentro de `after()` passando o
 * tenantId já resolvido. NUNCA chamar auth()/headers() dentro de after() (Next 16).
 */
export async function syncTemplatesCacheFor(tenantId: string): Promise<Result> {
  // Busca a instância oficial (precisamos do id da instância + WABA pro cache).
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenantId)
    .eq("provider", "meta_cloud")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_phone_number_id || !inst.meta_access_token) {
    return { ok: false, error: "Instância oficial não configurada." }
  }

  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst.meta_phone_number_id,
    meta_business_account_id: inst.meta_business_account_id ?? "",
    meta_access_token:        decryptSecret(inst.meta_access_token),
    meta_app_secret:          decryptSecret(inst.meta_app_secret) ?? "",
  })

  try {
    const templates = await provider.listTemplates()
    for (const t of templates) {
      // Best-effort: upsertTemplateCache já engole erros por item.
      await upsertTemplateCache(tenantId, inst.id, inst.meta_business_account_id ?? null, {
        templateId:     t.id,
        name:           t.name,
        language:       t.language,
        category:       t.category,
        status:         t.status,
        qualityScore:   t.quality_score?.score,
        rejectedReason: t.rejected_reason,
        components:     t.components,
      })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Desconecta o número oficial do tenant. Best-effort: desassina o app da WABA na
 * Meta (para de receber webhooks daquela conta) + limpa as credenciais e marca
 * desconectado. NÃO deleta a linha — preserva o histórico de conversas; reconectar
 * pelo Embedded Signup atualiza a mesma instância. owner/admin.
 */
export async function disconnectWhatsAppOfficial(): Promise<Result> {
  const session = await auth()
  if (!session) return { ok: false, error: "Não autenticado." }
  if (!["owner", "admin"].includes(session.user.role)) return { ok: false, error: "Acesso restrito a administradores." }

  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, meta_business_account_id, meta_access_token")
    .eq("tenant_id", session.user.tenantId)
    .eq("provider", "meta_cloud")
    .maybeSingle()
  if (!inst) return { ok: false, error: "Nenhum número oficial conectado." }

  // Best-effort: remove a assinatura do app na WABA (decifra o token pra usar).
  try {
    const token = decryptSecret(inst.meta_access_token)
    if (token && inst.meta_business_account_id) {
      await fetch(`${GRAPH}/${inst.meta_business_account_id}/subscribed_apps`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
    }
  } catch { /* best-effort — segue pra limpar local de qualquer jeito */ }

  const { error } = await supabaseAdmin
    .from("whatsapp_instances")
    .update({ meta_access_token: null, status: "disconnected", updated_at: new Date().toISOString() })
    .eq("id", inst.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(PAGE)
  revalidatePath("/integracoes")
  return { ok: true }
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
  // "UNDEFINED" é placeholder de "sem segmento" — a Meta recusa setar isso (#131000).
  if (profile.vertical !== undefined && profile.vertical !== "UNDEFINED") payload.vertical = profile.vertical
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
  vars:     TemplateVar[]   // ordenadas; posicionais ({{1}}) ou nomeadas ({{nome}})
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
        return { name: t.name, language: t.language, body, vars: parseVars(body) }
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
