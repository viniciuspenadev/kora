import { describe, expect, it } from "vitest"
import { attachmentBlockReason, carriesFiles, transferredFiles } from "./file-intake"

const png = () => new File(["image"], "captura.png", { type: "image/png" })
describe("entrada de anexos no chat", () => {
  it.each([
    [{ isPrivate: true }, "chat interno"],
    [{ disabled: true }, "Reabra"],
    [{ windowClosed: true }, "janela"],
    [{ windowNoReopen: true }, "janela"],
    [{ isRecording: true }, "gravação"],
    [{ unavailableReason: "Canal sem mídia" }, "Canal sem mídia"],
  ])("bloqueia entrada no estado %j", (state, expected) => {
    expect(attachmentBlockReason(state)).toContain(expected)
  })
  it("conversa aberta e disponível não bloqueia", () => {
    expect(attachmentBlockReason({})).toBeNull()
  })
  it("não trata HTML, URL ou texto como arquivo", () => {
    const data = { files: [], items: [{ kind: "string", getAsFile: () => null }] } as unknown as DataTransfer
    expect(transferredFiles(data)).toEqual([])
    expect(carriesFiles({ types: ["text/plain", "text/uri-list"] })).toBe(false)
    expect(carriesFiles(null)).toBe(false)
    expect(carriesFiles({ types: ["Files"] })).toBe(true)
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
