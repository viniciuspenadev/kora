// ═══════════════════════════════════════════════════════════════
// Anexos da conversa — REGRA ÚNICA de "o que é este arquivo e pode ir?"
// ═══════════════════════════════════════════════════════════════
// Usada nos DOIS lados: a bandeja (navegador) avisa na hora em que o arquivo é solto, e o
// servidor repete a mesma decisão antes de autorizar o envio e de novo antes de entregar —
// a tela nunca é a autoridade.
//
// Caminho de envio (30/09/2026): o arquivo vai do navegador DIRETO ao armazenamento (não passa
// pela memória do servidor). Por isso os limites daqui são os do WhatsApp e do armazenamento,
// não os de `media-validation.ts` (que continuam valendo para o que ainda sobe pelo servidor:
// nota de voz e figurinha).
//
// Pura: sem I/O, sem dependência de servidor.

const MB = 1024 * 1024

export type AttachmentKind = "image" | "audio" | "video" | "document"

/** Limite por forma de envio. Mídia: o que o WhatsApp aceita como foto/vídeo/áudio.
 *  Documento: o teto do armazenamento (50 MB por arquivo, config do projeto conferida em 30/09/2026). */
export const ATTACHMENT_LIMITS: Record<AttachmentKind, number> = {
  image:    16 * MB,
  audio:    16 * MB,
  video:    16 * MB,
  document: 50 * MB,
}

export const MAX_ATTACHMENTS_PER_SEND = 10
export const ATTACHMENT_NAME_MAX = 180

// Tipo → forma NATURAL de envio. HEIC (foto de iPhone) é imagem, mas o WhatsApp não exibe:
// vai como documento. ZIP e XML (nota fiscal) são documentos.
const MIME_KIND: Record<string, AttachmentKind> = {
  "image/jpeg": "image", "image/png": "image", "image/webp": "image", "image/gif": "image",
  "image/heic": "document", "image/heif": "document",
  "audio/mpeg": "audio", "audio/mp3": "audio", "audio/ogg": "audio", "audio/wav": "audio",
  "audio/mp4": "audio", "audio/x-m4a": "audio", "audio/webm": "audio", "audio/aac": "audio",
  "video/mp4": "video", "video/quicktime": "video", "video/webm": "video",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain": "document", "text/csv": "document",
  "text/xml": "document", "application/xml": "document",
  "application/zip": "document", "application/x-zip-compressed": "document",
}

// O Windows entrega vários arquivos SEM tipo (ou como "octet-stream"): decide pela extensão.
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", xml: "text/xml", zip: "application/zip",
}

// Nunca, nem como documento: programa, script ou página que o navegador/sistema executaria.
const BLOCKED_EXT = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "pif", "js", "mjs", "vbs", "ps1", "jar", "apk", "sh", "dll", "lnk", "html", "htm", "svg", "hta"])

export const ATTACHMENT_ACCEPT = [...new Set([...Object.keys(MIME_KIND), ...Object.keys(EXT_MIME).map((e) => `.${e}`)])].join(",")

const KIND_LABEL: Record<AttachmentKind, string> = { image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento" }

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ""
}

export type AttachmentPlan =
  | { ok: true; kind: AttachmentKind; mime: string; asDocument: boolean }
  /** `offerDocument`: não cabe como foto/vídeo/áudio, mas cabe como documento — a bandeja oferece. */
  | { ok: false; error: string; offerDocument?: boolean }

/** Decide como (e se) um arquivo vai. `asDocument` = a pessoa escolheu mandar como documento. */
export function classifyAttachment(
  file: { name: string; type: string; size: number },
  opts: { asDocument?: boolean } = {},
): AttachmentPlan {
  const name = String(file.name ?? "")
  const size = Number(file.size)
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "Arquivo vazio." }

  const ext = fileExtension(name)
  if (BLOCKED_EXT.has(ext)) return { ok: false, error: `Arquivos .${ext} não podem ser enviados por segurança.` }

  const declared = String(file.type ?? "").toLowerCase().split(";")[0].trim()
  const mime = MIME_KIND[declared] ? declared : (EXT_MIME[ext] ?? "")
  const natural = MIME_KIND[mime]
  if (!natural) {
    return { ok: false, error: `Tipo de arquivo não aceito${ext ? ` (.${ext})` : ""}. Aceitos: imagem, áudio, vídeo, PDF, Word, Excel, PowerPoint, texto, XML e ZIP.` }
  }

  const asDocument = natural === "document" || !!opts.asDocument
  const kind: AttachmentKind = asDocument ? "document" : natural
  if (size > ATTACHMENT_LIMITS.document) {
    return { ok: false, error: `Arquivo muito grande (${formatFileSize(size)}). O máximo é ${formatFileSize(ATTACHMENT_LIMITS.document)}.` }
  }
  if (size > ATTACHMENT_LIMITS[kind]) {
    return {
      ok: false, offerDocument: true,
      error: `${KIND_LABEL[kind]} de ${formatFileSize(size)}: acima de ${formatFileSize(ATTACHMENT_LIMITS[kind])} o WhatsApp não aceita como ${KIND_LABEL[kind].toLowerCase()}. Envie como documento.`,
    }
  }
  return { ok: true, kind, mime, asDocument: asDocument && natural !== "document" }
}

