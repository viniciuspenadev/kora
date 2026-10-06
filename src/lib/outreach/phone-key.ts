// Chave de comparação de número do livro de disparos (outreach_log) — PURA, sem banco.
// Mora fora de `guard.ts` para a LGPD (lgpd.ts) achar as linhas do titular sem carregar
// a trava inteira (notificações, push). Uma regra só: o Disparar grava com ela e a LGPD
// procura com ela.

import { normalizePhone } from "@/lib/phone-utils"

/**
 * Celular BR com e sem o 9º dígito é a mesma pessoa. Recebe o E.164 sem "+" (saída de
 * `normalizePhone`). Fixo e local de propósito — a trava compara número com número;
 * identidade de contato é outro assunto.
 *
 * Só o celular BR de 13 dígitos com o 9 depois do DDD perde o 9 (5547998124471 →
 * 554798124471). Fixo (começa em 2–5) e número de fora passam iguais.
 */
export function outreachPhoneKey(e164: string): string {
  const digits = e164.replace(/\D/g, "")
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
    return digits.slice(0, 4) + digits.slice(5)
  }
  return digits
}

/**
 * As chaves de TODOS os telefones de um contato — para a LGPD achar no livro o que é do
 * titular (o livro guarda o número, não o contato). Normaliza do mesmo jeito que o
 * Disparar normaliza antes de reservar (`normalizePhone` com o país do tenant); o JID só
 * conta quando é número (`@s.whatsapp.net`) — `@lid` não é telefone.
 */
export function outreachKeysForContact(
  contact: { phone_number?: string | null; whatsapp_id?: string | null; phone_secondary?: string | null },
  defaultCountry = "BR",
): string[] {
  const raw = [
    contact.phone_number,
    contact.phone_secondary,
    contact.whatsapp_id?.endsWith("@s.whatsapp.net") ? contact.whatsapp_id.split("@")[0] : null,
  ]
  const keys = new Set<string>()
  for (const value of raw) {
    const e164 = value ? normalizePhone(value, defaultCountry) : null
    if (e164) keys.add(outreachPhoneKey(e164))
  }
  return [...keys]
}
