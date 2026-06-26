// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — AI Router (classificador de intenção) §11.4
// ═══════════════════════════════════════════════════════════════
// UMA chamada LLM (temperatura 0, sem tools) que lê a última mensagem
// (+ algum histórico recente) e escolhe a rota que melhor representa a
// intenção. Determinístico no efeito: devolve um route.id (ou "" pra
// cair no fallback/aresta default). Nunca lança — erro vira "".

import "server-only"
import { runChat } from "@/lib/ai/openai"

export interface Route { id: string; label: string; description?: string }

export async function classifyIntent(args: {
  model:        string
  routes:       Route[]
  instruction:  string | null
  history:      { role: "user" | "assistant"; content: string }[]
  incomingText: string
}): Promise<string> {
  const { model, routes, instruction, history, incomingText } = args
  if (routes.length === 0) return ""

  const list = routes
    .map((r) => `- ${r.id}: ${r.label}${r.description ? ` — ${r.description}` : ""}`)
    .join("\n")

  const sys = [
    "Você é um classificador de intenção de atendimento. Leia a conversa e escolha a ÚNICA rota que melhor representa o que o cliente quer AGORA.",
    instruction?.trim() ? `Contexto: ${instruction.trim()}` : "",
    "Rotas possíveis:",
    list,
    'Responda APENAS com o id exato da rota (ex: "vendas"). Nada além do id. Se nenhuma se aplicar, responda "none".',
  ].filter(Boolean).join("\n")

  // Só os últimos turnos importam pra intenção (barato + foco no recente).
  const recent = history.slice(-6)
  const messages = [
    { role: "system" as const, content: sys },
    ...recent,
    { role: "user" as const, content: incomingText },
  ]

  try {
    const res = await runChat({ model, messages, temperature: 0 })
    const out = (res.text ?? "").toLowerCase().trim()
    if (!out || out === "none") return ""
    // match tolerante: id exato → id contido → label contido.
    const hit =
      routes.find((r) => out === r.id.toLowerCase()) ??
      routes.find((r) => out.includes(r.id.toLowerCase())) ??
      routes.find((r) => r.label && out.includes(r.label.toLowerCase()))
    return hit?.id ?? ""
  } catch (e) {
    console.error("[studio/router] classify falhou:", e instanceof Error ? e.message : e)
    return ""
  }
}