// ── Tipo REAL pelo conteúdo (servidor lê só o começo do arquivo já guardado) ──────────────

export type MagicFamily =
  | "jpeg" | "png" | "gif" | "webp" | "pdf" | "zip" | "ole" | "iso-media" | "webm" | "ogg" | "mp3" | "wav" | "aac"
  | "executable" | "markup" | "unknown"

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** Família do arquivo pelos primeiros bytes. `markup` = HTML/SVG (nunca aceito). */
export function sniffMagic(bytes: Uint8Array): MagicFamily {
  const b = bytes
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg"
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png"
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif"
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp"
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "wav"
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "pdf"
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) return "zip"
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "ole"
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") return "iso-media"          // mp4, mov, m4a, heic
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm"
  if (b.length >= 4 && ascii(b, 0, 4) === "OggS") return "ogg"
  if (b.length >= 3 && ascii(b, 0, 3) === "ID3") return "mp3"
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac"   // ADTS
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3"   // quadro MPEG
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return "executable"     // MZ (Windows)
  if (b.length >= 4 && b[0] === 0x7f && ascii(b, 1, 4) === "ELF") return "executable"
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 1024)).toLowerCase()
  if (/<\s*(!doctype\s+html|html|script|svg|iframe|body)\b/.test(head)) return "markup"
  return "unknown"
}

// 🔴 O QUE JÁ ERA ACEITO NÃO GANHA RECUSA NOVA. Foto, vídeo, PDF e Office sempre foram entregues
//    sem olhar o conteúdo, e arquivo do dia a dia vem com extensão "errada" o tempo todo: PNG
//    salvo como .jpg, relatório de sistema exportado como .xls que por dentro é uma tabela HTML.
//    Conferir esses tipos faria parar o que funciona. A conferência rígida vale só para o que
//    ENTROU com a bandeja (ZIP, XML, HEIC) — e programa não passa sob tipo nenhum.
const STRICT_MAGIC: Record<string, MagicFamily[]> = {
  "image/heic": ["iso-media"], "image/heif": ["iso-media"],
  "application/zip": ["zip"], "application/x-zip-compressed": ["zip"],
}
// XML é o único tipo aceito que o navegador abriria como PÁGINA (com script) se viesse disfarçado.
const NO_MARKUP = new Set(["text/xml", "application/xml"])

/** O conteúdo guardado pode ir como o tipo declarado? `null` = ok; texto = motivo da recusa. */
export function contentMismatch(mime: string, bytes: Uint8Array): string | null {
  const family = sniffMagic(bytes)
  if (family === "executable" || (family === "markup" && NO_MARKUP.has(mime))) return "O conteúdo deste arquivo não pode ser enviado por segurança."
  const strict = STRICT_MAGIC[mime]
  if (strict && !strict.includes(family)) return "O conteúdo do arquivo não corresponde ao tipo informado."
  return null
}

/** Nome exibido/entregue: sem caminho, sem caractere de controle, com teto. */
export function cleanAttachmentName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? ""
  const clean = Array.from(base).filter((ch) => (ch.codePointAt(0) ?? 0) >= 32 && ch !== "\u007f").join("").trim()
  if (!clean) return "arquivo"
  if (clean.length <= ATTACHMENT_NAME_MAX) return clean
  const ext = fileExtension(clean)
  return ext ? `${clean.slice(0, ATTACHMENT_NAME_MAX - ext.length - 1)}.${ext}` : clean.slice(0, ATTACHMENT_NAME_MAX)
}
