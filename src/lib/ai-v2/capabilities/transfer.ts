// ═══════════════════════════════════════════════════════════════
// Capacidade: encaminhar a conversa pra um departamento (terminal)
// ═══════════════════════════════════════════════════════════════
// Diferença-chave vs v1: o v2 grava a COLUNA real
// chat_conversations.department_id (não só metadata) → a conversa cai
// na FILA DO SETOR com badge "Aguardando · <Setor>" e aparece ao vivo
// pro time daquele departamento (visibilidade aditiva). Solta a IA
// (ai_handling=false) e deixa no pool (assigned_to=null) pro setor pegar.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { sendBotText } from "../outbound"

export const TRANSFER = "transfer"

interface TransferArgs {
  department:       string
  summary:          string
  handoffMessage:   string | null
  /** Dossiê coletado (pares label/value) — renderiza no card "Dossiê da IA". */
  collected:        { label: string; value: string }[]
}

export const transferCapability = defineCapability<TransferArgs>({
  id:           TRANSFER,
  name:         "Transferir pra departamento",
  category:     "ai",
  minPlanLevel: 0,
  isNode:       true,
  toolSchema: {
    type: "function",
    function: {
      name:        TRANSFER,
      description:
        "Encaminhe a conversa para um departamento humano quando a intenção estiver clara. " +
        "Use o nome EXATO do departamento listado no prompt. Chame assim que tiver o necessário — não fique só prometendo.",
      parameters: {
        type: "object",
        properties: {
          department:       { type: "string", description: "Nome do departamento de destino (um dos listados)." },
          summary:          { type: "string", description: "Resumo factual pro atendente: o que o cliente quer, em 1-2 frases." },
          handoff_message:  { type: "string", description: "(Opcional) mensagem curta de transição pro cliente antes de passar pro humano." },
        },
        required: ["department", "summary"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    const collected = Array.isArray(p.collected)
      ? (p.collected as unknown[]).flatMap((c) => {
          const o = c as { label?: unknown; value?: unknown }
          return typeof o?.label === "string" && o?.value != null
            ? [{ label: o.label, value: String(o.value) }] : []
        })
      : []
    return {
      department:     typeof p.department === "string" ? p.department : "",
      summary:        typeof p.summary === "string" ? p.summary : "",
      handoffMessage: typeof p.handoff_message === "string" && p.handoff_message.trim() ? p.handoff_message.trim() : null,
      collected,
    }
  },
  execute: async (ctx, args) => {
    const { tenantId, conversationId, conversationMetadata, departments } = ctx

    // Resolve nome → id (case/acento-insensível simples). Sem match → devolve
    // resultado pra LLM retentar com um nome válido (não encaminha às cegas).
    const norm = (s: string) => s.trim().toLowerCase()
    const dept = departments.find((d) => norm(d.name) === norm(args.department))
    if (!dept) {
      const opts = departments.map((d) => d.name).join(", ") || "(nenhum configurado)"
      return { ok: false, toolMessage: `Departamento "${args.department}" não existe. Opções válidas: ${opts}.` }
    }

    // 1) Dossiê factual como NOTA INTERNA (equipe vê; cliente não). O card "Dossiê
    //    da IA" renderiza `summary` + `collected` (dados coletados pela IA).
    const collectedLine = args.collected.length > 0
      ? `\nColetado: ${args.collected.map((c) => `${c.label}: ${c.value}`).join(" · ")}` : ""
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         `🤖 Encaminhado pela IA → ${dept.name}${args.summary ? `\nResumo: ${args.summary}` : ""}${collectedLine}`,
      status:          "sent",
      is_private_note: true,
      metadata: { ai_routed: true, studio: true, department_id: dept.id, department_name: dept.name, summary: args.summary, collected: args.collected },
    })

    // 2) Mensagem de transição pro cliente (se houver).
    let sentText: string | null = null
    if (args.handoffMessage) {
      try {
        await sendBotText(ctx, args.handoffMessage, { handoff: true })
        sentText = args.handoffMessage
      } catch (e) {
        console.error("[studio/transfer] falha ao enviar handoff:", e instanceof Error ? e.message : e)
      }
    }

    // 3) Solta a conversa pra FILA DO SETOR: coluna department_id (real) +
    //    metadata.ai_routed; IA para; fica no pool (assigned_to permanece null).
    await supabaseAdmin
      .from("chat_conversations")
      .update({
        ai_handling:          false,
        department_id:        dept.id,
        last_message_at:      new Date().toISOString(),
        last_message_preview: sentText ? sentText.substring(0, 100) : `Encaminhado para ${dept.name}`,
        last_message_dir:     "out",
        metadata:             { ...conversationMetadata, ai_routed: { department_id: dept.id, department_name: dept.name, at: new Date().toISOString() } },
        updated_at:           new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)

    return { ok: true, routedDepartmentId: dept.id, sentText }
  },
})
