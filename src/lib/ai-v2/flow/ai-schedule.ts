// ═══════════════════════════════════════════════════════════════
// Kora Studio — nó AGENDAR, modo "Entender com IA" (parse → determinístico)
// ═══════════════════════════════════════════════════════════════
// A IA SÓ INTERPRETA o pedido (serviço + dia + período) via tool OBRIGATÓRIA —
// saída estruturada, temp 0. Ela NÃO oferta horário, NÃO marca, NÃO confirma: o
// motor determinístico (schedule.ts/booking.ts) faz isso. Logo é impossível ela
// inventar slot ou cravar agendamento (o pior caso degrada pra "serviço errado,
// cliente corrige no toque"). Conversa de verdade ("drenagem sexta tarde") +
// segurança determinística. Doc: capability-platform.md §"nó Agendamento IA".

import "server-only"
import type OpenAI from "openai"
import { runChat } from "@/lib/llm/openai"
import { runChatMetered, type UsageMeter } from "@/lib/llm/usage"

const TZ = "America/Sao_Paulo"

export interface ParsedRequest { service: string; fromDate: string; period: string }

const PARSE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "parse_scheduling_request",
    description: "Interpreta O QUE o cliente quer agendar. SÓ extrai — não agenda, não oferece horário.",
    parameters: {
      type: "object",
      properties: {
        service:   { type: "string", description: "Nome do serviço que o cliente quer, EXATAMENTE como na lista fornecida. Vazio se ele não deixou claro." },
        from_date: { type: "string", description: "Dia desejado em YYYY-MM-DD (resolva 'sexta'/'amanhã' com a data de hoje). Vazio se não citou um dia." },
        period:    { type: "string", enum: ["manha", "tarde", "noite", ""], description: "Período se o cliente citou (manhã/tarde/noite). Vazio se não." },
      },
      required: ["service", "from_date", "period"],
      additionalProperties: false,
    },
  },
}

/**
 * Interpreta o pedido de agendamento da conversa. Saída estruturada garantida
 * (tool obrigatória). Best-effort: erro/timeout → tudo vazio (cai no service
 * picker + oferta normal). `services` = nomes reais (a IA escolhe EXATO ou vazio).
 */
export async function parseScheduleRequest(
  model: string,
  history: { role: "user" | "assistant"; content: string }[],
  services: string[],
  /** Ledger de uso (kind "ai_parse"). Presente = gasto medido em studio_runs. */
  meter?: UsageMeter,
): Promise<ParsedRequest> {
  const empty: ParsedRequest = { service: "", fromDate: "", period: "" }
  try {
    if (history.length === 0) return empty
    const now = new Date()
    const hoje    = now.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
    const hojeIso = now.toLocaleDateString("en-CA",  { timeZone: TZ })
    const transcript = history
      .map((h) => `${h.role === "user" ? "Cliente" : "Atendente"}: ${h.content}`)
      .join("\n").slice(-4000)
    const system =
      `Você INTERPRETA um pedido de agendamento — NÃO agenda, NÃO oferece horário, só extrai o que o cliente quer. ` +
      `Hoje é ${hoje} (${hojeIso}); use pra resolver datas ("sexta" = a próxima sexta-feira; "amanhã" = ${hojeIso}+1). ` +
      (services.length ? `Serviços disponíveis (escolha o nome EXATO desta lista, ou deixe vazio se o cliente não deixou claro): ${services.join(", ")}. ` : "") +
      `Preencha SOMENTE o que o cliente disse; deixe vazio o resto. NÃO invente.`
    const params = {
      model,
      messages: [{ role: "system" as const, content: system }, { role: "user" as const, content: transcript }],
      tools:       [PARSE_TOOL],
      toolChoice:  { type: "function" as const, function: { name: "parse_scheduling_request" } },
      temperature: 0,
      timeoutMs:   15_000,
    }
    const res = meter ? await runChatMetered(meter, params) : await runChat(params)
    const call = res.toolCalls.find((t) => t.name === "parse_scheduling_request")
    if (!call) return empty
    const p = JSON.parse(call.arguments || "{}") as Record<string, unknown>
    const period   = typeof p.period === "string"   ? p.period.trim().toLowerCase() : ""
    const fromDate = typeof p.from_date === "string" ? p.from_date.trim()            : ""
    return {
      service:  typeof p.service === "string" ? p.service.trim() : "",
      fromDate: /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate : "",
      period:   ["manha", "tarde", "noite"].includes(period) ? period : "",
    }
  } catch (e) {
    console.error("[studio/ai-schedule] parse falhou:", e instanceof Error ? e.message : e)
    return empty
  }
}

// ── helpers de DIA/PERÍODO (honrar "sexta à tarde") — TZ-aware ──────────────
const PERIODS = new Set(["manha", "tarde", "noite"])

function hourInTZ(iso: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)))
}
/** O instante cai no período (manha <12 · tarde 12–18 · noite ≥18)? */
export function inPeriod(iso: string, period: string): boolean {
  if (!PERIODS.has(period)) return true
  const h = hourInTZ(iso)
  if (period === "manha") return h < 12
  if (period === "tarde") return h >= 12 && h < 18
  return h >= 18
}
function tzOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant))
  const p: Record<string, number> = {}
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
}
/** Intervalo UTC [00:00, 24:00) do dia local YYYY-MM-DD no fuso da agenda. null = inválido. */
export function localDayRange(dateStr: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0)
  const start = guess - tzOffsetMs(guess)
  return { start, end: start + 24 * 3600_000 }
}
