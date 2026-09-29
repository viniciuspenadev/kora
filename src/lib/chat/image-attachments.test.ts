import { describe, expect, it, vi } from "vitest"
import { cropPixels, FULL_CROP, MediaSendBlockedError, sendImageBatch, validateImageBatch, type ImageAttachment, type ImageSendStatus } from "./image-attachments"

const png = () => new File(["png"], "captura.png", { type: "image/png" })
const item = (id: string, status: ImageSendStatus = "ready"): ImageAttachment => ({ id, file: png(), original: png(), caption: `  Imagem ${id}  `, status })

describe("lote de imagens", () => {
  it("aceita até dez imagens respeitando o rascunho existente", () => {
    expect(validateImageBatch(Array.from({ length: 10 }, png))).toBeNull()
    expect(validateImageBatch([png()], Array.from({ length: 10 }, png))).toContain("até 10")
  })
  it("rejeita seleção mista, vazia ou inválida inteira", () => {
    expect(validateImageBatch([])).toContain("pelo menos")
    expect(validateImageBatch([png(), new File(["pdf"], "doc.pdf", { type: "application/pdf" })])).toContain("apenas imagens")
    expect(validateImageBatch([png(), new File([], "vazia.png", { type: "image/png" })])).toContain("vazio")
    expect(validateImageBatch([new File(["svg"], "a.svg", { type: "image/svg+xml" })])).toContain("não suportado")
  })
  it("limita memória do lote mesmo quando cada imagem cabe individualmente", () => {
    const files = Array.from({ length: 6 }, png)
    files.forEach(file => Object.defineProperty(file, "size", { value: 15 * 1024 * 1024 }))
    expect(validateImageBatch(files)).toContain("80 MB")
  })
  it("para na falha e não reenvia imagens já aceitas ao continuar", async () => {
    const items = [item("a"), item("b"), item("c")]
    const update = (id: string, status: ImageSendStatus) => { items.find(entry => entry.id === id)!.status = status }
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Conexão interrompida"))
    expect(await sendImageBatch(items, send, () => null, update)).toBe("Conexão interrompida")
    expect(items.map(entry => entry.status)).toEqual(["sent", "uncertain", "ready"])
    expect(send).toHaveBeenCalledTimes(2)
    // An uncertain image must be explicitly checked by the user before becoming ready again.
    items[1].status = "ready"
    const retry = vi.fn().mockResolvedValue(undefined)
    expect(await sendImageBatch(items, retry, () => null, update)).toBeNull()
    expect(retry.mock.calls.map(call => call[1])).toEqual(["Imagem b", "Imagem c"])
  })
  it("reavalia a conversa/permissão antes de cada arquivo e deixa o restante pendente", async () => {
    let blocked: string | null = null
    const items = [item("a"), item("b")]
    const send = vi.fn(async () => { blocked = "Conversa alterada" })
    const update = (id: string, status: ImageSendStatus) => { items.find(entry => entry.id === id)!.status = status }
    expect(await sendImageBatch(items, send, () => blocked, update)).toBe("Conversa alterada")
    expect(send).toHaveBeenCalledTimes(1)
    expect(items.map(entry => entry.status)).toEqual(["sent", "ready"])
  })
  it("cancelamento local anterior à requisição permite continuar sem resultado incerto", async () => {
    const updates = vi.fn()
    await sendImageBatch([item("a")], async () => { throw new MediaSendBlockedError("Conversa mudou") }, () => null, updates)
    expect(updates.mock.calls).toEqual([["a", "sending"], ["a", "ready"]])
  })
  it("não repete itens enviados ou com resultado incerto", async () => {
    const send = vi.fn()
    await sendImageBatch([item("a", "sent"), item("b", "uncertain")], send, () => null, vi.fn())
    expect(send).not.toHaveBeenCalled()
  })
})

describe("coordenadas do recorte", () => {
  it("preserva dimensão original e calcula recorte sem esticar a imagem", () => {
    expect(cropPixels(FULL_CROP, 400, 240)).toEqual({ x: 0, y: 0, width: 400, height: 240 })
    expect(cropPixels({ x: .1, y: .25, width: .5, height: .5 }, 400, 240)).toEqual({ x: 40, y: 60, width: 200, height: 120 })
  })
  it("limita a seleção às bordas e garante ao menos um pixel", () => {
    expect(cropPixels({ x: .9, y: .9, width: .8, height: .8 }, 100, 100)).toEqual({ x: 90, y: 90, width: 10, height: 10 })
    expect(cropPixels({ x: 1, y: 1, width: 0, height: 0 }, 100, 100)).toEqual({ x: 99, y: 99, width: 1, height: 1 })
  })
  it("rejeita números não finitos e dimensões inválidas", () => {
    expect(() => cropPixels({ ...FULL_CROP, x: NaN }, 100, 100)).toThrow()
    expect(() => cropPixels(FULL_CROP, 0, 100)).toThrow()
  })
})
