// ═══════════════════════════════════════════════════════════════
// Capacidade: buscar na base de conhecimento (RETRIEVAL → realimenta)
// ═══════════════════════════════════════════════════════════════
// RAG via TOOL (a IA decide quando consultar) — doc §2. Fatia atual usa
// busca por KEYWORD (ILIKE/trgm sobre studio_knowledge); o contrato da
// tool fica idêntico quando trocarmos por busca VETORIAL (pgvector) —
// só muda a implementação interna, não o agente. Retorna toolMessage:
// o resultado volta pra LLM como contexto pra responder com fundamento.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"

export const SEARCH_KNOWLEDGE = "search_knowledge"
const MAX_HITS = 4
const SNIPPET  = 600

export const searchKnowledgeCapability = defineCapability<{ query: string }>({
  id:           SEARCH_KNOWLEDGE,
  name:         "Buscar na base de conhecimento",
  category:     "ai",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        SEARCH_KNOWLEDGE,
      description:
        "Consulte a base de conhecimento da empresa (produtos, políticas, FAQ) antes de responder algo factual. " +
        "Use SEMPRE que a resposta depender de informação específica do negócio — não invente.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "O que buscar, em poucas palavras." } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return { query: typeof p.query === "string" ? p.query : "" }
  },
  execute: async (ctx, { query }) => {
    const q = query.trim()
    if (!q) return { ok: true, toolMessage: "Busca vazia." }

    // Keyword retrieval (ILIKE em título + conteúdo). Escape básico de % e _.
    const safe = q.replace(/[%_]/g, (c) => `\\${c}`).slice(0, 120)
    const { data, error } = await supabaseAdmin
      .from("studio_knowledge")
      .select("title, content")
      .eq("tenant_id", ctx.tenantId)
      .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
      .limit(MAX_HITS)

    if (error) return { ok: false, error: `search_knowledge: ${error.message}` }
    if (!data || data.length === 0) {
      return { ok: true, toolMessage: `Nada encontrado na base para "${q}". Não invente; se não souber, ofereça encaminhar a um humano.` }
    }

    const blocks = data.map((k, i) => `[${i + 1}] ${k.title}\n${k.content.slice(0, SNIPPET)}`).join("\n\n")
    return { ok: true, toolMessage: `Trechos da base de conhecimento:\n\n${blocks}` }
  },
})
