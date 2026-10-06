import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { reachableContactIds, seesAllContacts, type ViewerScope } from "@/lib/visibility"

type Contact = { id: string; whatsapp_id: string | null; phone_number: string | null; custom_name: string | null; push_name: string | null }
export type ParticipantContact = { contact: { id: string; name: string } | null; contactAmbiguous: boolean }
const columns = "id,whatsapp_id,phone_number,custom_name,push_name"

/** Read-only recognition. Never infer a phone from LID or add/remove a Brazilian ninth digit. */
export async function matchGroupParticipantContacts(scope: ViewerScope, phones: string[]): Promise<Map<string, ParticipantContact>> {
  const unique = [...new Set(phones.filter(phone => /^\d{8,15}$/.test(phone)))]
  const result = new Map<string, ParticipantContact>()
  if (!unique.length) return result
  const reachable = seesAllContacts(scope) ? null : new Set(await reachableContactIds(scope))
  if (reachable?.size === 0) return result
  // Bounded queries rather than one request per participant or a full contact-base scan.
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100)
    const jids = batch.map(phone => `${phone}@s.whatsapp.net`)
    const [primary, identities, byPhone] = await Promise.all([
      supabaseAdmin.from("chat_contacts").select(columns).eq("tenant_id", scope.tenantId).in("whatsapp_id", jids),
      supabaseAdmin.from("contact_identities").select("contact_id,external_id").eq("tenant_id", scope.tenantId).eq("channel", "whatsapp").in("external_id", jids),
      supabaseAdmin.from("chat_contacts").select(columns).eq("tenant_id", scope.tenantId).in("phone_number", batch),
    ])
    if (primary.error || identities.error || byPhone.error) throw new Error("Não foi possível conferir os contatos cadastrados")
    const contacts = new Map<string, Contact>()
    for (const contact of [...(primary.data ?? []), ...(byPhone.data ?? [])] as Contact[]) contacts.set(contact.id, contact)
    const missingIds = [...new Set((identities.data ?? []).map(row => row.contact_id as string))]
      .filter(id => !contacts.has(id) && (!reachable || reachable.has(id)))
    for (let start = 0; start < missingIds.length; start += 100) {
      const aliases = await supabaseAdmin.from("chat_contacts").select(columns).eq("tenant_id", scope.tenantId).in("id", missingIds.slice(start, start + 100))
      if (aliases.error) throw new Error("Não foi possível conferir os contatos cadastrados")
      for (const contact of (aliases.data ?? []) as Contact[]) contacts.set(contact.id, contact)
    }
    for (const phone of batch) {
      const jid = `${phone}@s.whatsapp.net`
      const identityIds = new Set((identities.data ?? []).filter(row => row.external_id === jid).map(row => row.contact_id))
      const visible = [...contacts.values()].filter(contact => !reachable || reachable.has(contact.id))
      const exact = visible.filter(contact => contact.whatsapp_id === jid || identityIds.has(contact.id))
      // A canonical/merged identity takes precedence over a secondary phone field.
      const hasCanonical = identityIds.size > 0 || [...contacts.values()].some(contact => contact.whatsapp_id === jid)
      const matches = hasCanonical ? exact : visible.filter(contact => contact.phone_number === phone)
      const contact = matches.length === 1 ? matches[0] : null
      result.set(phone, { contact: contact ? { id: contact.id, name: contact.custom_name?.trim() || contact.push_name?.trim() || phone } : null,
        contactAmbiguous: matches.length > 1 })
    }
  }
  return result
}
