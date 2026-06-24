// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — renderizador de OPÇÕES canal-aware (compartilhado)
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de "pergunta + opções + (controle)" pros nós Menu e Agendar.
// O MODO de render (RenderMode) decide o veículo:
//   • numbered  → SEMPRE texto numerado (inclusive no Meta — "digite o número").
//   • auto/interactive → botões nativos (≤3) / lista (4+) no Meta; o Baileys
//     não tem interativo nativo (a Meta restringiu) → cai pro numerado.
// Persiste SEMPRE a versão numerada (o atendente vê no inbox o que foi oferecido).
// O id da opção vira a aresta; no inbound, tanto o número/título digitado quanto
// o id/título do botão tocado casam (o tap Meta chega como `routableText`=título).

import "server-only"
import { sendBotText, sendBotInteractive } from "../outbound"
import type { ExecCtx } from "../capabilities/types"
import type { RenderMode } from "./types"

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

export interface OptItem { id: string; title: string }

type OutCtx = Pick<ExecCtx, "tenantId" | "conversationId" | "contact" | "instance" | "dryRun" | "captured">

/** Texto numerado — fallback universal + representação legível no inbox. `last`
 *  (opcional) é a opção de CONTROLE (nenhum / ver mais / outro dia) → "0️⃣". */
export function numberedText(body: string, items: OptItem[], last?: OptItem): string {
  const lines = [body.trim(), "", ...items.map((o, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${o.title}`)]
  if (last) lines.push(`0️⃣ ${last.title}`)
  return lines.join("\n")
}

/**
 * Envia uma lista de opções pelo veículo certo do canal, respeitando `render`.
 * `last` = opção de controle (vira a última row/botão e o "0️⃣" no numerado).
 */
export async function sendOptions(
  ctx: OutCtx,
  args: { render?: RenderMode; body: string; items: OptItem[]; last?: OptItem; listButton?: string; meta?: Record<string, unknown> },
): Promise<void> {
  const { render = "auto", body, items, last, listButton = "Ver opções", meta = {} } = args
  const text = numberedText(body, items, last)
  if (items.length === 0 || render === "numbered") { await sendBotText(ctx, text, meta); return }

  const all = last ? [...items, last] : items
  const payload =
    all.length <= 3
      ? { body: body.trim(), buttons: all.map((o) => ({ id: o.id, title: o.title })) }
      : { body: body.trim(), list: { buttonText: listButton, sections: [{ rows: all }] } }

  const sent = await sendBotInteractive(ctx, payload, text, { ...meta, interactive_kind: all.length <= 3 ? "button" : "list" })
  if (!sent) await sendBotText(ctx, text, meta)
}
