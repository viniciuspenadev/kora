// ═══════════════════════════════════════════════════════════════
// Tools do MVP — APENAS route_to_department
// ═══════════════════════════════════════════════════════════════
// O schema é construído DINAMICAMENTE a partir dos required_fields da
// rota: cada campo vira uma propriedade nomeada e obrigatória. Isso
// força o modelo a coletar exatamente o que o cliente configurou
// (aderência > tool genérica com objeto livre).

import type OpenAI from "openai"
import type { AIRouteRequiredField } from "@/types/ai"

export const ROUTE_TOOL_NAME = "route_to_department"

export interface RouteToolSpec {
  departmentName: string
  requiredFields: AIRouteRequiredField[]
}

const JSON_TYPE: Record<AIRouteRequiredField["type"], string> = {
  text:   "string",
  number: "number",
  email:  "string",
  phone:  "string",
}

/**
 * Monta a definição da tool `route_to_department` pro turno atual.
 * `summary` sempre presente (dossiê factual pro humano). Campos da rota
 * entram como propriedades obrigatórias e tipadas.
 */
export function buildRouteTool(spec: RouteToolSpec): OpenAI.Chat.Completions.ChatCompletionTool {
  const properties: Record<string, { type: string; description: string }> = {
    summary: {
      type:        "string",
      description: "Resumo objetivo pro atendente humano: o que o cliente quer, em 1-2 frases. Factual, sem floreio.",
    },
  }
  const required: string[] = ["summary"]

  for (const f of spec.requiredFields) {
    properties[f.key] = {
      type:        JSON_TYPE[f.type] ?? "string",
      description: f.label,
    }
    required.push(f.key)
  }

  return {
    type: "function",
    function: {
      name:        ROUTE_TOOL_NAME,
      description:
        `Encaminhe a conversa para o departamento "${spec.departmentName}" quando tiver coletado os dados necessários. ` +
        `Chame esta função SOMENTE quando estiver pronto pra passar pro humano — não antes de ter o que foi pedido.`,
      parameters: {
        type:       "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  }
}

export interface ParsedRouteCall {
  summary:   string
  collected: Record<string, string>
}

/** Extrai os args da chamada da tool de forma tolerante (nunca lança). */
export function parseRouteCall(rawArgs: string, requiredFields: AIRouteRequiredField[]): ParsedRouteCall {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(rawArgs || "{}")
  } catch {
    parsed = {}
  }

  const collected: Record<string, string> = {}
  for (const f of requiredFields) {
    const v = parsed[f.key]
    if (v != null && v !== "") collected[f.key] = String(v)
  }

  return {
    summary:   typeof parsed.summary === "string" ? parsed.summary : "",
    collected,
  }
}
