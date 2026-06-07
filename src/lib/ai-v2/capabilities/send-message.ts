// Capacidade: enviar mensagem ao cliente (ação terminal de fala).
import { defineCapability } from "./registry"
import { sendBotText } from "../outbound"

export const SEND_MESSAGE = "send_message"

export const sendMessageCapability = defineCapability<{ text: string }>({
  id:           SEND_MESSAGE,
  name:         "Enviar mensagem",
  category:     "message",
  minPlanLevel: 0,
  isNode:       true,
  toolSchema: {
    type: "function",
    function: {
      name:        SEND_MESSAGE,
      description: "Envie uma mensagem de texto ao cliente, no tom e estilo da persona. Use pra acolher, responder ou perguntar algo que falta.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "A mensagem pro cliente." } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return { text: typeof p.text === "string" ? p.text : "" }
  },
  execute: async (ctx, { text }) => {
    const t = text.trim()
    if (!t) return { ok: false, error: "send_message: texto vazio" }
    await sendBotText(ctx, t)
    return { ok: true, sentText: t }
  },
})
