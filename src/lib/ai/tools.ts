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
export const SEND_MESSAGE_TOOL_NAME = "send_message"

/**
 * Tool de fala. Quando o trigger encaminha, o modelo responde SEMPRE via tool
 * (tool_choice=required): usa `send_message` pra conversar/coletar e
 * `route_to_department` pra encaminhar de fato. Isso impede o clássico
 * "narrou que ia encaminhar mas não chamou a tool" — falar e encaminhar
 * viram ações estruturadas distintas.
 */
export function buildSendMessageTool(): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name:        SEND_MESSAGE_TOOL_NAME,
      description:
        "Envie uma mensagem ao cliente — pra acolher, responder ou perguntar algo que ainda falta. " +
        "Use enquanto ainda NÃO é hora de encaminhar. Não diga que vai encaminhar aqui; pra encaminhar, use route_to_department.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "A mensagem pro cliente, no tom e estilo da persona." },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  }
}

export function parseSendMessage(rawArgs: string): { text: string } {
  try {
    const p = JSON.parse(rawArgs || "{}")
    return { text: typeof p.text === "string" ? p.text : "" }
  } catch {
    return { text: "" }
  }
}

export interface RouteToolSpec {
  departmentName: string
  requiredFields: AIRouteRequiredField[]
  /** Níveis de qualificação configurados (ex: ["quente","morno","frio"]). Vazio = sem qualificação. */
  levels?:        string[]
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
  const properties: Record<string, { type: string; description: string; enum?: string[] }> = {
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

  // Qualificação (opcional): a IA classifica o nível do lead. Enum vem da config.
  if (spec.levels && spec.levels.length > 0) {
    properties.lead_level = {
      type:        "string",
      enum:        spec.levels,
      description: "Classifique o nível de interesse/qualificação do lead com base na conversa.",
    }
    required.push("lead_level")
  }

  return {
    type: "function",
    function: {
      name:        ROUTE_TOOL_NAME,
      description:
        `Encaminhe a conversa para o departamento "${spec.departmentName}". ` +
        `Chame ASSIM QUE tiver os dados necessários (não fique só prometendo encaminhar via mensagem). ` +
        `Se ainda faltar algum dado, use send_message pra perguntar antes.`,
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
  leadLevel: string | null
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
    leadLevel: typeof parsed.lead_level === "string" && parsed.lead_level ? parsed.lead_level : null,
  }
}
