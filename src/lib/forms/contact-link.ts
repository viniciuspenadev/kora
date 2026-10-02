import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import type { Answers, FormDefinition, LocationAnswer } from "./definition"

// ═══════════════════════════════════════════════════════════════
// Kora Formulários — a resposta encontra a FICHA (docs/forms-design.md §4.4 + S7)
// ═══════════════════════════════════════════════════════════════
// 1. Acha o contato SÓ PELO TELEFONE (com e sem o 9º dígito; nunca por e-mail — quem digita o
//    e-mail de um cliente seu não cola a resposta na ficha dele).
// 2. Ficha nova nasce com o telefone, o nome digitado e `source='webform'`.
// 3. Ficha existente: campo VAZIO preenche; campo com OUTRO valor não troca — vira sugestão
//    (`contact_conflicts` no comprovante). Nome à vista (o do WhatsApp ou o salvo) nunca muda.
// 4. Aceite de serviço carimba `consent_at` só se a ficha não tinha. Novidades: só liga se a
//    caixa foi marcada e a ficha nunca disse nada — "não quero" já gravado vence sempre.
// Quem chama já resolveu a empresa pelo `public_id` no servidor (nada vem do navegador).

export interface ContactConflict { field: string; current: string; proposed: string }

const COLS = "id, whatsapp_id, phone_number, custom_name, push_name, email, birth_date, doc_id, company, address_cep, address_city, address_district, consent_at, marketing_opt_in, updated_at"

type ContactRow = {
  id: string; whatsapp_id: string | null; phone_number: string | null; custom_name: string | null; push_name: string | null
  email: string | null; birth_date: string | null; doc_id: string | null; company: string | null
  address_cep: string | null; address_city: string | null; address_district: string | null
  consent_at: string | null; marketing_opt_in: boolean | null; updated_at: string | null
}

/** O mesmo celular BR com e sem o 9º dígito (as duas grafias existem na base e na rede). */
export function phoneVariants(e164: string): string[] {
  const d = e164.replace(/\D/g, "")
  const out = new Set([d])
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") out.add(d.slice(0, 4) + d.slice(5))
  if (d.length === 12 && d.startsWith("55") && /[6-9]/.test(d[4])) out.add(`${d.slice(0, 4)}9${d.slice(4)}`)
  return [...out]
}

