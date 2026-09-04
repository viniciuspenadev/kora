// ═══════════════════════════════════════════════════════════════
// Capacidade: capturar identidade do cliente (side-effect)
// ═══════════════════════════════════════════════════════════════
// Grava em colunas REAIS do contato. Só PREENCHE phone/doc quando vazio
// (não sobrescreve WhatsApp real nem identidade legal). Devolve toolMessage
// pro agente reconhecer e seguir o atendimento (não fica mudo).
//
// O mapeamento coluna→normalização mora em applyContactCapture (fonte ÚNICA),
// reusado pela tool da IA (aqui) E pelo nó Coletar determinístico (via mapTo).
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { normalizePhone, phoneToJid } from "@/lib/phone-utils"
import type { ExecCtx } from "./types"

export const UPDATE_CONTACT = "update_contact"

interface UpdateArgs {
  name:      string | null
  phone:     string | null
  email:     string | null
  document:  string | null
  company:   string | null
  birthdate: string | null
}

function normalizeBirthdate(raw: string): string | null {
  const s = raw.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

/** Campos que o nó Coletar pode mapear pro cadastro (config `mapTo`). */
export type ContactMapField = "name" | "phone" | "email" | "document" | "company" | "birthdate"

/**
 * Aplica os dados de identidade capturados nas COLUNAS REAIS do contato. Fonte
 * ÚNICA do mapeamento — reusada pela tool da IA (update_contact) E pelo nó
 * Coletar (mapTo). Guardas: phone/doc só preenchem se VAZIOS (não sobrescreve
 * WhatsApp/identidade legal); e-mail validado; nome/empresa truncados;
 * nascimento normalizado. Retorna as colunas efetivamente escritas ({} = nada
 * novo). NÃO insere nota nem toca identidade/merge — só as colunas. Lança em
 * erro de banco (o chamador decide se é fatal ou best-effort).
 */
export interface CapturaResultado {
  /** Colunas efetivamente escritas no cadastro. `{}` = nada novo. */
  campos: Record<string, string>
  /**
   * Outra ficha do tenant que JÁ é dona do telefone informado — ou `null`.
   *
   * ⚠️ Vive fora de `campos` de propósito. Na primeira versão eu devolvi isto junto das
   *    colunas capturadas, e ele ia parar na nota "📇 Dados capturados pela IA" que o
   *    ATENDENTE lê, como se fosse um campo do cadastro. Sinal de controle não viaja no
   *    mesmo saco que dado do cliente.
   */
  outroContato: string | null
}

export async function applyContactCapture(
  ctx: ExecCtx, parsed: UpdateArgs, opts: { trusted?: boolean } = {},
): Promise<CapturaResultado> {
  const { tenantId, contact } = ctx
  // `trusted` = o AUTOR do fluxo mapeou o campo (nó Coletar) → pode setar/sobrescrever.
  // SEM trusted (tool `update_contact`, o LLM INFERIU) → só ENRIQUECE campo vazio, nunca
  // sobrescreve identidade já existente: uma frase do cliente ("falo pelo Dr Renan") não
  // pode corromper o cadastro. Phone/doc são sempre só-se-vazio (identidade sensível).
  const guard = !opts.trusted
  const updates: Record<string, string> = {}
  /** Id de OUTRA ficha que já é dona deste telefone (ver `donoDoNumero`). */
  let outroContato: string | null = null
  // Nome: com guarda, só preenche se o contato NÃO tem nome NENHUM (nem custom_name nem
  // o push_name do WhatsApp) — senão a IA trocaria "Vinicius" (que vinha do push_name).
  if (parsed.name && (!guard || (!contact.custom_name?.trim() && !contact.push_name?.trim())))
    updates.custom_name = parsed.name.slice(0, 120)
  if (parsed.phone && !contact.phone_number?.trim()) {
    const { data: tc } = await supabaseAdmin
      .from("tenant_config").select("default_country").eq("tenant_id", tenantId).maybeSingle()
    const normalized = normalizePhone(parsed.phone, tc?.default_country ?? "BR")
    if (normalized) {
      updates.phone_number = normalized
      // 🔴 O NÚMERO JÁ É DE ALGUÉM AQUI? Esta pergunta nunca era feita, e é o furo-raiz.
      //    Em 30/07 um cliente que já estava na base voltou pelo widget: o telefone foi
      //    gravado no visitante anônimo, o nó Disparar mirou nele, e a pessoa terminou com
      //    DUAS fichas e DOIS fios de WhatsApp abertos. O 9º dígito é um caso particular
      //    disto — lá nem a grafia batia; aqui batia exatamente e mesmo assim duplicou.
      outroContato = await donoDoNumero(tenantId, contact.id, normalized)
    }
  }
  if (parsed.email && (!guard || !contact.email?.trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email))
    updates.email = parsed.email.slice(0, 254)
  if (parsed.document && !contact.doc_id?.trim()) {
    const digits = parsed.document.replace(/\D/g, "")
    if (digits.length === 11 || digits.length === 14) updates.doc_id = digits
  }
  if (parsed.company && (!guard || !contact.company?.trim()))
    updates.company = parsed.company.slice(0, 120)
  if (parsed.birthdate && (!guard || !contact.birth_date?.trim())) {
    const iso = normalizeBirthdate(parsed.birthdate)
    if (iso) updates.birth_date = iso
  }
  if (Object.keys(updates).length === 0) return { campos: {}, outroContato }

  const { error } = await supabaseAdmin
    .from("chat_contacts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", contact.id)
    .eq("tenant_id", tenantId)
  if (error) throw new Error(`applyContactCapture: ${error.message}`)
  return { campos: updates, outroContato }
}

/**
 * De quem é este número? Devolve o id de OUTRA ficha do tenant que já tem esta linha —
 * ou `null`.
 *
 * 🔴 BUSCA PELO JID, NÃO PELO TELEFONE, e a diferença é tudo. `whatsapp_id` tem chave
 *    ÚNICA: o JID construído a partir do que a pessoa digitou pode **não achar ninguém**
 *    (é palpite incompleto — o caso do 9º dígito), mas ele nunca aponta pra pessoa
 *    ERRADA. Por isso LER com o palpite é legítimo, enquanto GRAVAR o palpite não é.
 *    `phone_number` não serve: não tem unique, dois contatos podem repetir, e casar por
 *    ele seria heurística.
 *
 * ⚠️ Só CONSULTA. Não funde, não apaga, não escreve — quem decide o que fazer com a
 *    resposta é o fluxo. Fusão automática dentro de turno em execução foi descartada:
 *    é `delete` irreversível, e número reciclado, telefone de recepção e "manda pro
 *    WhatsApp do meu marido" emitem exatamente o mesmo sinal do caso legítimo.
 */
async function donoDoNumero(tenantId: string, contatoAtual: string, telefone: string): Promise<string | null> {
  try {
    const jid = phoneToJid(telefone)
    const { data } = await supabaseAdmin.from("chat_contacts")
      .select("id").eq("tenant_id", tenantId).eq("whatsapp_id", jid).maybeSingle()
    const achado = (data as { id: string } | null)?.id ?? null
    return achado && achado !== contatoAtual ? achado : null
  } catch (e) {
    console.error("[donoDoNumero]", (e as Error)?.message ?? e)
    return null            // consulta é enriquecimento: falhar aqui nunca derruba a captura
  }
}

/** Captura UM campo do nó Coletar (mapTo) no cadastro — wrapper de 1 campo do
 *  applyContactCapture. O runtime chama e trata como best-effort. */
export function captureContactField(ctx: ExecCtx, field: ContactMapField, value: string): Promise<CapturaResultado> {
  const args: UpdateArgs = { name: null, phone: null, email: null, document: null, company: null, birthdate: null }
  args[field] = value
  // trusted: o autor do fluxo mapeou explicitamente ESTE campo no nó Coletar → seta.
  return applyContactCapture(ctx, args, { trusted: true })
}

export const updateContactCapability = defineCapability<UpdateArgs>({
  id:           UPDATE_CONTACT,
  name:         "Capturar dados do contato",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       false,   // reuso via applyContactCapture; não é nó do builder
  toolSchema: {
    type: "function",
    function: {
      name:        UPDATE_CONTACT,
      description:
        "Salve no cadastro os dados de identificação que o cliente informar (nome, WhatsApp, e-mail, CPF/CNPJ, empresa, nascimento). " +
        "Chame assim que souber qualquer um. Inclua só o que você tem; não invente nem pergunte de novo o que já está salvo.",
      parameters: {
        type: "object",
        properties: {
          name:      { type: "string", description: "Nome do contato." },
          phone:     { type: "string", description: "WhatsApp/telefone com DDD." },
          email:     { type: "string", description: "E-mail." },
          document:  { type: "string", description: "CPF ou CNPJ." },
          company:   { type: "string", description: "Empresa." },
          birthdate: { type: "string", description: "Nascimento AAAA-MM-DD." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  playbook: () =>
    "DADOS DO CONTATO: assim que o cliente informar nome, telefone, e-mail, CPF/CNPJ, empresa ou nascimento, " +
    "registre na hora com update_contact. Não pergunte de novo o que já está salvo.",
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
    return {
      name: str(p.name), phone: str(p.phone), email: str(p.email),
      document: str(p.document), company: str(p.company), birthdate: str(p.birthdate),
    }
  },
  execute: async (ctx, parsed) => {
    let res: CapturaResultado
    try {
      res = await applyContactCapture(ctx, parsed)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "update_contact falhou" }
    }
    const updates = res.campos
    // ⚠️ A IA também pode capturar um telefone que já é de outra ficha — mesmo furo do nó
    //    Coletar. Aqui só REGISTRA: trocar o contato no meio de um turno de IA exige as
    //    variáveis do fluxo, que esta camada não enxerga. Follow-up honesto, não silêncio.
    if (res.outroContato) {
      console.log(JSON.stringify({ event: "telefone_de_outra_ficha", origem: "tool_ia",
        tenantId: ctx.tenantId, contatoAtual: ctx.contact.id, outroContato: res.outroContato }))
    }
    if (Object.keys(updates).length === 0) return { ok: true, toolMessage: "Nada novo a salvar." }

    const parts = Object.entries(updates).map(([k, v]) => `${k}: ${v}`)
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: ctx.conversationId,
      tenant_id:       ctx.tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         `📇 Dados capturados pela IA — ${parts.join(" · ")}`,
      status:          "sent",
      is_private_note: true,
      metadata:        { ai_contact_update: true, studio: true, fields: updates },
    })
    return { ok: true, toolMessage: `Dados registrados (${parts.join(", ")}). Agradeça e siga o atendimento.` }
  },
})
