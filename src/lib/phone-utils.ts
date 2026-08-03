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
 * Identidade de WhatsApp 1:1 devolvida pelo PROVEDOR — ou `null`.
 *
 * 🔴 POR QUE ISTO EXISTE. Telefone é DESTINO; identidade é o que a rede responde. Mandar
 *    mensagem pra um número digitado funciona (o WhatsApp resolve sozinho), mas guardar o
 *    número digitado COMO identidade é palpite: `5543984994692` e `554384994692` são a
 *    mesma conta pro WhatsApp, e a linha só sabe qual das duas ela é quando a rede diz.
 *    Foi assim que um lead virou dois contatos e duas conversas em produção (02/08).
 *
 * ⚠️ RECUSA `@lid` E `@g.us` de propósito:
 *    • `@lid` é o identificador NOVO da Meta e é opaco — não tem relação aritmética com
 *      telefone nenhum. Gravá-lo em `whatsapp_id` (que o inbound 1:1 compara contra
 *      `@s.whatsapp.net`) trocaria um tipo de duplicado por outro. Ele é identidade
 *      legítima, só não é DESTE eixo — quando for hora, ganha canal próprio.
 *    • `@g.us` é grupo, e o JID de grupo antigo **contém um telefone real dentro**
 *      (o de quem criou), então tratá-lo como pessoa casa com o contato errado.
 *
 * Aceita tanto o JID completo do Baileys (`key.remoteJid`) quanto os dígitos crus que a
 * Cloud API devolve (`contacts[0].wa_id`).
 */
export function canonicalWhatsAppJid(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null
  if (v.includes("@")) {
    if (!v.endsWith("@s.whatsapp.net")) return null      // @lid, @g.us, @broadcast…
    const digits = v.split("@")[0].replace(/\D/g, "")
    return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null
  }
  const digits = v.replace(/\D/g, "")                    // wa_id da Cloud API vem cru
  return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null
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

/**
 * Telefone → { phone (dígitos E.164 c/ DDI), jid } no formato do WhatsApp — dedup-safe.
 * Usa libphonenumber: respeita `+DDI` (exterior, ex: +1 EUA) e só assume BR como default
 * quando não há código de país. NUNCA força 55 cegamente.
 */
export function normalizeWhatsAppPhone(input: string | null | undefined, defaultCountry = "BR"): { phone: string; jid: string } | null {
  const digits = normalizePhone(input, defaultCountry)
  if (!digits) return null
  return { phone: digits, jid: `${digits}@s.whatsapp.net` }
}

/**
 * Formata número para exibição. World-ready:
 * - BR (13/12 díg começando com 55): mantém o formato com parênteses — padrão do app.
 * - Estrangeiro / formato incomum: libphonenumber formata corretamente (+1 415 555-2671).
 * Vazio/null → "" (contato sem telefone, ex: site-chat).
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  const parsed = parsePhoneNumberFromString(`+${digits}`)
  if (parsed?.isValid()) return parsed.formatInternational()
  return `+${digits}`
}
