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

import { sendBotText } from "../outbound"
import { sendOptions } from "./interactive"
import type { ExecCtx } from "../capabilities/types"
import type { MenuNodeConfig } from "./types"

/**
 * Renderiza e envia o menu pelo veículo certo do canal (respeita cfg.render:
 * auto/interactive/numbered). Persiste sempre a versão legível, pro atendente ver
 * no inbox exatamente as opções oferecidas. Delega o craft de render a sendOptions.
 */
export async function sendMenu(ctx: ExecCtx, cfg: MenuNodeConfig): Promise<void> {
  const opts = (cfg.options ?? []).slice(0, 10)
  if (opts.length === 0) { await sendBotText(ctx, (cfg.text ?? "").trim(), { studio_menu: true }); return }
  await sendOptions(ctx, {
    render:     cfg.render,
    body:       cfg.text ?? "",
    items:      opts.map((o) => ({ id: o.id, title: o.label })),
    listButton: "Ver opções",
    meta:       { studio_menu: true },
  })
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
