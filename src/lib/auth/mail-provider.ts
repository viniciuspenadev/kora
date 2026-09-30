// Atalho "Abrir o Gmail" na tela do código: leva direto à caixa onde o código chegou.
// Só para provedores reconhecíveis pelo DOMÍNIO — e-mail de empresa (Google Workspace, Microsoft 365
// no domínio próprio) não dá para saber, e aí o botão não aparece (melhor nenhum atalho que um errado).
// Endereços fixos daqui; o e-mail da pessoa só entra codificado, no Gmail, para abrir a conta certa.

export type MailProvider = { name: string; url: string }

const GMAIL = new Set(["gmail.com", "googlemail.com"])
const OUTLOOK = new Set(["outlook.com", "outlook.com.br", "hotmail.com", "hotmail.com.br", "live.com", "live.com.br", "msn.com"])
const YAHOO = new Set(["yahoo.com", "yahoo.com.br", "ymail.com"])
const ICLOUD = new Set(["icloud.com", "me.com", "mac.com"])

// Busca que inclui spam/lixeira ("in:anywhere") e só o último dia — o código da Kora aparece no topo.
const GMAIL_SEARCH = encodeURIComponent("in:anywhere newer_than:1d Kora").replace(/%20/g, "+")

export function mailProviderFor(emailRaw: string): MailProvider | null {
  const email = String(emailRaw ?? "").trim().toLowerCase()
  const at = email.lastIndexOf("@")
  if (at < 1 || at === email.length - 1) return null
  const domain = email.slice(at + 1)

  if (GMAIL.has(domain)) {
    return { name: "Gmail", url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#search/${GMAIL_SEARCH}` }
  }
  if (OUTLOOK.has(domain)) return { name: "Outlook", url: "https://outlook.live.com/mail/0/" }
  if (YAHOO.has(domain)) return { name: "Yahoo Mail", url: "https://mail.yahoo.com/" }
  if (ICLOUD.has(domain)) return { name: "iCloud Mail", url: "https://www.icloud.com/mail" }
  return null
}
