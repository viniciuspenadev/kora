// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — renderizador de OPÇÕES canal-aware (compartilhado)
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de "pergunta + opções + (controle)" pros nós Menu e Agendar.
// O MODO de render (RenderMode) decide o veículo:
//   • numbered  → SEMPRE texto numerado (inclusive no Meta — "digite o número").
//   • auto/interactive → botões nativos / lista no Meta; o Baileys não tem
//     interativo nativo (a Meta restringiu) → cai pro numerado.
//
// LIMITES DA META (estudo com o owner, docs/agenda-node-redesign.md §7):
// botão = título ≤20 · linha de lista = título ≤24 (+descrição 72) · lista ≤10 rows.
// Doutrina: NUNCA mostrar texto cortado — DEGRADA o veículo até o texto caber
// inteiro (botões → lista → numerado). O .slice() do provider vira só cinto de
// segurança. `group` agrupa rows em SEÇÕES nativas da lista (Manhã/Tarde/Noite,
// dia na oferta direta) — a linha não repete o que o cliente já escolheu.
//
// Persiste SEMPRE a versão numerada (o atendente vê no inbox o que foi oferecido).
// O id da opção vira a aresta; no inbound, tanto o número/título digitado quanto
// o id/título do botão tocado casam (o tap Meta chega como `routableText`=título).

import "server-only"
import { sendBotText, sendBotInteractive } from "../outbound"
import type { ExecCtx } from "../capabilities/types"
import type { RenderMode } from "./types"

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

/** Limites duros do interativo Meta (fonte: docs oficiais Cloud API). */
const BTN_TITLE_MAX = 20
const ROW_TITLE_MAX = 24
const LIST_ROWS_MAX = 10

export interface OptItem {
  id: string
  title: string
  /** Seção da lista (ex: "Manhã", "Sexta - 23/07"). Itens consecutivos com o mesmo
   *  group viram uma seção nativa; no numerado, o group vira linha de cabeçalho. */
  group?: string
}

type OutCtx = Pick<ExecCtx, "tenantId" | "conversationId" | "contact" | "instance" | "dryRun" | "captured">

/** Texto numerado — fallback universal + representação legível no inbox. `last`
 *  (opcional) é a opção de CONTROLE (nenhum / ver mais / outro dia) → "0️⃣". */
export function numberedText(body: string, items: OptItem[], last?: OptItem): string {
  const lines: string[] = [body.trim(), ""]
  let g: string | undefined
  items.forEach((o, i) => {
    if (o.group && o.group !== g) { g = o.group; lines.push(`— ${g} —`) }
    lines.push(`${NUM_EMOJI[i] ?? `${i + 1}.`} ${o.title}`)
  })
  if (last) lines.push(`0️⃣ ${last.title}`)
  return lines.join("\n")
}

/**
 * Rows agrupadas em seções nativas (itens consecutivos com o mesmo `group`).
 * ⚠️ Regra da Meta: lista com MAIS de uma seção exige `title` em todas. Então:
 *   • ninguém tem group → seção ÚNICA sem título (como sempre foi — válida);
 *   • com groups → toda seção nasce com título, e o `last` (controle) entra na
 *     ÚLTIMA seção — nunca vira seção órfã sem título (daria 400 silencioso).
 * Item sem group no meio de agrupados herda a seção anterior (ou "Opções" se 1º).
 */
function buildSections(items: OptItem[], last?: OptItem): { title?: string; rows: { id: string; title: string }[] }[] {
  const grouped = items.some((o) => o.group)
  if (!grouped) {
    const rows = (last ? [...items, last] : items).map((o) => ({ id: o.id, title: o.title }))
    return [{ rows }]
  }
  const sections: { title: string; rows: { id: string; title: string }[] }[] = []
  for (const o of items) {
    const title = o.group ?? sections[sections.length - 1]?.title ?? "Opções"
    if (!sections.length || sections[sections.length - 1].title !== title) sections.push({ title, rows: [] })
    sections[sections.length - 1].rows.push({ id: o.id, title: o.title })
  }
  if (last) sections[sections.length - 1].rows.push({ id: last.id, title: last.title })
  return sections
}

/**
 * Envia uma lista de opções pelo veículo certo do canal, respeitando `render` e os
 * LIMITES do interativo. `last` = opção de controle (última row/botão, "0️⃣" no numerado).
 */
export async function sendOptions(
  ctx: OutCtx,
  args: { render?: RenderMode; body: string; items: OptItem[]; last?: OptItem; listButton?: string; meta?: Record<string, unknown> },
): Promise<void> {
  const { render = "auto", body, items, last, listButton = "Ver opções", meta = {} } = args
  const text = numberedText(body, items, last)
  if (items.length === 0 || render === "numbered") { await sendBotText(ctx, text, meta); return }

  const all = last ? [...items, last] : items
  const maxTitle = Math.max(...all.map((o) => o.title.length))
  const grouped  = items.some((o) => o.group)

  // Escolha do veículo pela FIDELIDADE: só usa o que apresenta o texto INTEIRO.
  const fitsButtons = all.length <= 3 && maxTitle <= BTN_TITLE_MAX && !grouped
  const fitsList    = all.length <= LIST_ROWS_MAX && maxTitle <= ROW_TITLE_MAX
  if (!fitsButtons && !fitsList) { await sendBotText(ctx, text, meta); return }   // degrada: numerado

  const payload = fitsButtons
    ? { body: body.trim(), buttons: all.map((o) => ({ id: o.id, title: o.title })) }
    : { body: body.trim(), list: { buttonText: listButton, sections: buildSections(items, last) } }

  // Fail-safe (auditoria 2026-07-23 ALTO-1): provider que LANÇA (ex: 400 da Meta)
  // furava o `if (!sent)` → cliente no vácuo e run travado. Qualquer falha do
  // interativo degrada pro numerado — o cliente SEMPRE recebe as opções.
  let sent = false
  try {
    sent = await sendBotInteractive(ctx, payload, text, { ...meta, interactive_kind: fitsButtons ? "button" : "list" })
  } catch (e) {
    console.error("[sendOptions] interativo falhou, degradando pra numerado:", e instanceof Error ? e.message : e)
  }
  if (!sent) await sendBotText(ctx, text, meta)
}
