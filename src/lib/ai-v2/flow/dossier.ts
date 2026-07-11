// ═══════════════════════════════════════════════════════════════
// Kora Studio — Captura confiável do DOSSIÊ (Studio Engine §Pilar 2)
// ═══════════════════════════════════════════════════════════════
// O dossiê NÃO pode depender do `finish_step.fields` (a IA preenche a critério
// dela → frágil). Aqui é uma ETAPA DETERMINÍSTICA do handoff: extrai os fatos da
// CONVERSA via uma tool OBRIGATÓRIA (saída estruturada garantida). Sempre roda,
// best-effort (falha → [] , nunca derruba o handoff). Doc: capability-platform.md.

import "server-only"
import type OpenAI from "openai"
import { runChat } from "@/lib/ai/openai"

const DOSSIER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "report_dossier",
    description: "Registra o dossiê factual da conversa pro time humano que vai assumir.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Fatos-chave que o CLIENTE informou. Vazio se não houver nada relevante.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Rótulo curto em pt-BR (ex: Segmento, Objetivo, Nº de atendentes)." },
              value: { type: "string", description: "O valor informado pelo cliente." },
            },
            required: ["label", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
}

const SYSTEM =
  "Você extrai um DOSSIÊ factual e CONCISO de uma conversa de atendimento, pro time humano que vai assumir. " +
  "Registre SOMENTE fatos que o CLIENTE informou: o que ele quer/precisa, segmento/ramo do negócio, tamanho/contexto " +
  "e dados específicos citados (orçamento, prazo, quantidades). NÃO invente, NÃO inclua falas do atendente, NÃO repita " +
  "identidade já óbvia (nome/telefone). Use rótulos curtos em pt-BR. Chame report_dossier — items vazio se nada relevante."

export interface DossierItem { label: string; value: string }

/**
 * Extrai o dossiê da conversa. SEMPRE roda no handoff (determinístico). Saída
 * estruturada via tool obrigatória. `hintFields` (do `collect` do nó) GARANTE que
 * esses campos apareçam quando o cliente os informou. Best-effort: erro → [].
 */
export async function extractDossier(
  model: string,
  history: { role: "user" | "assistant"; content: string }[],
  hintFields?: string[],
): Promise<DossierItem[]> {
  try {
    if (history.length < 2) return []   // conversa trivial → nada a extrair
    const transcript = history
      .map((h) => `${h.role === "user" ? "Cliente" : "Atendente"}: ${h.content}`)
      .join("\n")
      .slice(-6000)   // cap: só o trecho recente importa

    const hints = (hintFields ?? []).map((f) => f.trim()).filter(Boolean)
    const system = hints.length > 0
      ? `${SYSTEM}\nPRIORIZE estes campos quando o cliente os tiver informado: ${hints.join(", ")}. Além deles, capture outros fatos relevantes.`
      : SYSTEM

    const res = await runChat({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: transcript },
      ],
      tools:      [DOSSIER_TOOL],
      toolChoice: { type: "function", function: { name: "report_dossier" } },
      temperature: 0,
      timeoutMs:   15_000,
    })

    const call = res.toolCalls.find((t) => t.name === "report_dossier")
    if (!call) return []
    const parsed = JSON.parse(call.arguments || "{}") as { items?: unknown }
    const items = Array.isArray(parsed.items) ? parsed.items : []
    return items.flatMap((it) => {
      const o = it as { label?: unknown; value?: unknown }
      return typeof o?.label === "string" && o.label.trim() && o?.value != null && String(o.value).trim()
        ? [{ label: o.label.trim(), value: String(o.value).trim() }]
        : []
    })
  } catch (e) {
    console.error("[studio/dossier] extração falhou:", e instanceof Error ? e.message : e)
    return []   // nunca derruba o handoff
  }
}
