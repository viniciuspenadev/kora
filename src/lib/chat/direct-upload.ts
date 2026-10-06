// ═══════════════════════════════════════════════════════════════
// Envio DIRETO do navegador ao armazenamento (sem passar pelo servidor do Kora)
// ═══════════════════════════════════════════════════════════════
// O servidor autoriza (ação `authorizeChatUpload`: devolve um caminho exato + autorização de uso
// único), o navegador sobe o arquivo aqui, e o servidor confere e entrega depois
// (`sendUploadedChatMedia`). Validado em teste real em 30/09/2026 — ver ROADMAP.
//
// Protocolo: envio retomável (TUS) do Supabase Storage, com a autorização no cabeçalho
// `x-signature`. Pedaços de 6 MB (exigência do armazenamento: todo pedaço menos o último tem
// exatamente esse tamanho). Se a conexão cair, pergunta ao armazenamento onde parou e continua.
//
// 🔒 Não usa cliente Supabase com token de usuário (proibido no projeto — database-rules §2):
//    só XMLHttpRequest com a autorização presa àquele caminho.

export interface UploadAuthorization {
  /** Endereço de criação do envio retomável. */
  endpoint: string
  bucket: string
  /** Caminho exato autorizado (só serve para este arquivo). */
  path: string
  token: string
  /** Tipo com que o arquivo é guardado — decidido pelo servidor. */
  contentType: string
}

export interface UploadOptions {
  onProgress?: (sentBytes: number, totalBytes: number) => void
  signal?: AbortSignal
}

const CHUNK = 6 * 1024 * 1024
const MAX_RETRIES = 5

export class UploadAbortedError extends Error { constructor() { super("Envio cancelado.") } }

/** Tamanho até o qual o envio antigo (pelo servidor) sempre funcionou — abaixo da parede de 10 MB. */
export const SERVER_PATH_MAX_BYTES = 8 * 1024 * 1024

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new UploadAbortedError()) }, { once: true })
})

interface XhrResult { status: number; header: (name: string) => string | null; body: string }

/** Uma requisição com progresso de envio. `status 0` = falha de rede. */
function request(method: string, url: string, headers: Record<string, string>, body: Blob | null, opts: { onSent?: (bytes: number) => void; signal?: AbortSignal }): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new UploadAbortedError()); return }
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    if (opts.onSent) xhr.upload.onprogress = (e) => opts.onSent!(e.loaded)
    const onAbort = () => xhr.abort()
    opts.signal?.addEventListener("abort", onAbort, { once: true })
    const done = (r: XhrResult) => { opts.signal?.removeEventListener("abort", onAbort); resolve(r) }
    xhr.onload = () => done({ status: xhr.status, header: (n) => xhr.getResponseHeader(n), body: xhr.responseText })
    xhr.onerror = () => done({ status: 0, header: () => null, body: "" })
    xhr.ontimeout = () => done({ status: 0, header: () => null, body: "" })
    xhr.onabort = () => { opts.signal?.removeEventListener("abort", onAbort); reject(new UploadAbortedError()) }
    xhr.send(body)
  })
}

/** Frase para a pessoa a partir da resposta do armazenamento. */
function storageError(r: XhrResult, fallback: string): Error {
  if (r.status === 413) return new Error("O arquivo passa do tamanho máximo aceito pelo armazenamento.")
  if (r.status === 0) return new Error("Falha de conexão durante o envio. Confira a internet e tente de novo.")
  return new Error(fallback)
}

/**
 * Sobe o arquivo em pedaços. Resolve quando o armazenamento confirma o arquivo inteiro.
 * Rejeita com frase pronta para a tela (ou `UploadAbortedError` se cancelado).
 */
export async function uploadDirect(file: Blob, auth: UploadAuthorization, opts: UploadOptions = {}): Promise<void> {
  const total = file.size
  const tus = { "Tus-Resumable": "1.0.0", "x-signature": auth.token }
  const metadata = [
    `bucketName ${b64(auth.bucket)}`, `objectName ${b64(auth.path)}`,
    `contentType ${b64(auth.contentType)}`, `cacheControl ${b64("3600")}`,
  ].join(",")

  const created = await request("POST", auth.endpoint, { ...tus, "Upload-Length": String(total), "Upload-Metadata": metadata, "x-upsert": "false" }, null, { signal: opts.signal })
  const location = created.header("Location")
  if (created.status !== 201 || !location) throw storageError(created, "Não foi possível iniciar o envio do arquivo. Tente de novo.")

  let offset = 0
  let failures = 0
  opts.onProgress?.(0, total)
  while (offset < total) {
    const part = file.slice(offset, Math.min(offset + CHUNK, total))
    const base = offset
    const r = await request("PATCH", location, { ...tus, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }, part,
      { signal: opts.signal, onSent: (sent) => opts.onProgress?.(Math.min(total, base + sent), total) })

    if (r.status === 204) {
      const next = Number(r.header("Upload-Offset"))
      offset = Number.isFinite(next) && next > offset ? next : offset + part.size
      failures = 0
      opts.onProgress?.(offset, total)
      continue
    }
    // Recusa definitiva do armazenamento (tamanho, autorização): não adianta repetir.
    if (r.status === 413 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 410) {
      throw storageError(r, "O armazenamento recusou o arquivo. Tente enviar de novo.")
    }
    // Queda de conexão / instabilidade: espera, pergunta onde parou e continua dali.
    if (++failures > MAX_RETRIES) throw storageError(r, "O envio foi interrompido várias vezes. Tente de novo.")
    await wait(Math.min(8000, 500 * 2 ** failures), opts.signal)
    const head = await request("HEAD", location, tus, null, { signal: opts.signal })
    const resumed = Number(head.header("Upload-Offset"))
    if (head.status === 200 && Number.isFinite(resumed) && resumed >= 0) offset = resumed
  }
}
