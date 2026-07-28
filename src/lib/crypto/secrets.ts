import crypto from "crypto"

/**
 * Cifragem de segredos em repouso (AES-256-GCM) — só pros tokens de API que o app
 * consome e nenhuma integração externa enxerga (Meta/Evolution). Ver docs/security.md.
 *
 * Modelo:
 *   - Chave mestra `ENCRYPTION_KEY` (32 bytes base64) vive SÓ no env do servidor.
 *   - Valor cifrado carrega o prefixo `enc:v1:` → `enc:v1:base64(iv|tag|ciphertext)`.
 *   - **Dual-read**: valor sem prefixo é texto puro legado → passa direto. Isso torna
 *     a transição (deploy → backfill) zero-downtime.
 *   - **No-op sem chave**: se `ENCRYPTION_KEY` não estiver setada, encrypt/decrypt
 *     viram passthrough. Permite deployar o código SEM mudar nada (kill-switch).
 *
 * ⚠️ Perder a ENCRYPTION_KEY = perder o que foi cifrado. Guardar fora do banco
 *    (gerenciador de senhas) + no env do EasyPanel.
 */

const PREFIX = "enc:v1:"
const ALGO   = "aes-256-gcm"

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null
  try {
    const key = Buffer.from(raw, "base64")
    if (key.length !== 32) {
      console.error("[secrets] ENCRYPTION_KEY inválida — precisa ser 32 bytes em base64. Cifragem desativada.")
      return null
    }
    return key
  } catch {
    console.error("[secrets] ENCRYPTION_KEY não é base64 válido. Cifragem desativada.")
    return null
  }
}

/** Cifra um segredo. Sem chave → devolve o texto puro (no-op). Já cifrado → idempotente. */
export function encryptSecret<T extends string | null | undefined>(plain: T): T {
  if (plain == null || plain === "") return plain
  if ((plain as string).startsWith(PREFIX)) return plain     // já cifrado
  const key = getKey()
  if (!key) return plain                                      // no-op sem chave
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct     = Buffer.concat([cipher.update(plain as string, "utf8"), cipher.final()])
  const tag    = cipher.getAuthTag()
  return (PREFIX + Buffer.concat([iv, tag, ct]).toString("base64")) as T
}

/** Decifra. Texto puro (legado) passa direto; falha de decifra devolve o valor como veio (fail-safe). */
export function decryptSecret<T extends string | null | undefined>(value: T): T {
  if (value == null || value === "") return value
  if (!(value as string).startsWith(PREFIX)) return value    // texto puro legado → passthrough
  const key = getKey()
  if (!key) return value                                      // sem chave: não decifra, mas não crasha
  try {
    const buf       = Buffer.from((value as string).slice(PREFIX.length), "base64")
    const iv        = buf.subarray(0, 12)
    const tag       = buf.subarray(12, 28)
    const ct        = buf.subarray(28)
    const decipher  = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8") as T
  } catch {
    return value
  }
}

/** True se a ENCRYPTION_KEY está válida e a cifragem está ativa. */
export function isEncryptionEnabled(): boolean {
  return getKey() !== null
}
