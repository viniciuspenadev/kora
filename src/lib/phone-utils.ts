/**
 * Utilitários de telefone/JID — provider-agnostic.
 */

/** Extrai número limpo de um WhatsApp JID (ex: "5511999@s.whatsapp.net" → "5511999"). */
export function jidToPhone(jid: string): string {
  return jid.split("@")[0].replace(/\D/g, "")
}

/** Converte número em JID padrão WhatsApp (`5511999@s.whatsapp.net`). */
export function phoneToJid(phone: string): string {
  const clean = phone.replace(/\D/g, "")
  return `${clean}@s.whatsapp.net`
}

/** Formata número para exibição: +55 (11) 99999-9999 */
export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return `+${digits}`
}
