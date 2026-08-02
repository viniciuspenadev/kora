import "server-only"
import crypto from "crypto"

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOKEN OPACO DA IMAGEM DE CARTÃO — o que vai na URL que a Meta busca
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **POR QUE ISTO EXISTE.** O `generic template` do Instagram exige `image_url` no
 *    elemento do card, e quem busca essa URL é o **servidor da Meta** — que não tem sessão
 *    nossa. Então a rota que serve a imagem não pode pedir login. O dono vetou bucket
 *    público (2026-08-01), então a saída é: bucket **privado** + rota nossa + um token que
 *    **não revela nada**.
 *
 * 🔴 **MEDIDO, NÃO SUPOSTO (2026-08-01):** a Meta **re-busca** a imagem do card na hora de
 *    renderizar — ela NÃO guarda cópia. Teste: card enviado, arquivo apagado 15 s depois,
 *    imagem sumiu do card. Duas consequências que este arquivo encarna:
 *      1. **O token NÃO expira.** URL com prazo faria o card perder a imagem em silêncio
 *         (o Instagram adapta o card e não mostra quebrado) — o cliente nunca saberia.
 *      2. **Apagar o arquivo É a revogação**, e funciona de verdade, inclusive nos cards
 *         já enviados. É o que dá dente a LGPD e a bloqueio de abuso.
 *
 * **Por que cifrado e não assinado:** assinatura protege contra adulteração mas deixa o
 * conteúdo legível — e o caminho carrega o `tenant_id`. Cifrando (AES-256-GCM), o token
 * é opaco E inviolável (a tag do GCM rejeita qualquer byte trocado). Ninguém descobre de
 * que cliente é a imagem, nem quantas existem, nem adivinha a próxima.
 *
 * ⚠️ Usa a mesma `ENCRYPTION_KEY` dos segredos (`lib/crypto/secrets.ts`). Sem ela o token
 *    não é emitido nem lido — **fail-closed**: melhor card sem imagem que bucket aberto.
 */

const ALGO = "aes-256-gcm"

/** Só caminho de imagem de cartão passa por aqui. Vale como 2ª barreira anti-traversal. */
const PATH_RE = /^card-images\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,128}$/

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return null
  try {
    const key = Buffer.from(raw, "base64")
    return key.length === 32 ? key : null
  } catch {
    return null
  }
}

/** Caminho no Storage → token opaco pra URL. `null` = sem chave ou caminho inválido. */
export function encodeCardImageToken(storagePath: string): string | null {
  if (!PATH_RE.test(storagePath)) return null
  const key = getKey()
  if (!key) {
    console.error("[card-image] ENCRYPTION_KEY ausente/inválida — token não emitido.")
    return null
  }
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const ct     = Buffer.concat([cipher.update(storagePath, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url")
}

/** Token da URL → caminho no Storage. `null` em qualquer suspeita (fail-closed). */
export function decodeCardImageToken(token: string): string | null {
  const key = getKey()
  if (!key) return null
  // Teto de tamanho antes de decodificar: token legítimo é curto; o resto é ruído/ataque.
  if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null
  try {
    const buf = Buffer.from(token, "base64url")
    if (buf.length < 29) return null                       // 12 iv + 16 tag + ≥1
    const decipher = crypto.createDecipheriv(ALGO, key, buf.subarray(0, 12))
    decipher.setAuthTag(buf.subarray(12, 28))
    const path = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")
    return PATH_RE.test(path) ? path : null                // cinto e suspensório
  } catch {
    return null                                            // tag inválida = adulterado
  }
}

/** URL pública e estável da imagem — é isto que vai no `image_url` do card. */
export function cardImageUrl(storagePath: string, origin: string): string | null {
  const token = encodeCardImageToken(storagePath)
  return token ? `${origin}/api/card-image/${token}` : null
}
