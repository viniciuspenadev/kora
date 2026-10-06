import { describe, expect, it } from "vitest"
import { inAppPreviewFor, messageFileSize, resolveMediaUrl } from "./media"
import { fileKind } from "./chat/file-kind"

const MB = 1024 * 1024
const doc = (media_mime_type: string | null, media_file_name: string | null, metadata: Record<string, unknown> = {}) => ({ media_mime_type, media_file_name, metadata })
const OWN = "/api/media/abc"

describe("o que abre dentro da conversa", () => {
  it("PDF, Word (.docx), Excel, CSV, XML e texto servidos pelo Kora abrem", () => {
    expect(inAppPreviewFor(doc("application/pdf", "Orçamento.pdf"), OWN)).toBe("pdf")
    expect(inAppPreviewFor(doc("application/octet-stream", "CONTRATO.PDF"), OWN)).toBe("pdf")
    expect(inAppPreviewFor(doc("application/pdf", null), OWN)).toBe("pdf")
    expect(inAppPreviewFor(doc("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "contrato.docx"), OWN)).toBe("word")
    expect(inAppPreviewFor(doc(null, "custos.xlsx"), OWN)).toBe("sheet")
    expect(inAppPreviewFor(doc("application/vnd.ms-excel", "relatorio.xls"), OWN)).toBe("sheet")
    expect(inAppPreviewFor(doc("text/csv", "clientes.csv"), OWN)).toBe("sheet")
    expect(inAppPreviewFor(doc("text/xml", "nfe.xml"), OWN)).toBe("text")
  })

  it("o resto segue baixando como sempre", () => {
    expect(inAppPreviewFor(doc("application/msword", "antigo.doc"), OWN)).toBeNull()           // Word 97-2003
    expect(inAppPreviewFor(doc(null, "apresentacao.pptx"), OWN)).toBeNull()
    expect(inAppPreviewFor(doc("application/zip", "fotos.zip"), OWN)).toBeNull()
    expect(inAppPreviewFor(doc("application/pdf", "antigo.pdf"), "https://storage.exemplo/antigo.pdf")).toBeNull()   // link externo antigo
    expect(inAppPreviewFor(doc("application/pdf", "subindo.pdf"), "blob:http://localhost/123")).toBeNull()           // ainda subindo
    expect(inAppPreviewFor(doc("application/pdf", "x.pdf"), "//outro-site.com/x.pdf")).toBeNull()
    expect(inAppPreviewFor(doc(null, "gigante.xlsx", { file_size: 20 * MB }), OWN)).toBeNull()                         // travaria a aba
    expect(inAppPreviewFor(doc("application/pdf", "grande.pdf", { file_size: 40 * MB }), OWN)).toBe("pdf")            // o leitor do navegador aguenta
  })

  it("tamanho só quando a mensagem registrou", () => {
    expect(messageFileSize({ metadata: { file_size: 2048 } })).toBe(2048)
    expect(messageFileSize({ metadata: {} })).toBeNull()
    expect(messageFileSize({ metadata: { file_size: "2048" } })).toBeNull()
  })

  it("mensagem com arquivo guardado usa o endereço do Kora", () => {
    expect(resolveMediaUrl({ id: "m1", media_url: "https://assinado", metadata: { storage_path: "t/c/a.pdf" } })).toBe("/api/media/m1")
    expect(resolveMediaUrl({ id: "m1", media_url: "https://antigo", metadata: {} })).toBe("https://antigo")
  })
})

describe("tipo do arquivo em palavras", () => {
  it("pela extensão, e pelo tipo quando o nome não tem extensão", () => {
    expect(fileKind("Proposta.PDF", null)).toMatchObject({ key: "pdf", label: "PDF", ext: "pdf" })
    expect(fileKind("planilha", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toMatchObject({ key: "excel", label: "Planilha Excel" })
    expect(fileKind("IMG_0042.HEIC", "image/heic")).toMatchObject({ key: "image", label: "Foto de iPhone (HEIC)", preview: null })
    expect(fileKind("obra.mp4", "video/mp4")).toMatchObject({ key: "video", label: "Vídeo" })
    expect(fileKind("desenho.dwg", "")).toMatchObject({ key: "other", label: "Documento", ext: "dwg" })
    expect(fileKind(null, null)).toMatchObject({ key: "other", ext: "" })
  })
})
