import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { MetaCloudProvider } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"

// ═══════════════════════════════════════════════════════════════
// Canal OFICIAL (Meta) da confirmação da Agenda — Fase 3d.4 (§6.10)
// ═══════════════════════════════════════════════════════════════
// No Meta a pergunta de confirmação é SEMPRE botão interativo — a janela 24h só
// decide o VEÍCULO: dentro = botões nativos (grátis); fora = template aprovado
// (única via legal). O Baileys não tem janela nem botão nativo → texto numerado.
//
// Roteio da resposta é DETERMINÍSTICO por id (`agenda:confirm:<apptId>` /
// `agenda:resched:<apptId>`) — injetado no botão nativo (reply.id) ou no payload
// do quick-reply do template (G3). O interceptor casa por esse id (G4), não por
// texto. `pending_agenda` segue a fonte única de estado nos dois canais.
//
// 🔒 Gate fail-closed: fora da janela só envia se o template estiver APPROVED;
// senão DEGRADA pra aviso in-app ao atendente (nunca silencia, nunca texto-livre
// que falharia calado com #131047).

export const AGENDA_CONFIRM_TEMPLATE = "kora_agenda_confirmacao"
export const AGENDA_TEMPLATE_LANG    = "pt_BR"

type ProviderInstance = Parameters<typeof getProvider>[0]

// Corpo do template (posicional): {{1}} contato · {{2}} serviço · {{3}} data · {{4}} hora.
// Fixo de propósito — corpo previsível reduz reprovação na Meta (§6.10).
const TEMPLATE_BODY =
  "Olá, {{1}}! Passando pra confirmar seu horário 👋\n\n📅 {{2}}\n🗓️ {{3}} às {{4}}\n\nPosso confirmar?"
const TEMPLATE_EXAMPLES: Record<string, string> = { "1": "Maria", "2": "Consulta", "3": "12 de junho", "4": "14:00" }

// ── instância oficial do tenant (ou null = só-Baileys) ───────────────
async function metaInstanceRow(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin.from("whatsapp_instances")
    .select("*").eq("tenant_id", tenantId).eq("provider", "meta_cloud")
    .order("created_at", { ascending: true }).limit(1).maybeSingle()
  return data ?? null
}

function buildMetaProvider(inst: Record<string, unknown>): MetaCloudProvider | null {
  const waba = inst.meta_business_account_id as string | null
  const tok  = inst.meta_access_token as string | null
  if (!waba || !tok) return null
  return new MetaCloudProvider({
    meta_phone_number_id:     (inst.meta_phone_number_id as string | null) ?? "",
    meta_business_account_id: waba,
    meta_access_token:        decryptSecret(tok),
    meta_app_secret:          decryptSecret(inst.meta_app_secret as string | null) ?? "",
  })
}

/**
 * Idempotente: garante que `kora_agenda_confirmacao` existe na WABA do tenant e
 * está registrado (cache + nome em `tenant_config`). Chamado ao LIGAR avisos numa
 * instância oficial e como self-heal no caminho degradado. Best-effort: NUNCA lança.
 * Tenant só-Baileys → no-op (não precisa template).
 */
