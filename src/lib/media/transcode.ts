import "server-only"
import { spawn } from "node:child_process"
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Transcodificação de mídia pro formato aceito pela WhatsApp Cloud API (oficial),
 * via ffmpeg (imagem Docker instala o pacote `ffmpeg`). O Evolution já transcodifica
 * sozinho — isto só é usado no canal oficial quando o formato não é aceito.
 *
 *   áudio → ogg/opus  (voice note nativo do WhatsApp)
 *   vídeo → mp4 (H.264 + AAC, faststart)
 *   imagem → jpeg
 *
 * Fail-safe: se o ffmpeg não estiver instalado ou der erro, a Promise rejeita e o
 * chamador trata (volta pra mensagem de "formato não aceito"). Nunca crasha.
 */

// ── Defesas de DoS (H-06, auditoria 2026-07-30) ──────────────────
// ffmpeg sem limites deixa um arquivo malformado/caro ocupar CPU/memória
// indefinidamente. Aplicamos: timeout (mata o processo), teto de threads e
// limite de CONCORRÊNCIA (N ffmpeg simultâneos no processo inteiro).
const FFMPEG_TIMEOUT_MS   = Number(process.env.FFMPEG_TIMEOUT_MS ?? 120_000)   // 2 min
const FFMPEG_MAX_CONCURRENT = Math.max(1, Number(process.env.FFMPEG_MAX_CONCURRENT ?? 2))

let ffActive = 0
const ffQueue: Array<() => void> = []
async function acquireFfmpeg(): Promise<void> {
  if (ffActive < FFMPEG_MAX_CONCURRENT) { ffActive++; return }
  await new Promise<void>((res) => ffQueue.push(res))
  // Slot TRANSFERIDO pelo release (não incrementa — o release não decrementou). Evita o
  // overshoot transitório (rodar MAX+1) da corrida release--/acquire++ (QA 2026-07-30).
}
function releaseFfmpeg(): void {
  const next = ffQueue.shift()
  if (next) next()      // transfere o slot pro próximo da fila (sem mexer no contador)
  else ffActive--       // fila vazia → devolve o slot
}

async function runFfmpeg(args: string[]): Promise<void> {
  await acquireFfmpeg()
  try {
    await new Promise<void>((resolve, reject) => {
      // Threads capadas por-comando (no encoder, antes do output) — ver a montagem dos args.
      const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
      let stderr = ""
      let done = false
      const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn() } }
      // Timeout: mata o processo (SIGKILL) se passar do teto — evita hang infinito.
      const timer = setTimeout(() => {
        ff.kill("SIGKILL")
        finish(() => reject(new Error(`ffmpeg timeout (${FFMPEG_TIMEOUT_MS}ms)`)))
      }, FFMPEG_TIMEOUT_MS)
      ff.stderr.on("data", (d) => { stderr += d.toString() })
      ff.on("error", (e) => finish(() => reject(e))) // ex: ffmpeg não instalado
      ff.on("close", (code) =>
        finish(() => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`)))),
      )
    })
  } finally {
    releaseFfmpeg()
  }
}

export interface TranscodeResult { buffer: Buffer; mime: string; ext: string }

/**
 * **Higieniza** imagem que o CLIENTE subiu, antes de guardar. Devolve um JPEG NOVO,
 * gerado por nós a partir dos pixels decodificados.
 *
 * 🔴 É a defesa principal do upload de imagem (docs/message-composer-design.md §7), e ela
 *    resolve dois problemas de uma vez:
 *
 *    1. **EXIF/GPS.** Foto de celular carrega **coordenada**. O cliente sobe a foto do
 *       produto tirada na loja e publica o endereço junto, sem saber. `-map_metadata -1`
 *       apaga tudo.
 *    2. **Arquivo poliglota.** Existe arquivo que é JPEG válido *e* HTML/ZIP válido ao
 *       mesmo tempo. Re-encodar destrói: o que sai são pixels, e mais nada. (A resposta da
 *       rota também manda `nosniff`, mas defesa em profundidade — o arquivo ainda vai pra
 *       Meta e pra quem mais consumir.)
 *
 * ✅ Usa **ffmpeg, que já está na imagem Docker** e já é usado pelo canal oficial. `sharp`
 *    seria o óbvio, mas não é dependência declarada aqui (vem transitivo do Next) —
 *    depender dele exigiria mexer no build por uma coisa que o ffmpeg já faz.
 *
 * `-frames:v 1` garante UM quadro (GIF animado vira a 1ª imagem). A redução pra 1440px de
 * largura limita o tamanho e é folgada pro card, que renderiza bem menor.
 */
export async function sanitizeImageUpload(input: Buffer): Promise<TranscodeResult> {
  const dir    = await mkdtemp(join(tmpdir(), "kora-img-"))
  const inPath = join(dir, "input")
  const out    = join(dir, "out.jpg")
  try {
    await writeFile(inPath, input)
    await runFfmpeg([
      "-y", "-i", inPath,
      "-map_metadata", "-1",                       // 🔴 mata EXIF/GPS
      "-frames:v", "1",                            // 1 quadro só (GIF animado → 1ª imagem)
      "-vf", "scale='min(1440,iw)':-2",            // teto de largura; -2 mantém proporção par
      "-q:v", "3",                                 // qualidade alta, arquivo ainda pequeno
      "-threads", "1",                             // imagem é barata; não roubar CPU do vídeo
      "-f", "image2", "-vcodec", "mjpeg", out,
    ])
    return { buffer: await readFile(out), mime: "image/jpeg", ext: "jpg" }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Converte o buffer pro formato aceito pela Meta. `null` = tipo que não dá/precisa converter. */
export async function transcodeForMeta(
  input: Buffer,
  type: "image" | "audio" | "video" | "document",
): Promise<TranscodeResult | null> {
  if (type === "document") return null

  const dir    = await mkdtemp(join(tmpdir(), "kora-tc-"))
  const inPath = join(dir, "input")
  try {
    await writeFile(inPath, input)

    if (type === "audio") {
      // WhatsApp Cloud API toca voice note SÓ em ogg/opus MONO. Estéreo a Meta aceita
      // no upload mas o WhatsApp não reproduz ("áudio não disponível"). `-ac 1` é o pulo
      // do gato; `-application voip` = perfil de voz (o mesmo que o WhatsApp usa).
      const out = join(dir, "out.ogg")
      await runFfmpeg([
        "-y", "-i", inPath,
        "-vn", "-ac", "1", "-ar", "48000",
        "-c:a", "libopus", "-b:a", "24k", "-application", "voip",
        "-f", "ogg", out,
      ])
      return { buffer: await readFile(out), mime: "audio/ogg", ext: "ogg" }
    }

    if (type === "video") {
      const out = join(dir, "out.mp4")
      await runFfmpeg([
        "-y", "-i", inPath,
        "-t", "1800",   // cap de 30min (H-06): barra transcodificação de vídeo absurdamente longo
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-threads", "2",   // capa o ENCODER (libx264) — antes o -threads global só capava o decoder (H-06, QA)
        out,
      ])
      return { buffer: await readFile(out), mime: "video/mp4", ext: "mp4" }
    }

    // image → jpeg
    const out = join(dir, "out.jpg")
    await runFfmpeg(["-y", "-i", inPath, "-frames:v", "1", out])
    return { buffer: await readFile(out), mime: "image/jpeg", ext: "jpg" }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
