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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    ff.stderr.on("data", (d) => { stderr += d.toString() })
    ff.on("error", reject) // ex: ffmpeg não instalado
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`)),
    )
  })
}

export interface TranscodeResult { buffer: Buffer; mime: string; ext: string }

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
      const out = join(dir, "out.ogg")
      await runFfmpeg(["-y", "-i", inPath, "-vn", "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-f", "ogg", out])
      return { buffer: await readFile(out), mime: "audio/ogg", ext: "ogg" }
    }

    if (type === "video") {
      const out = join(dir, "out.mp4")
      await runFfmpeg([
        "-y", "-i", inPath,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
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
