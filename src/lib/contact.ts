import { formatPhoneDisplay } from "@/lib/phone-utils"

/**
 * Source-of-truth da exibição do nome do contato.
 * Ordem: nome editado pelo atendente → push_name do WhatsApp → telefone formatado.
 *
 * Use em TODO lugar que mostra nome de contato (conversation-list, chat-panel,
 * sidebar, kanban, contatos list). Garante consistência.
 */
export function displayContactName(contact: {
  custom_name?:  string | null
  push_name?:    string | null
  phone_number?: string | null
}): string {
  if (contact.custom_name?.trim())  return contact.custom_name.trim()
  if (contact.push_name?.trim())    return contact.push_name.trim()
  if (contact.phone_number)         return formatPhoneDisplay(contact.phone_number)
  return "Sem nome"
}

/** Primeira letra pra avatar inicial (sem caracteres estranhos). */
export function displayContactInitial(contact: {
  custom_name?:  string | null
  push_name?:    string | null
  phone_number?: string | null
}): string {
  const name = displayContactName(contact)
  return name[0]?.toUpperCase() ?? "?"
}
