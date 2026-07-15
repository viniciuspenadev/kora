import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { MetaCloudProvider } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { getBlueprintByName } from "@/lib/templates/library"
import { parseVars } from "@/lib/whatsapp/template-vars"

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

    // Fonte única do conteúdo = o blueprint da Biblioteca.
    const bp = getBlueprintByName(AGENDA_CONFIRM_TEMPLATE)
    if (!bp) return

    let status = "PENDING"
    try {
      const r = await provider.createTemplate({
        name: bp.name, category: bp.metaCategory, language: bp.language,
        body: bp.body, bodyExamples: bp.bodyExamples, buttons: bp.buttons,
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
    // ⚠️ NUNCA rebaixar status: se o cache já diz APPROVED (sync da WABA), o
    // default "PENDING" deste caminho não pode sobrescrever (varredura 2026-07-15).
    const { data: cached } = await supabaseAdmin.from("wa_templates")
      .select("status").eq("tenant_id", tenantId)
      .eq("name", AGENDA_CONFIRM_TEMPLATE).eq("language", AGENDA_TEMPLATE_LANG).maybeSingle()
    if (cached?.status === "APPROVED") status = "APPROVED"
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

export type AgendaTemplateStatus = "none" | "pending" | "approved" | "rejected"

/** Status do template de confirmação na WABA do tenant (pro picker do lembrete). */
export async function agendaConfirmStatus(tenantId: string): Promise<AgendaTemplateStatus> {
  const { data: tpl } = await supabaseAdmin.from("wa_templates")
    .select("status").eq("tenant_id", tenantId)
    .eq("name", AGENDA_CONFIRM_TEMPLATE).eq("language", AGENDA_TEMPLATE_LANG).maybeSingle()
  if (!tpl) return "none"
  const s = (tpl.status || "").toUpperCase()
  if (s === "APPROVED") return "approved"
  if (s === "REJECTED") return "rejected"
  return "pending"   // PENDING / PAUSED / IN_APPEAL / etc.
}

/** Nome do template SE aprovado, senão null (gate fail-closed). */
export async function approvedConfirmTemplate(tenantId: string): Promise<string | null> {
  const { data: cfg } = await supabaseAdmin.from("tenant_config")
    .select("agenda_confirm_template").eq("tenant_id", tenantId).maybeSingle()
  const name = (cfg?.agenda_confirm_template as string | null) ?? null

  // Config vazio ≠ template inexistente: o seeding pode ter falhado DEPOIS do
  // template já existir/aprovar na WABA (sync preenche wa_templates). A VERDADE
  // é o cache de status — consulta direto e AUTO-CURA o config (varredura
  // 2026-07-15: Blue tinha APPROVED no cache e config null → degradava sempre).
  if (!name) {
    const { data: tpl } = await supabaseAdmin.from("wa_templates")
      .select("status").eq("tenant_id", tenantId)
      .eq("name", AGENDA_CONFIRM_TEMPLATE).eq("language", AGENDA_TEMPLATE_LANG).maybeSingle()
    if (tpl?.status !== "APPROVED") return null
    await supabaseAdmin.from("tenant_config")
      .upsert({ tenant_id: tenantId, agenda_confirm_template: AGENDA_CONFIRM_TEMPLATE }, { onConflict: "tenant_id" })
    return AGENDA_CONFIRM_TEMPLATE
  }

  const { data: tpl } = await supabaseAdmin.from("wa_templates")
    .select("status").eq("tenant_id", tenantId).eq("name", name).eq("language", AGENDA_TEMPLATE_LANG).maybeSingle()
  return tpl?.status === "APPROVED" ? name : null
}

// ── Seletor de template do lembrete (tenant escolhe entre os APROVADOS) ──────────
// O tenant pode criar vários templates e escolher qual usar no lembrete fora da janela.
// Pra a confirmação funcionar, o modelo precisa ter ≥2 botões de resposta rápida
// (Confirmar/Remarcar) — `quickReplies` deixa a UI avisar quando não tem.

export interface ApprovedTemplateOption {
  name:          string
  language:      string
  body:          string
  varKeys:       string[]   // variáveis do corpo, na ordem
  named:         boolean     // formato nomeado ({{nome}}) vs posicional ({{1}})
  quickReplies:  number      // qtd de botões de resposta rápida
  quickReplyIdx: number[]    // ÍNDICES reais dos quick-reply (botão pode não ser o 0/1)
  koraCategory:  string | null
}

function toTemplateOption(row: { name: string; language: string; components: unknown; kora_category: string | null }): ApprovedTemplateOption {
  const comps = Array.isArray(row.components) ? (row.components as Array<Record<string, unknown>>) : []
  const bodyC = comps.find((c) => String(c.type).toUpperCase() === "BODY")
  const body  = (bodyC?.text as string) ?? ""
  const vars  = parseVars(body)
  const btnC  = comps.find((c) => String(c.type).toUpperCase() === "BUTTONS")
  const btns  = (btnC?.buttons as Array<{ type?: string }> | undefined) ?? []
  // Índices REAIS dos quick-reply (um URL/Phone antes deslocaria o payload se assumíssemos 0/1).
  const quickReplyIdx = btns
    .map((b, i) => (String(b.type).toUpperCase() === "QUICK_REPLY" ? i : -1))
    .filter((i) => i >= 0)
  return {
    name: row.name, language: row.language, body,
    varKeys: vars.map((v) => v.key), named: vars.some((v) => v.named),
    quickReplies: quickReplyIdx.length, quickReplyIdx,
    koraCategory: row.kora_category,
  }
}

/** Templates APROVADOS do tenant pro seletor do lembrete (com forma p/ avisos na UI). */
export async function listApprovedTemplates(tenantId: string): Promise<ApprovedTemplateOption[]> {
  const { data } = await supabaseAdmin.from("wa_templates")
    .select("name, language, components, kora_category")
    .eq("tenant_id", tenantId).eq("status", "APPROVED")
  return (data ?? []).map((r) => toTemplateOption(r as never)).sort((a, b) => a.name.localeCompare(b.name))
}

/** Resolve um template SE ainda aprovado (gate fail-closed no envio). */
async function resolveApprovedTemplate(tenantId: string, name: string): Promise<ApprovedTemplateOption | null> {
  const { data } = await supabaseAdmin.from("wa_templates")
    .select("name, language, components, kora_category")
    .eq("tenant_id", tenantId).eq("name", name).eq("status", "APPROVED").maybeSingle()
  return data ? toTemplateOption(data as never) : null
}

// Casa a variável do template escolhido com o valor do agendamento (nome/serviço/data/hora).
function agendaValueFor(key: string, vars: Record<string, string>): string {
  const k = key.toLowerCase()
  if (/nome|contato|cliente/.test(k))            return vars.nome || "você"
  if (/servico|serviço|atendimento/.test(k))     return vars.servico || "seu atendimento"
  if (/data|dia/.test(k))                        return vars.data || "—"
  if (/hora/.test(k))                            return vars.hora || "—"
  if (/recurso|profissional/.test(k))            return vars.recurso || ""
  return vars[key] ?? ""
}
function buildBodyParams(opt: ApprovedTemplateOption, vars: Record<string, string>): Array<{ paramName?: string; text: string }> {
  return opt.varKeys.map((k) => opt.named ? { paramName: k, text: agendaValueFor(k, vars) } : { text: agendaValueFor(k, vars) })
}
function buildButtonParams(opt: ApprovedTemplateOption, apptId: string): Array<{ subType: "quick_reply"; index: number; payload: string }> {
  const out: Array<{ subType: "quick_reply"; index: number; payload: string }> = []
  const [i0, i1] = opt.quickReplyIdx
  if (i0 !== undefined) out.push({ subType: "quick_reply", index: i0, payload: `agenda:confirm:${apptId}` })
  if (i1 !== undefined) out.push({ subType: "quick_reply", index: i1, payload: `agenda:resched:${apptId}` })
  return out
}

interface ConfirmSendArgs {
  tenantId: string
  instance: ProviderInstance
  phone: string
  apptId: string
  vars: Record<string, string>
  anchorText:   string   // corpo do botão nativo (Meta) — sem menu numerado
  numberedText: string   // texto do Baileys — com menu numerado
  inWindow: boolean
  templateName?: string | null   // template escolhido pelo tenant (fora da janela). Vazio = do sistema.
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
  if (!provider.sendTemplate) return { degraded: "instância oficial sem suporte a template" }

  // 1) Template ESCOLHIDO pelo tenant (≠ sistema, se ainda aprovado) tem prioridade; params/
  //    botões montados da estrutura real dele. O template do SISTEMA NUNCA entra aqui — ele é
  //    auto-semeado sem `components` no cache, então cai no caminho seguro abaixo (params fixos).
  const chosen = (args.templateName && args.templateName !== AGENDA_CONFIRM_TEMPLATE)
    ? await resolveApprovedTemplate(args.tenantId, args.templateName)
    : null
  if (chosen) {
    const r = await provider.sendTemplate(
      args.phone, chosen.name, chosen.language,
      buildBodyParams(chosen, args.vars),
      buildButtonParams(chosen, args.apptId),
    )
    return { messageId: r.messageId || null, displayText: args.anchorText }
  }

  const name = await approvedConfirmTemplate(args.tenantId)
  if (!name) {
    await ensureAgendaConfirmTemplate(args.tenantId)
    return { degraded: "template de confirmação fora da janela 24h ainda não aprovado" }
  }
  const r = await provider.sendTemplate(
    args.phone, name, AGENDA_TEMPLATE_LANG,
    [
      { paramName: "nome",    text: args.vars.nome || "você" },
      { paramName: "servico", text: args.vars.servico || "seu atendimento" },
      { paramName: "data",    text: args.vars.data || "—" },
      { paramName: "hora",    text: args.vars.hora || "—" },
    ],
    [
      { subType: "quick_reply", index: 0, payload: `agenda:confirm:${args.apptId}` },
      { subType: "quick_reply", index: 1, payload: `agenda:resched:${args.apptId}` },
    ],
  )
  return { messageId: r.messageId || null, displayText: args.anchorText }
}
