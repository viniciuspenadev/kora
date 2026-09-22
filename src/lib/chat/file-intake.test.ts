import { describe, expect, it } from "vitest"
import { attachmentBlockReason, prepareAttachment, transferredFiles } from "./file-intake"
import { SIZE_LIMITS } from "./media-validation"

const png = () => new File(["image"], "captura.png", { type: "image/png" })
describe("entrada de anexos no chat", () => {
  it("aceita imagem válida e documento pelo mesmo validador", () => {
    const image = png()
    expect(prepareAttachment([image], null, false).file).toBe(image)
    expect(prepareAttachment([new File(["pdf"], "proposta.pdf", { type: "application/pdf" })], null, false).file).toBeDefined()
  })
  it("rejeita lote inteiro sem descartar arquivos silenciosamente", () => {
    expect(prepareAttachment([png(), png()], null, false).error).toContain("um arquivo por vez")
  })
  it("não substitui um rascunho existente", () => {
    expect(prepareAttachment([png()], null, true).error).toContain("Remova-o")
  })
  it("rejeita formato não permitido e arquivo vazio", () => {
    expect(prepareAttachment([new File(["x"], "imagem.svg", { type: "image/svg+xml" })], null, false).error).toContain("não suportado")
    expect(prepareAttachment([new File([], "vazia.png", { type: "image/png" })], null, false).error).toContain("vazio")
  })
  it("rejeita imagem acima do limite compartilhado", () => {
    const file = new File([new Uint8Array(SIZE_LIMITS.image + 1)], "grande.png", { type: "image/png" })
    expect(prepareAttachment([file], null, false).error).toContain("Máximo")
  })
  it.each([
    [{ isPrivate: true }, "chat interno"],
    [{ disabled: true }, "Reabra"],
    [{ windowClosed: true }, "janela"],
    [{ windowNoReopen: true }, "janela"],
    [{ isRecording: true }, "gravação"],
    [{ unavailableReason: "Canal sem mídia" }, "Canal sem mídia"],
  ])("bloqueia entrada no estado %j", (state, expected) => {
    expect(prepareAttachment([png()], attachmentBlockReason(state), false).error).toContain(expected)
  })
  it("não trata HTML, URL ou texto como arquivo", () => {
    const data = { files: [], items: [{ kind: "string", getAsFile: () => null }] } as unknown as DataTransfer
    expect(transferredFiles(data)).toEqual([])
  })
  it("usa files sem duplicar os mesmos arquivos em items", () => {
    const image = png()
    const data = { files: [image], items: [{ kind: "file", getAsFile: () => image }] } as unknown as DataTransfer
    expect(transferredFiles(data)).toEqual([image])
  })
  it("lê itens de clipboard quando files vier vazio e ignora entradas nulas", () => {
    const image = png()
    const data = { files: [], items: [{ kind: "file", getAsFile: () => image }, { kind: "file", getAsFile: () => null }] } as unknown as DataTransfer
    expect(transferredFiles(data)).toEqual([image])
  })
})
