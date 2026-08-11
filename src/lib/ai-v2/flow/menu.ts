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
 * Resolve a opção escolhida pelo cliente, unificando as DUAS formas de resposta:
 *   • Oficial (Meta): tap num botão/lista → `optionId` = id da opção (= option.id, o
 *     mesmo que enviamos). Casa direto, sem ambiguidade — FONTE DA VERDADE.
 *   • Baileys / texto digitado: sem id → cai no parse de texto (número/rótulo).
 * Id-first garante o avanço mesmo quando o rótulo do botão não casa o texto (limite de
 * 20 chars da Meta trunca, emoji no label, etc.). Sem match em nenhum dos dois → null.
 */
export function resolveMenuChoice(
  cfg: MenuNodeConfig, reply: string, optionId?: string,
): { id: string; label: string } | null {
  if (optionId) {
    const byId = cfg.options.find((o) => o.id === optionId)
    if (byId) return byId
    // id presente mas DESCONHECIDO (ex.: menu trocado desde o envio, ou tap num
    // botão de outro contexto) → cai no texto; se também não casar, vira re-pergunta.
  }
  return parseMenuReply(cfg, reply)
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

/**
 * Escolha de botão no nó **Mensagem** — irmã de `resolveMenuChoice`, com uma regra a
 * MENOS e uma a MAIS.
 *
 * 🔴 **Por que não reusar `parseMenuReply`:** ele procura dígito em QUALQUER lugar da
 *    frase, porque no Menu a pessoa está sendo perguntada e "2" é a resposta esperada. No
 *    Mensagem, texto livre é legítimo (é a saída "Escreveu") — e aí aquela regra vira
 *    armadilha:
 *
 *      Nó com ▸ Valores ▸ Atendente. A pessoa escreve "sou o cliente 2 da loja".
 *      O casamento solto acha o "2" e manda pra Atendente. Ramo errado, calado.
 *
 * A escada, do mais confiável pro menos:
 *   1. `optionId` — tap num botão nativo (Instagram/WhatsApp Oficial). Identidade, imune a
 *      rótulo repetido ou truncado. É a fonte da verdade quando existe.
 *   2. rótulo exato — quem digitou o texto do botão escolheu ele.
 *   3. número SOZINHO ("2", "2." , " 2 ") — é como o canal sem botão nativo apresenta as
 *      opções. **Número no meio de frase NÃO conta.**
 *
 * Sem match → `null` ⇒ o chamador usa a saída "Escreveu".
 */
export function resolveRichButton(
  rich: { buttons?: { id: string; label: string; kind: "reply" | "url" }[] } | undefined,
  reply: string,
  optionId?: string,
): { id: string; label: string } | null {
  // ⚠️ Só botão de RESPOSTA vira ramo. O de link manda a pessoa pro navegador e nunca
  //    devolve evento — não há o que casar.
  const opts = (rich?.buttons ?? []).filter((b) => b.kind === "reply")
  if (opts.length === 0) return null

  if (optionId) {
    const byId = opts.find((o) => o.id === optionId)
    if (byId) return { id: byId.id, label: byId.label }
    // id desconhecido (nó editado desde o envio, ou tap de outro contexto) → tenta texto.
  }

  const r = reply.trim().toLowerCase()
  if (!r) return null

  const byLabel = opts.find((o) => o.label.trim().toLowerCase() === r)
  if (byLabel) return { id: byLabel.id, label: byLabel.label }

  const only = /^(\d{1,2})[.)]?$/.exec(r)
  if (only) {
    const i = parseInt(only[1], 10) - 1
    if (i >= 0 && i < opts.length) return { id: opts[i].id, label: opts[i].label }
  }
  return null
}