async function findByPhone(tenantId: string, e164: string): Promise<ContactRow[]> {
  const phones = phoneVariants(e164)
  const jids = phones.map((p) => `${p}@s.whatsapp.net`)
  const [byJid, byPhone, byIdentity] = await Promise.all([
    supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).in("whatsapp_id", jids).limit(5),
    supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).in("phone_number", phones).limit(5),
    supabaseAdmin.from("contact_identities").select("contact_id").eq("tenant_id", tenantId).eq("channel", "whatsapp").in("external_id", jids).limit(5),
  ])
  const rows = new Map<string, ContactRow>()
  for (const r of [...((byJid.data ?? []) as ContactRow[]), ...((byPhone.data ?? []) as ContactRow[])]) rows.set(r.id, r)
  const extra = ((byIdentity.data ?? []) as { contact_id: string }[]).map((r) => r.contact_id).filter((id) => !rows.has(id))
  if (extra.length) {
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).in("id", extra)
    for (const r of (data ?? []) as ContactRow[]) rows.set(r.id, r)
  }
  // Quem tem a identidade de WhatsApp vem antes; depois o mais recente.
  return [...rows.values()].sort((a, b) =>
    Number(!!b.whatsapp_id && jids.includes(b.whatsapp_id)) - Number(!!a.whatsapp_id && jids.includes(a.whatsapp_id))
    || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR")

/** O que as respostas pedem para a ficha (só perguntas com destino "Contato"), já limpo. */
export function contactFieldsFrom(def: FormDefinition, answers: Answers): Partial<Record<"email" | "birth_date" | "doc_id" | "company" | "address_cep", string>> & { address?: LocationAnswer } {
  const out: ReturnType<typeof contactFieldsFrom> = {}
  for (const q of def.questions) {
    if (q.target.kind !== "contact") continue
    const v = answers[q.id]
    if (v === undefined || v === null) continue
    switch (q.target.field) {
      case "email":       if (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out.email = v.trim().toLowerCase(); break
      case "birth_date":  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out.birth_date = v; break
      case "doc_id":      { const d = typeof v === "string" ? v.replace(/\D/g, "") : ""; if (d.length === 11 || d.length === 14) out.doc_id = d; break }
      case "company":     if (typeof v === "string" && v.trim()) out.company = v.trim().slice(0, 120); break
      case "address_cep": { const d = typeof v === "string" ? v.replace(/\D/g, "") : ""; if (d.length === 8) out.address_cep = d; break }
      case "address":     if (typeof v === "object" && !Array.isArray(v) && (v.city || v.district)) out.address = { city: v.city.trim(), district: v.district.trim() }; break
    }
  }
  return out
}

/**
 * O que gravar na ficha e o que vira sugestão (puro — o banco fica com quem chama).
 * `created` = a ficha acabou de nascer deste envio (o nome já entrou na criação).
 */
export function planContactWrite(row: ContactRow, input: {
  name: string; fields: ReturnType<typeof contactFieldsFrom>; marketingChecked: boolean; at: string
}): { patch: Record<string, unknown>; conflicts: ContactConflict[] } {
  const patch: Record<string, unknown> = {}
  const conflicts: ContactConflict[] = []
  const shownName = row.custom_name?.trim() || row.push_name?.trim() || ""
  if (!shownName) patch.custom_name = input.name
  else if (!same(shownName, input.name)) conflicts.push({ field: "name", current: shownName, proposed: input.name })

  for (const k of ["email", "birth_date", "doc_id", "company", "address_cep"] as const) {
    const v = input.fields[k]
    if (!v) continue
    const cur = row[k]?.toString().trim() ?? ""
    if (!cur) patch[k] = v
    else if (!same(cur, v)) conflicts.push({ field: k, current: cur, proposed: v })
  }
  const addr = input.fields.address
  if (addr) {
    const cur = [row.address_city, row.address_district].map((s) => s?.trim() ?? "")
    if (!cur[0] && !cur[1]) {
      if (addr.city) patch.address_city = addr.city
      if (addr.district) patch.address_district = addr.district
    } else if (!same(cur.join(" · "), [addr.city, addr.district].join(" · "))) {
      conflicts.push({ field: "address", current: cur.filter(Boolean).join(" · "), proposed: [addr.city, addr.district].filter(Boolean).join(" · ") })
    }
  }
  if (!row.consent_at) { patch.consent_at = input.at; patch.consent_source = "form" }
  if (input.marketingChecked && row.marketing_opt_in === null) patch.marketing_opt_in = true
  return { patch, conflicts }
}

/**
 * Liga o comprovante à ficha. Best-effort por desenho: a resposta JÁ está gravada; se isto
 * falhar, ela fica sem ficha (e aparece assim em Respostas), nunca se perde.
 */
export async function linkSubmissionContact(input: {
  tenantId: string; submissionId: string; def: FormDefinition; answers: Answers
  name: string; phoneE164: string; marketingChecked: boolean; at: string
}): Promise<{ contactId: string; created: boolean; conflicts: ContactConflict[] }> {
  const { tenantId } = input
  const found = await findByPhone(tenantId, input.phoneE164)
  let row: ContactRow | null = found[0] ?? null
  let created = false
  const conflicts: ContactConflict[] = []
  if (found.length > 1) conflicts.push({ field: "duplicate_contacts", current: String(found.length), proposed: found[0].id })

  if (!row) {
    // Ficha nova. O `whatsapp_id` é o PISO (o número digitado): a mesma regra do cadastro manual
    // e da importação; a identidade de verdade substitui quando a rede responder (Disparar).
    const r = await resolveOrCreateContact(tenantId,
      { jid: `${input.phoneE164}@s.whatsapp.net`, phone: input.phoneE164 },
      { customName: input.name, source: "webform", primaryChannel: "whatsapp" })
    created = r.created
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("id", r.id).maybeSingle()
    row = (data as ContactRow | null) ?? null
  }
  if (!row) throw new Error("contato criado não encontrado")

  const plan = planContactWrite(row, { name: input.name, fields: contactFieldsFrom(input.def, input.answers), marketingChecked: input.marketingChecked, at: input.at })
  if (Object.keys(plan.patch).length) {
    const { error } = await supabaseAdmin.from("chat_contacts").update({ ...plan.patch, updated_at: input.at })
      .eq("tenant_id", tenantId).eq("id", row.id)
    if (error) console.error("[forms contato] ficha não atualizada:", error.code, error.message)
  }
  conflicts.push(...plan.conflicts)

  const { error } = await supabaseAdmin.from("form_submissions").update({ contact_id: row.id, contact_conflicts: conflicts })
    .eq("tenant_id", tenantId).eq("id", input.submissionId)
  if (error) throw new Error(`vínculo não gravado: ${error.message}`)
  return { contactId: row.id, created, conflicts }
}
