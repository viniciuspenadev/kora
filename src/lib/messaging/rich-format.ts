import type { RichMessage } from "@/lib/ai-v2/flow/types"

/**
 * Qual FORMATO uma `RichMessage` vira no canal — a decisão, num lugar só.
 *
 * 🔴 **FONTE ÚNICA, e é o ponto do arquivo.** Quem envia (`lib/instagram/rich-render.ts`)
 *    e quem exibe o rótulo no compositor (`components/studio/rich-composer.tsx`) chamam
 *    ESTA função. Se o rótulo tivesse a própria regra, a tela diria "cartão" e a Meta
 *    receberia outra coisa — e o cliente só descobriria com o direct já gasto (a bala é
 *    única e não volta).
 *
 * 🔴 **O TIPO É ESCOLHIDO PELA PESSOA** (decisão do dono, 2026-08-01). A 1ª versão derivava
 *    do conteúdo e o dono recusou: *"não quero esse negócio de automático"*. Escolher é o
 *    modelo do ManyChat e é o que ele espera da tela.
 *
 *    ⚠️ Minha objeção era "escolher 'cartão' sem imagem = duas fontes de verdade brigando".
 *    Ela **foi resolvida no compositor, não no dado**: o tipo escolhido decide QUAIS CAMPOS
 *    EXISTEM na tela — sem imagem à vista, não há como escolher cartão e deixá-la vazia.
 *    O estado impossível deixa de ser possível de digitar, em vez de ser validado depois.
 *
 * ⚠️ `format` é OPCIONAL no dado: fluxo salvo antes disto (e o `dm` string legado) não tem
 *    o campo. Aí cai na derivação pelo conteúdo — que continua existindo justamente pra
 *    isso, e não como comportamento normal.
 *
 * Sem server-only de propósito: o compositor é client.
 */

export type RichFormat = "text" | "buttons" | "card" | "media" | "empty"

/** Formato ESCOLHIDO; sem escolha (dado legado), derivado do conteúdo. */
export function richFormat(msg: RichMessage): RichFormat {
  if (msg.format) return msg.format
  return deriveRichFormat(msg)
}

/** Derivação — só pra dado antigo, que nasceu antes do seletor existir. */
export function deriveRichFormat(msg: RichMessage): RichFormat {
  const hasMedia   = !!msg.media?.path
  const hasButtons = (msg.buttons ?? []).length > 0

  if (hasMedia && hasButtons) return "card"     // generic template
  if (hasButtons)             return "buttons"  // button template (aguenta texto longo)
  if (hasMedia)               return "media"    // anexo puro (bytes → attachment_id)
  if (msg.text?.trim())       return "text"
  return "empty"
}

/** O que cada formato aceita — é isto que faz o compositor mostrar/esconder campo. */
export const RICH_FORMAT_FIELDS: Record<Exclude<RichFormat, "empty">,
  { text: boolean; media: boolean; buttons: boolean }> = {
  text:    { text: true,  media: false, buttons: false },
  buttons: { text: true,  media: false, buttons: true  },
  card:    { text: true,  media: true,  buttons: true  },
  media:   { text: false, media: true,  buttons: false },
}

/** Os cartões do seletor, na ordem da tela. */
export const RICH_FORMAT_OPTIONS: Array<{ key: Exclude<RichFormat, "empty">; title: string; desc: string }> = [
  { key: "text",    title: "Só texto",         desc: "uma mensagem simples" },
  { key: "buttons", title: "Texto e botões",   desc: "o toque abre a conversa" },
  { key: "card",    title: "Cartão com imagem", desc: "imagem, texto e botões" },
  { key: "media",   title: "Só imagem",        desc: "sem texto nem botão" },
]

/** Como o formato é chamado na tela. Fala do RESULTADO, não do nome técnico da Meta. */
export function richFormatLabel(f: RichFormat): string {
  switch (f) {
    case "card":    return "Cartão com imagem e botões"
    case "buttons": return "Mensagem com botões"
    case "media":   return "Só a imagem"
    case "text":    return "Mensagem de texto"
    default:        return "Vazio"
  }
}

/**
 * A ressalva que muda o que a pessoa deve fazer — `null` quando não há nenhuma.
 * ⚠️ Só aparece quando é consequência REAL, nunca como aviso preventivo.
 */
export function richFormatCaveat(f: RichFormat, msg: RichMessage): string | null {
  // Cartão: title(80) + subtitle(80). Texto maior é cortado pela própria Meta.
  if (f === "card" && (msg.text?.trim().length ?? 0) > 160) {
    return "No cartão cabem 160 caracteres. O resto é cortado — use \"Texto e botões\" pro texto inteiro."
  }
  return null
}

/**
 * O que ainda FALTA pro formato escolhido poder ser enviado — `null` = está completo.
 *
 * 🔴 Existe porque o tipo agora é escolhido: dá pra selecionar "Cartão com imagem" e ainda
 *    não ter subido a imagem. A tela mostra isto ao vivo, e `validateIgPublish` usa a MESMA
 *    função pra recusar a publicação — a bala é única, formato incompleto não pode ir ao ar.
 */
export function richFormatMissing(msg: RichMessage): string | null {
  const f = richFormat(msg)
  if (f === "empty") return "Escreva o direct que a pessoa recebe."
  const need = RICH_FORMAT_FIELDS[f]
  if (need.text  && !msg.text?.trim())            return "Escreva o texto da mensagem."
  if (need.media && !msg.media?.path)             return "Adicione a imagem do cartão."
  if (need.buttons && !(msg.buttons ?? []).length) return "Adicione ao menos um botão."
  if ((msg.buttons ?? []).some((b) => !b.label.trim()))                 return "Um dos botões está sem rótulo."
  if ((msg.buttons ?? []).some((b) => b.kind === "url" && !b.url?.trim())) return "Um dos botões de link está sem endereço."
  return null
}
