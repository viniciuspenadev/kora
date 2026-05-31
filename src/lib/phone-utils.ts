/**
 * Utilitários de telefone/JID — provider-agnostic.
 */

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js"

/** Extrai número limpo de um WhatsApp JID (ex: "5511999@s.whatsapp.net" → "5511999"). */
export function jidToPhone(jid: string): string {
  return jid.split("@")[0].replace(/\D/g, "")
}

/** Converte número em JID padrão WhatsApp (`5511999@s.whatsapp.net`). */
export function phoneToJid(phone: string): string {
  const clean = phone.replace(/\D/g, "")
  return `${clean}@s.whatsapp.net`
}

/**
 * Normaliza um telefone digitado livremente pro formato canônico E.164 (dígitos
 * com DDI, sem '+') — o formato do JID do WhatsApp. World-ready via libphonenumber:
 *
 * - Se o número vier com DDI explícito (`+1 415…`, `+351 912…`), respeita o país.
 * - Se vier local (DDD+número), assume `defaultCountry` (país-base do tenant).
 * - Valida; formato implausível → null (não grava lixo).
 *
 * É o que torna o telefone coletado pela IA (cliente digita só local)
 * (a) enviável no WhatsApp e (b) comparável no match-por-telefone (Fase 2),
 * que casa contra o JID — que sempre vem com DDI.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry: string = "BR"): string | null {
  if (!raw) return null
  const parsed = parsePhoneNumberFromString(raw, defaultCountry.toUpperCase() as CountryCode)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number.replace("+", "")   // E.164 sem '+' → só dígitos, pro JID
}

/** Formata número para exibição: +55 (11) 99999-9999. Vazio/null → "" (contato sem telefone, ex: site-chat). */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return `+${digits}`
}
