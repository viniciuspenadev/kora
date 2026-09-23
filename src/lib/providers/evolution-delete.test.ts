import { afterEach, describe, expect, it, vi } from "vitest"
import { EvolutionProvider, MessageDeleteNotSentError } from "./evolution-provider"

const provider = () => new EvolutionProvider({ evolution_url: "https://evolution.example", evolution_key: "test-key", instance_name: "test-instance" })
const key = { id: "wa", remoteJid: "123456@lid", fromMe: true }
const original = { messages: { records: [{ key, messageType: "conversation" }] } }
const ack = { message: { protocolMessage: { type: 0, key } } }
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
afterEach(() => vi.unstubAllGlobals())

describe("Evolution deletion transport", () => {
  it("uses original key in correct instance and validates acknowledgement", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(original)).mockResolvedValueOnce(response(ack)); vi.stubGlobal("fetch", fetch)
    await expect(provider().deleteForEveryone("wa", Date.now() + 60_000)).resolves.toBeUndefined()
    expect(fetch.mock.calls[0][0]).toBe("https://evolution.example/chat/findMessages/test-instance")
    expect(fetch.mock.calls[1][0]).toBe("https://evolution.example/chat/deleteMessageForEveryone/test-instance")
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(key)
    expect(fetch.mock.calls[1][1].method).toBe("DELETE")
  })
  it.each([{ messages: { records: [] } }, { messages: { records: [{ key: { ...key, fromMe: false }, messageType: "conversation" }] } }])(
    "never sends without a verified original key", async value => {
      const fetch = vi.fn().mockResolvedValue(response(value)); vi.stubGlobal("fetch", fetch)
      await expect(provider().deleteForEveryone("wa", Date.now() + 60_000)).rejects.toBeInstanceOf(MessageDeleteNotSentError)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  it("checks deadline after original lookup", async () => {
    const fetch = vi.fn().mockResolvedValue(response(original)); vi.stubGlobal("fetch", fetch)
    await expect(provider().deleteForEveryone("wa", Date.now() - 1)).rejects.toBeInstanceOf(MessageDeleteNotSentError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("does not classify a post-send error as safely retryable", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(original)).mockRejectedValueOnce(new Error("timeout")); vi.stubGlobal("fetch", fetch)
    await expect(provider().deleteForEveryone("wa", Date.now() + 60_000)).rejects.not.toBeInstanceOf(MessageDeleteNotSentError)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("does not accept an empty successful HTTP response as confirmation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(original)).mockResolvedValueOnce(response({})); vi.stubGlobal("fetch", fetch)
    await expect(provider().deleteForEveryone("wa", Date.now() + 60_000)).rejects.toThrow("Confirmação")
  })
})
