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
import { extractDossier } from "../flow/dossier"
import { logConversationEvent } from "@/lib/atendimento/events"

export const TRANSFER = "transfer"

interface TransferArgs {
  department:       string
  summary:          string
  handoffMessage:   string | null
  /** Dossiê coletado (pares label/value) — renderiza no card "Dossiê da IA". */
  collected:        { label: string; value: string }[]
  /** Campos-alvo (do `collect` do nó) — guiam a extração do dossiê. */
  collectHint:      string[]
  /** A transferência foi decidida pela IA (tool do Agente IA, ou nó após um Agente IA que
   *  coletou)? Default true. `false` = nó Transferir DETERMINÍSTICO (menu→transfer puro):
   *  NÃO extrai dossiê via LLM e NÃO rotula "pela IA" — apenas encaminha. */
  byAI:             boolean
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
  playbook: (ctx) => {
    const depts = (ctx.departments ?? []).map((d) => d.name)
    if (depts.length === 0) return "TRANSFERIR: nenhum departamento configurado — não use transfer."
    return "TRANSFERIR: quando o cliente quiser falar com uma pessoa OU a intenção estiver clara, encaminhe com transfer " +
      `(não fique só prometendo). Resuma o que entendeu no campo summary. Departamentos (use o nome EXATO): ${depts.join(", ")}.`
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
    const collectHint = Array.isArray(p.collect_hint)
      ? (p.collect_hint as unknown[]).filter((x): x is string => typeof x === "string")
      : []
    return {
      department:     typeof p.department === "string" ? p.department : "",
      summary:        typeof p.summary === "string" ? p.summary : "",
      handoffMessage: typeof p.handoff_message === "string" && p.handoff_message.trim() ? p.handoff_message.trim() : null,
      collected,
      collectHint,
      byAI:           p.byAI !== false,   // default true (caminho IA); o nó determinístico passa false
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

    // Dossiê: usa o que veio; senão EXTRAI da conversa via LLM — mas SÓ no caminho da IA
    // (byAI). Transfer DETERMINÍSTICO (menu→transfer puro, byAI=false) NÃO chama LLM:
    // "apenas transferir" significa apenas transferir, sem queimar token nem inventar dossiê.
    const collected = args.collected.length > 0
      ? args.collected
      : (args.byAI ? await extractDossier(ctx.model ?? "gpt-4.1", ctx.history ?? [], args.collectHint) : [])

    // 1) Dossiê factual como NOTA INTERNA (equipe vê; cliente não). O card "Dossiê
    //    da IA" renderiza `summary` + `collected` (dados coletados pela IA).
    const collectedLine = collected.length > 0
      ? `\nColetado: ${collected.map((c) => `${c.label}: ${c.value}`).join(" · ")}` : ""
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         `${args.byAI ? "🤖 Encaminhado pela IA" : "📋 Encaminhado"} → ${dept.name}${args.summary ? `\nResumo: ${args.summary}` : ""}${collectedLine}`,
      status:          "sent",
      is_private_note: true,
      // ai_routed=true só quando a IA esteve envolvida → renderiza o card "Dossiê da IA".
      // Determinístico (byAI=false) → false → vira pílula simples "📋 Encaminhado → Setor".
      metadata: { ai_routed: args.byAI, studio: true, department_id: dept.id, department_name: dept.name, summary: args.summary, collected },
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

    // Evento do ciclo (relatórios): a IA encaminhou pra fila do setor.
    await logConversationEvent({
      tenantId, conversationId, type: "transferred",
      actorKind:    args.byAI ? "ai" : "system",
      departmentId: dept.id,
      reason:       args.summary || null,
    })

    return { ok: true, routedDepartmentId: dept.id, sentText }
  },
})