export async function ensureAgendaConfirmTemplate(tenantId: string): Promise<void> {
  try {
    // Já registrado? (idempotência — evita recriar/duplicar na Meta)
    const { data: cfg } = await supabaseAdmin.from("tenant_config")
      .select("agenda_confirm_template").eq("tenant_id", tenantId).maybeSingle()
    if (cfg?.agenda_confirm_template) return

    const inst = await metaInstanceRow(tenantId)
    if (!inst) return                       // só-Baileys
    const provider = buildMetaProvider(inst)
    if (!provider) return

    let status = "PENDING"
    try {
      const r = await provider.createTemplate({
        name: AGENDA_CONFIRM_TEMPLATE, category: "UTILITY", language: AGENDA_TEMPLATE_LANG,
        body: TEMPLATE_BODY, bodyExamples: TEMPLATE_EXAMPLES,
        buttons: [{ type: "QUICK_REPLY", text: "Confirmar" }, { type: "QUICK_REPLY", text: "Remarcar" }],
      })
      status = r.status || "PENDING"
    } catch (e) {
      // "já existe" na Meta (criado antes) não é erro — o webhook/sync resolve o status.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/already exists|duplicate|exists with/i.test(msg)) {
        console.error("[agenda] createTemplate:", msg); return
      }
    }

    // Cache local + selo system-managed (UI trava deletar/editar) + nome em config.
    await supabaseAdmin.from("wa_templates").upsert({
      tenant_id: tenantId, instance_id: inst.id, waba_id: inst.meta_business_account_id,
      name: AGENDA_CONFIRM_TEMPLATE, language: AGENDA_TEMPLATE_LANG, category: "UTILITY",
      status, kora_category: "agenda", managed_by: "system", updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,name,language" })
    await supabaseAdmin.from("tenant_config")
      .upsert({ tenant_id: tenantId, agenda_confirm_template: AGENDA_CONFIRM_TEMPLATE }, { onConflict: "tenant_id" })
  } catch (e) {
    console.error("[agenda] ensureAgendaConfirmTemplate:", e instanceof Error ? e.message : e)
  }
}

/** Nome do template SE aprovado, senão null (gate fail-closed). */
export async function approvedConfirmTemplate(tenantId: string): Promise<string | null> {
  const { data: cfg } = await supabaseAdmin.from("tenant_config")
    .select("agenda_confirm_template").eq("tenant_id", tenantId).maybeSingle()
  const name = cfg?.agenda_confirm_template as string | null
  if (!name) return null
  const { data: tpl } = await supabaseAdmin.from("wa_templates")
    .select("status").eq("tenant_id", tenantId).eq("name", name).eq("language", AGENDA_TEMPLATE_LANG).maybeSingle()
  return tpl?.status === "APPROVED" ? name : null
}

const WINDOW_MS = 24 * 3600_000

interface ConfirmSendArgs {
  tenantId: string
  instance: ProviderInstance
  phone: string
  apptId: string
  vars: Record<string, string>
  anchorText:   string   // corpo do botão nativo (Meta) — sem menu numerado
  numberedText: string   // texto do Baileys — com menu numerado
  inWindow: boolean
}
type ConfirmSendResult = { messageId: string | null; displayText: string } | { degraded: string }

/**
 * Envia a pergunta de confirmação pelo VEÍCULO certo do canal/janela e devolve o
 * que persistir na thread (`displayText`) + o `messageId`. Pode lançar (rede) — o
 * chamador trata. `{ degraded }` = não enviou por gate (sem template aprovado).
 */
export async function sendAgendaConfirm(args: ConfirmSendArgs): Promise<ConfirmSendResult> {
  const provider     = getProvider(args.instance)
  const providerName = (args.instance as { provider?: string }).provider

  // Baileys (ou qualquer não-oficial): texto numerado, sempre livre.
  if (providerName !== "meta_cloud") {
    const r = await provider.sendText(args.phone, args.numberedText)
    return { messageId: r.messageId || null, displayText: args.numberedText }
  }

  const buttons = [
    { id: `agenda:confirm:${args.apptId}`, title: "Confirmar" },
    { id: `agenda:resched:${args.apptId}`, title: "Remarcar" },
  ]

  // Dentro da janela 24h → botões nativos (grátis, instantâneo).
  if (args.inWindow) {
    if (!provider.sendInteractive) return { degraded: "instância oficial sem suporte a botões" }
    const r = await provider.sendInteractive(args.phone, { body: args.anchorText, buttons })
    return { messageId: r.messageId || null, displayText: args.anchorText }
  }

  // Fora da janela → SÓ template aprovado (gate fail-closed). Sem aprovado → degrada
  // (e auto-semeia: a aprovação é async, então o próximo lembrete já vai conseguir).
  const name = await approvedConfirmTemplate(args.tenantId)
  if (!name || !provider.sendTemplate) {
    await ensureAgendaConfirmTemplate(args.tenantId)
    return { degraded: "template de confirmação fora da janela 24h ainda não aprovado" }
  }
  const r = await provider.sendTemplate(
    args.phone, name, AGENDA_TEMPLATE_LANG,
    [
      { text: args.vars.contato || "você" },
      { text: args.vars.servico || "seu atendimento" },
      { text: args.vars.data || "—" },
      { text: args.vars.hora || "—" },
    ],
    [
      { subType: "quick_reply", index: 0, payload: `agenda:confirm:${args.apptId}` },
      { subType: "quick_reply", index: 1, payload: `agenda:resched:${args.apptId}` },
    ],
  )
  return { messageId: r.messageId || null, displayText: args.anchorText }
}
