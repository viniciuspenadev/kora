// ═══════════════════════════════════════════════════════════════
// Capacidade: capturar identidade do cliente (side-effect)
// ═══════════════════════════════════════════════════════════════
// Grava em colunas REAIS do contato. Só PREENCHE phone/doc quando vazio
// (não sobrescreve WhatsApp real nem identidade legal). Devolve toolMessage
// pro agente reconhecer e seguir o atendimento (não fica mudo).
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { normalizePhone } from "@/lib/phone-utils"

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

export const updateContactCapability = defineCapability<UpdateArgs>({
  id:           UPDATE_CONTACT,
  name:         "Capturar dados do contato",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       false,   // por enquanto só tool da IA (não nó do builder)
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
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
    return {
      name: str(p.name), phone: str(p.phone), email: str(p.email),
      document: str(p.document), company: str(p.company), birthdate: str(p.birthdate),
    }
  },
  execute: async (ctx, parsed) => {
    const { tenantId, conversationId, contact } = ctx
    const updates: Record<string, string> = {}
    if (parsed.name) updates.custom_name = parsed.name.slice(0, 120)
    if (parsed.phone && !contact.phone_number?.trim()) {
      const { data: tc } = await supabaseAdmin
        .from("tenant_config").select("default_country").eq("tenant_id", tenantId).maybeSingle()
      const normalized = normalizePhone(parsed.phone, tc?.default_country ?? "BR")
      if (normalized) updates.phone_number = normalized
    }
    if (parsed.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) updates.email = parsed.email.slice(0, 254)
    if (parsed.document && !contact.doc_id?.trim()) {
      const digits = parsed.document.replace(/\D/g, "")
      if (digits.length === 11 || digits.length === 14) updates.doc_id = digits
    }
    if (parsed.company) updates.company = parsed.company.slice(0, 120)
    if (parsed.birthdate) {
      const iso = normalizeBirthdate(parsed.birthdate)
      if (iso) updates.birth_date = iso
    }
    if (Object.keys(updates).length === 0) return { ok: true, toolMessage: "Nada novo a salvar." }

    const { error } = await supabaseAdmin
      .from("chat_contacts")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", contact.id)
      .eq("tenant_id", tenantId)
    if (error) return { ok: false, error: `update_contact: ${error.message}` }

    const parts = Object.entries(updates).map(([k, v]) => `${k}: ${v}`)
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
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
