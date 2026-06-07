// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nó MENU canal-aware
// ═══════════════════════════════════════════════════════════════
// A MESMA abstração ("pergunta + opções + ramifica") renderiza por canal
// (doc: dual-stack). HOJE: menu numerado universal — funciona em Oficial
// E em QR/Baileys (a Meta restringiu botões nativos no não-oficial).
// TODO Oficial-dentro-da-janela: botões (≤3) / lista (≤10) interativos
// nativos — precisa de `sendInteractive` no meta-cloud-provider. A LÓGICA
// de branch não muda; só a superfície de render + o parse da resposta.

import { sendBotText } from "../outbound"
import type { ExecCtx } from "../capabilities/types"
import type { MenuNodeConfig } from "./types"

const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"]

/** Renderiza e envia o menu (numerado, universal). */
export async function sendMenu(ctx: ExecCtx, cfg: MenuNodeConfig): Promise<void> {
  const opts = cfg.options.slice(0, 10)
  const lines = [
    cfg.text.trim(),
    "",
    ...opts.map((o, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${o.label}`),
  ]
  await sendBotText(ctx, lines.join("\n"), { studio_menu: true })
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
