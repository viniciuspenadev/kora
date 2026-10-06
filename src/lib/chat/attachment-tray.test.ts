import { describe, expect, it, vi } from "vitest"
import { MediaSendBlockedError, planAdditions, sendTrayBatch, trayItemPlan, type TrayItem, type TraySendStatus } from "./attachment-tray"

const MB = 1024 * 1024
const file = (name: string, type: string, size = 1000) => { const f = new File(["x"], name, { type }); Object.defineProperty(f, "size", { value: size }); return f }
const png = () => file("captura.png", "image/png")
const item = (id: string, status: TraySendStatus = "ready"): TrayItem => ({ id, file: png(), original: png(), caption: `Arquivo ${id}`, asDocument: false, status, progress: 0 })

describe("o que entra na bandeja", () => {
  it("tipos diferentes entram juntos, na ordem em que vieram", () => {
    const files = [png(), file("contrato.pdf", "application/pdf"), file("obra.mp4", "video/mp4"), file("nfe.xml", "")]
    expect(planAdditions(files, 0)).toEqual({ accepted: files, leftOut: [] })
  })

  it("aceita o que dá e NOMEIA o que ficou de fora com o motivo", () => {
    const ok = png()
    const { accepted, leftOut } = planAdditions([file("instalar.exe", "application/x-msdownload"), ok, file("vazio.pdf", "application/pdf", 0), file("planta.dwg", "")], 0)
    expect(accepted).toEqual([ok])
    expect(leftOut.map((l) => l.name)).toEqual(["instalar.exe", "vazio.pdf", "planta.dwg"])
    expect(leftOut[0].reason).toContain("segurança")
    expect(leftOut[1].reason).toContain("vazio")
    expect(leftOut[2].reason).toContain("(.dwg)")
  })

  it("o que passa de dez fica de fora — contando o que já estava na bandeja", () => {
    const files = Array.from({ length: 4 }, png)
    const { accepted, leftOut } = planAdditions(files, 8)
    expect(accepted).toHaveLength(2)
    expect(leftOut).toHaveLength(2)
    expect(leftOut[0].reason).toContain("até 10")
  })

  it("vídeo que só cabe como documento ENTRA, e a troca resolve o aviso", () => {
    const video = file("obra.mp4", "video/mp4", 24 * MB)
    expect(planAdditions([video], 0).accepted).toEqual([video])
    expect(trayItemPlan({ file: video, asDocument: false })).toMatchObject({ ok: false, offerDocument: true })
    expect(trayItemPlan({ file: video, asDocument: true })).toMatchObject({ ok: true, kind: "document" })
  })

  it("acima do teto do armazenamento não entra nem como documento", () => {
    const { accepted, leftOut } = planAdditions([file("filme.mp4", "video/mp4", 60 * MB)], 0)
    expect(accepted).toEqual([])
    expect(leftOut[0].reason).toContain("máximo")
  })
})

describe("envio em ordem", () => {
  const tracker = (items: TrayItem[]) => (id: string, status: TraySendStatus) => { items.find((entry) => entry.id === id)!.status = status }

  it("para na falha e não reenvia o que já foi aceito ao continuar", async () => {
    const items = [item("a"), item("b"), item("c")]
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Conexão interrompida"))
    expect(await sendTrayBatch(items, send, () => null, tracker(items))).toBe("Conexão interrompida")
    expect(items.map((entry) => entry.status)).toEqual(["sent", "uncertain", "ready"])
    expect(send).toHaveBeenCalledTimes(2)
    // Resultado incerto só volta a "pronto" depois que a pessoa conferiu o histórico.
    items[1].status = "ready"
    const retry = vi.fn().mockResolvedValue(undefined)
    expect(await sendTrayBatch(items, retry, () => null, tracker(items))).toBeNull()
    expect(retry.mock.calls.map((call) => call[0].id)).toEqual(["b", "c"])
  })

  it("reavalia conversa e permissão antes de cada arquivo; o resto fica pronto", async () => {
    let blocked: string | null = null
    const items = [item("a"), item("b")]
    const send = vi.fn(async () => { blocked = "Conversa alterada" })
    expect(await sendTrayBatch(items, send, () => blocked, tracker(items))).toBe("Conversa alterada")
    expect(send).toHaveBeenCalledTimes(1)
    expect(items.map((entry) => entry.status)).toEqual(["sent", "ready"])
  })

  it("recusa conhecida (nada foi enviado) devolve o arquivo a pronto, sem resultado incerto", async () => {
    const updates = vi.fn()
    expect(await sendTrayBatch([item("a")], async () => { throw new MediaSendBlockedError("Janela fechada") }, () => null, updates)).toBe("Janela fechada")
    expect(updates.mock.calls).toEqual([["a", "sending"], ["a", "ready"]])
  })

  it("não repete o que já foi enviado nem o que está com resultado incerto", async () => {
    const send = vi.fn()
    await sendTrayBatch([item("a", "sent"), item("b", "uncertain")], send, () => null, vi.fn())
    expect(send).not.toHaveBeenCalled()
  })
})
