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
  bsuid?:        string | null
}): string {
  if (contact.custom_name?.trim())  return contact.custom_name.trim()
  if (contact.push_name?.trim())    return contact.push_name.trim()
  if (contact.phone_number)         return formatPhoneDisplay(contact.phone_number)
  // Contato só-BSUID (cliente Meta que suprimiu o número): não há telefone pra mostrar.
  // Nunca exibir o BSUID cru (opaco/feio) — rótulo genérico até ganhar nome.
  if (contact.bsuid)                return "Cliente WhatsApp"
  return "Sem nome"
}

/** Primeira letra pra avatar inicial (sem caracteres estranhos). */
export function displayContactInitial(contact: {
  custom_name?:  string | null
  push_name?:    string | null
  phone_number?: string | null
  bsuid?:        string | null
}): string {
  const name = displayContactName(contact)
  // `name[0]` corta caracteres fora do BMP (emoji) no meio do surrogate pair,
  // gerando � e hydration mismatch entre o SSR e o browser. Array.from itera por
  // code point e mantém a inicial renderizável nos dois ambientes.
  return Array.from(name)[0]?.toLocaleUpperCase("pt-BR") ?? "?"
}
