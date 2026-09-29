"use client"

import type { RichMessage } from "@/lib/ai-v2/flow/types"

/**
 * CONTRATO do gatilho "Comentário no Instagram" + o verificador do direct.
 *
 * A EDIÇÃO mora em `components/studio/ig-comment-modal.tsx`. Este arquivo guarda o que
 * precisa ser compartilhado entre o modal, o runtime e a projeção da regra.
 *
 * O gatilho vive no nó de Início quando `trigger.type === "ig_comment"` — não é um nó solto
 * no canvas. Motivo (docs/instagram-studio-node-design.md §8.3): a private reply acontece
 * ANTES de existir conversa, e depois dela a Meta não deixa enviar mais nada até a pessoa
 * responder. Um passo no meio do fluxo quebraria no nó seguinte.
 */

/**
 * Snapshot do post CONGELADO na config.
 *
 * ⚠️ `thumbUrl` tem que ser a URL ESTÁVEL nossa (`/api/ig-thumb/<mediaId>`), nunca a do
 * CDN da Meta: aquela é assinada e morre em 1-2 dias, e este objeto vive meses no
 * `trigger` jsonb do fluxo. Quem escolhe o post chama `freezeInstagramThumbs`, que baixa
 * os bytes pro Storage e devolve a URL estável (ver src/lib/instagram/thumb.ts).
 */
export interface IgPostRef {
  id:        string
  permalink: string | null
  caption:   string | null
  isReel:    boolean
  timestamp: string | null
  thumbUrl:  string | null
}

export interface IgCommentTriggerConfig {
  posts:        IgPostRef[]
  keywords:     string[]
  keywordMatch: "contains" | "exact"
  dm:           string
  /** Direct rico (texto · imagem · botões). Quando existe, VENCE o `dm`.
   *  ⚠️ O compositor grava os DOIS (o `dm` recebe o texto) — o runtime cai no `dm` quando a
   *  montagem do formato rico falha, e a versão anterior do app ainda lê essa coluna
   *  durante um deploy. */
  dmRich?:      RichMessage
  publicReplies: string[]
}

/** Verificador vivo: o texto pede resposta? É a defesa contra queimar a bala única.
 *  ⚠️ Vive aqui e não no modal: é a régua ÚNICA do aviso. Duplicada, o cliente veria
 *  conselho diferente conforme a tela. */
export function dmHint(text: string): { tone: "ok" | "warn" | "none"; msg: string } {
  const t = text.trim()
  if (!t) return { tone: "none", msg: "" }
  if (t.length < 25) {
    return { tone: "warn", msg: "Muito curto. Diga quem você é e o que a pessoa ganha respondendo." }
  }
  const asks = /\?|\b(responde|responda|manda|mande|me diz|diga|digita|digite|escreve|escreva|comenta|comente|chama|chame)\b/i
  return asks.test(t)
    ? { tone: "ok",   msg: "Pede resposta — bom assim." }
    : { tone: "warn", msg: "Não pede resposta. A pessoa pode só ler e sair — e você não tem segunda chance." }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O PAINEL LATERAL FOI REMOVIDO (2026-08-02).
 *
 * Este arquivo era o editor do gatilho de comentário; hoje guarda só o CONTRATO
 * (`IgCommentTriggerConfig`, `IgPostRef`) e o verificador vivo (`dmHint`). A edição inteira
 * mora em `components/studio/ig-comment-modal.tsx`.
 *
 * Por que o paralelo existiu e por que acabou: o comment-to-DM estava em produção e
 * validado, então trocar o editor às cegas arriscava um funil que funcionava — o modal
 * nasceu opt-in, com prazo de morte registrado no ROADMAP. Validado ponta a ponta, o painel
 * saiu. Código paralelo sem data vira dívida permanente.
 *
 * ⚠️ `dmHint` continua AQUI de propósito: é a única régua do aviso ("o texto pede
 *    resposta?"), e duplicá-la no modal faria o cliente ver conselho diferente conforme a
 *    tela. Uma regra, um lugar.
 * ═══════════════════════════════════════════════════════════════════════════ */
