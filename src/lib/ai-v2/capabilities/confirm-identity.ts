// ═══════════════════════════════════════════════════════════════
// Capacidade: CONFIRMAR IDENTIDADE (verificação leve)
// ═══════════════════════════════════════════════════════════════
// docs/studio-data-source-node-design.md §7.2. Resposta ao NÚMERO RECICLADO: o
// WhatsApp que era da Maria hoje é do João → sem isto a IA contaria os dados da Maria.
// Só existe quando uma Fonte de Consulta liga "verificação leve" (opt-in). Aí as tools
// de consulta ficam TRAVADAS até esta confirmar (flag em conversationMetadata).
//
// Deriva o dado por contato (não a IA): tem CPF/CNPJ no cadastro (chat_contacts.doc_id)
// → pede os 4 PRIMEIROS dígitos (parcial, nunca o inteiro — não treina despejo de CPF pra
// bot; os PRIMEIROS evitam a fraqueza dos 2 últimos, que são dígitos verificadores
// computáveis); senão → pede o nome. 3 tentativas erradas → trava e manda pro humano
// (10.000 combos × 3 chutes = 0,03%; brute-force morre aqui).
//
// ⚠️ DOUTRINA: é a ÚNICA tool de consulta COM parâmetro (a resposta do cliente). NÃO
// fura o anti-IDOR — ela confirma o PRÓPRIO contato da conversa (ctx.contact), nunca
// seleciona outro. O `answer` é só o texto que o cliente digitou, higienizado.

import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { safeValue } from "../safe-text"
import type { ExecCtx } from "./types"

export const CONFIRM_IDENTITY = "confirm_identity"

const MAX_TRIES = 3

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()

/** Nome bate se a resposta contém o nome inteiro OU o primeiro E o último token. */
function nameMatches(name: string, answer: string): boolean {
  const n = norm(name), a = norm(answer)
  if (!n || !a) return false
  if (a.includes(n)) return true
  const toks = n.split(" ").filter((t) => t.length >= 2)
  if (toks.length >= 2) return a.includes(toks[0]) && a.includes(toks[toks.length - 1])
  return toks.length === 1 ? a.includes(toks[0]) : false
}

/** Persiste a flag na metadata da conversa (cross-turn) + espelha no ctx (same-turn).
 *  Anti-clobber: relê fresco e funde só o patch. Nunca loga a resposta (§5 skill). */
async function stampMeta(ctx: ExecCtx, patch: Record<string, unknown>): Promise<void> {
  ctx.conversationMetadata = { ...(ctx.conversationMetadata ?? {}), ...patch }
  if (ctx.dryRun) return
  const { data } = await supabaseAdmin.from("chat_conversations")
    .select("metadata").eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId).maybeSingle()
  const fresh = (data?.metadata as Record<string, unknown> | null) ?? {}
  await supabaseAdmin.from("chat_conversations")
    .update({ metadata: { ...fresh, ...patch } })
    .eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
}

interface Args { answer: string }

export const confirmIdentityCapability = defineCapability<Args>({
  id:           CONFIRM_IDENTITY,
  name:         "Confirmar identidade",
  category:     "external",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        CONFIRM_IDENTITY,
      description: "Confirma a identidade do cliente quando uma consulta exigir verificação. Passe em `answer` o que o cliente respondeu (os dígitos do CPF ou o nome). Use SÓ quando uma consulta pedir a confirmação primeiro.",
      parameters: {
        type: "object",
        properties: { answer: { type: "string", description: "O que o cliente respondeu pra confirmar (dígitos do CPF ou nome completo)." } },
        required: ["answer"], additionalProperties: false,
      },
    },
  },
  playbook: () =>
    "CONFIRMAR IDENTIDADE: se uma consulta pedir pra confirmar a identidade antes de detalhar, peça ao cliente o dado indicado (os primeiros dígitos do CPF, ou o nome dele) de forma natural — pode enquadrar como \"só pra confirmar que é você mesmo\". Chame confirm_identity com a resposta. Só siga com a consulta depois do OK. NUNCA revele qual é o valor certo, nunca diga quantas tentativas faltam, e não detalhe nada antes de confirmar.",
  parseArgs: (raw): Args => {
    const o = (raw ?? {}) as Record<string, unknown>
    return { answer: typeof o.answer === "string" ? o.answer : String(o.answer ?? "") }
  },
  execute: async (ctx, args) => {
    const m = ctx.conversationMetadata ?? {}
    if (m.__id_ok === true) {
      return { ok: true, toolMessage: "Identidade já confirmada nesta conversa. Pode responder normalmente." }
    }
    if (m.__id_blocked === true) {
      return { ok: true, toolMessage: "As tentativas já se esgotaram. NÃO revele nenhum dado; diga com calma que, por segurança, um atendente humano vai continuar." }
    }

    const doc  = (ctx.contact.doc_id ?? "").replace(/\D/g, "")
    const name = (ctx.contact.custom_name?.trim() || ctx.contact.push_name?.trim() || "")
    const ans  = safeValue(args.answer, 80)

    let matched = false
    if (doc.length >= 4) {
      const ansDigits = ans.replace(/\D/g, "")
      matched = ansDigits.length >= 4 && ansDigits.slice(0, 4) === doc.slice(0, 4)
    } else if (name) {
      matched = nameMatches(name, ans)
    } else {
      // Sem CPF e sem nome no cadastro → não há como confirmar. Fail-closed p/ humano.
      return { ok: true, toolMessage: "Não há dado de identidade no cadastro pra confirmar. NÃO revele; diga que um atendente humano vai continuar." }
    }

    if (matched) {
      await stampMeta(ctx, { __id_ok: true })
      return { ok: true, toolMessage: "Identidade CONFIRMADA. Pode responder a consulta do cliente agora, com naturalidade." }
    }

    const tries = (typeof m.__id_tries === "number" ? m.__id_tries : 0) + 1
    if (tries >= MAX_TRIES) {
      await stampMeta(ctx, { __id_tries: tries, __id_blocked: true })
      return { ok: true, toolMessage: "Não confere e as tentativas acabaram. NÃO revele nenhum dado; diga com calma que, por segurança, um atendente humano vai continuar." }
    }
    await stampMeta(ctx, { __id_tries: tries })
    return { ok: true, toolMessage: "Não confere. Peça de novo com gentileza — sem dizer quantas tentativas restam e sem dar dica do valor certo." }
  },
})
