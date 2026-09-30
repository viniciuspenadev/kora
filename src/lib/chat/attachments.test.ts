import { describe, expect, it } from "vitest"
import { ATTACHMENT_LIMITS, classifyAttachment, cleanAttachmentName, contentMismatch, sniffMagic } from "./attachments"

const MB = 1024 * 1024
const f = (name: string, type: string, size = 1000) => ({ name, type, size })
const bytes = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap((p) => typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p))

describe("classifyAttachment", () => {
  it("cada tipo vai na sua forma natural", () => {
    expect(classifyAttachment(f("foto.jpg", "image/jpeg"))).toEqual({ ok: true, kind: "image", mime: "image/jpeg", asDocument: false })
    expect(classifyAttachment(f("filme.mp4", "video/mp4"))).toMatchObject({ ok: true, kind: "video" })
    expect(classifyAttachment(f("audio.mp3", "audio/mpeg"))).toMatchObject({ ok: true, kind: "audio" })
    expect(classifyAttachment(f("contrato.pdf", "application/pdf"))).toMatchObject({ ok: true, kind: "document" })
  })

  it("ZIP, XML e HEIC entram como documento", () => {
    expect(classifyAttachment(f("nfe.xml", "text/xml"))).toMatchObject({ ok: true, kind: "document", mime: "text/xml" })
    expect(classifyAttachment(f("fotos.zip", "application/x-zip-compressed"))).toMatchObject({ ok: true, kind: "document" })
    expect(classifyAttachment(f("IMG_0042.HEIC", "image/heic"))).toMatchObject({ ok: true, kind: "document", mime: "image/heic", asDocument: false })
  })

  it("arquivo sem tipo (Windows) é decidido pela extensão", () => {
    expect(classifyAttachment(f("nfe.xml", ""))).toMatchObject({ ok: true, kind: "document", mime: "text/xml" })
    expect(classifyAttachment(f("planilha.XLSX", "application/octet-stream"))).toMatchObject({ ok: true, kind: "document" })
    expect(classifyAttachment(f("misterio.dwg", ""))).toMatchObject({ ok: false, error: expect.stringContaining("(.dwg)") })
    expect(classifyAttachment(f("semextensao", ""))).toMatchObject({ ok: false })
  })

  it("executável, script e página nunca passam — nem com tipo de documento", () => {
    for (const name of ["virus.exe", "macro.js", "pagina.html", "imagem.svg", "instalar.MSI", "atalho.lnk"]) {
      expect(classifyAttachment(f(name, "application/pdf"))).toMatchObject({ ok: false, error: expect.stringContaining("segurança") })
    }
  })

  it("vídeo acima do limite de vídeo é OFERECIDO como documento; como documento, passa", () => {
    const video = f("obra.mp4", "video/mp4", 24 * MB)
    expect(classifyAttachment(video)).toMatchObject({ ok: false, offerDocument: true, error: expect.stringContaining("Envie como documento") })
    expect(classifyAttachment(video, { asDocument: true })).toEqual({ ok: true, kind: "document", mime: "video/mp4", asDocument: true })
  })

  it("acima do teto do armazenamento não há saída; vazio é recusado", () => {
    const huge = classifyAttachment(f("filme.mp4", "video/mp4", ATTACHMENT_LIMITS.document + 1), { asDocument: true })
    expect(huge).toMatchObject({ ok: false, error: expect.stringContaining("máximo") })
    expect("offerDocument" in huge && huge.offerDocument).toBeFalsy()
    expect(classifyAttachment(f("vazio.pdf", "application/pdf", 0))).toEqual({ ok: false, error: "Arquivo vazio." })
  })
})

describe("tipo real pelo conteúdo", () => {
  it("reconhece as famílias pelos primeiros bytes", () => {
    expect(sniffMagic(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg")
    expect(sniffMagic(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png")
    expect(sniffMagic(bytes("%PDF-1.7"))).toBe("pdf")
    expect(sniffMagic(bytes("PK", [3, 4, 0, 0]))).toBe("zip")
    expect(sniffMagic(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 0, 0]))).toBe("iso-media")
    expect(sniffMagic(bytes("RIFF", [0, 0, 0, 0], "WEBP"))).toBe("webp")
    expect(sniffMagic(bytes("MZ", [0x90, 0]))).toBe("executable")
    expect(sniffMagic(bytes("<!DOCTYPE html><html>"))).toBe("markup")
    expect(sniffMagic(bytes("<?xml version='1.0'?><svg xmlns='x'>"))).toBe("markup")
    expect(sniffMagic(bytes("<?xml version='1.0'?><nfeProc>"))).toBe("unknown")
  })

  it("programa não passa sob tipo nenhum; página não passa como XML", () => {
    expect(contentMismatch("application/pdf", bytes("MZ", [0x90, 0]))).toContain("segurança")
    expect(contentMismatch("image/jpeg", bytes([0x7f], "ELF", [2, 1]))).toContain("segurança")
    expect(contentMismatch("text/xml", bytes("<html><script>alert(1)</script>"))).toContain("segurança")
    expect(contentMismatch("text/xml", bytes("<?xml version='1.0'?><nfeProc>"))).toBeNull()
  })

  it("o que entrou com a bandeja (ZIP, HEIC) tem de ser o que diz ser", () => {
    expect(contentMismatch("application/zip", bytes("%PDF-1.7"))).toContain("não corresponde")
    expect(contentMismatch("image/heic", bytes([0xff, 0xd8, 0xff, 0xdb]))).toContain("não corresponde")
    expect(contentMismatch("application/zip", bytes("PK", [3, 4, 0, 0]))).toBeNull()
    expect(contentMismatch("image/heic", bytes([0, 0, 0, 0x20], "ftypheic", [0, 0, 0, 0]))).toBeNull()
  })

  it("o que já era aceito NÃO ganha recusa nova: extensão 'errada' do dia a dia continua indo", () => {
    expect(contentMismatch("image/jpeg", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull()          // PNG salvo como .jpg
    expect(contentMismatch("application/vnd.ms-excel", bytes("<html><table><tr><td>Total</td>"))).toBeNull()   // relatório HTML exportado como .xls
    expect(contentMismatch("application/vnd.ms-excel", bytes("PK", [3, 4, 0, 0]))).toBeNull()                  // .xlsx renomeado para .xls
    expect(contentMismatch("application/pdf", bytes("relatorio em texto"))).toBeNull()
    expect(contentMismatch("video/mp4", bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBeNull()                            // webm salvo como .mp4
    expect(contentMismatch("text/csv", bytes("nome;telefone\nAna;11999"))).toBeNull()
  })
})

describe("cleanAttachmentName", () => {
  it("tira caminho e caractere de controle, preserva acento e extensão", () => {
    expect(cleanAttachmentName("C:\\Users\\ana\\Orçamento nº 12.pdf")).toBe("Orçamento nº 12.pdf")
    expect(cleanAttachmentName("../../etc/passwd")).toBe("passwd")
    expect(cleanAttachmentName("a\u0000b\u0007.pdf")).toBe("ab.pdf")
    expect(cleanAttachmentName("")).toBe("arquivo")
    const long = cleanAttachmentName("x".repeat(400) + ".pdf")
    expect(long.length).toBeLessThanOrEqual(180)
    expect(long.endsWith(".pdf")).toBe(true)
  })
})
