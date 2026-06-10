// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nó MENU canal-aware
// ═══════════════════════════════════════════════════════════════
// A MESMA abstração ("pergunta + opções + ramifica") renderiza por canal
// (doc: dual-stack):
//   • Oficial (Meta Cloud), dentro da janela → botões nativos (≤3) ou
//     lista nativa (4..10) via sendInteractive. O menu é sempre resposta a
//     uma mensagem do cliente, logo SEMPRE dentro da janela de 24h.
//   • QR/Baileys (ou qualquer provider sem interativo) → menu NUMERADO
//     universal (a Meta restringiu botões nativos no não-oficial).
// A LÓGICA de branch é idêntica nos dois: o id da opção vira a aresta. No
// inbound, tanto o número/label digitado quanto o id do botão tocado casam
// em parseMenuReply (o botão nativo carrega id=option.id e title=label).

import { sendBotText, sendBotInteractive } from "../outbound"
import type { ExecCtx } from "../capabilities/types"
import type { MenuNodeConfig } from "./types"

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

/** Representação numerada (texto) — fallback universal e o que persiste no inbox. */
function numberedText(cfg: MenuNodeConfig, opts: MenuNodeConfig["options"]): string {
  return [
    cfg.text.trim(),
    "",
    ...opts.map((o, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${o.label}`),
  ].join("\n")
}

/**
 * Renderiza e envia o menu. Tenta interativo nativo (Oficial); se o provider
 * não suportar, cai pro menu numerado. Persiste sempre a versão legível, pro
 * atendente ver no inbox exatamente as opções oferecidas.
 */
export async function sendMenu(ctx: ExecCtx, cfg: MenuNodeConfig): Promise<void> {
  const opts = cfg.options.slice(0, 10)
  const text = numberedText(cfg, opts)
  if (opts.length === 0) { await sendBotText(ctx, text, { studio_menu: true }); return }

  // ≤3 opções → botões de resposta; 4..10 → lista. (≥1 garantido acima.)
  const payload =
    opts.length <= 3
      ? { body: cfg.text.trim(), buttons: opts.map((o) => ({ id: o.id, title: o.label })) }
      : { body: cfg.text.trim(), list: {
          buttonText: "Ver opções",
          sections:  [{ rows: opts.map((o) => ({ id: o.id, title: o.label })) }],
        } }

  const sentNative = await sendBotInteractive(ctx, payload, text, {
    studio_menu:      true,
    interactive_kind: opts.length <= 3 ? "button" : "list",
  })
  if (!sentNative) await sendBotText(ctx, text, { studio_menu: true })
}

/**
 * Parseia a resposta do cliente → opção escolhida. Determinístico:
 *   1) número (1..n), tolerante a "1", "1.", "opção 2"
 *   2) label exato OU a resposta contém o label
 * Sem match → null (o runtime re-pergunta). Fuzzy via IA = melhoria futura.
 */
export function parseMenuReply(cfg: MenuNodeConfig, reply: string): { id: string; label: string } | null {
  const r = reply.trim().toLowerCase()
  if (!r) return null

  const num = r.match(/\d+/)
  if (num) {
    const idx = parseInt(num[0], 10) - 1
    if (idx >= 0 && idx < cfg.options.length) return cfg.options[idx]
  }

  for (const o of cfg.options) {
    const lbl = o.label.trim().toLowerCase()
    if (lbl && (r === lbl || r.includes(lbl))) return o
  }
  return null
}
