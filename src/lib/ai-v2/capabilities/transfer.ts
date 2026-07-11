// ═══════════════════════════════════════════════════════════════
// Capacidade: transferir a conversa (terminal) — nó ROBUSTO (F1)
// ═══════════════════════════════════════════════════════════════
// docs/transfer-node-design.md. 3 blocos:
//   1. DESTINO — fila do setor (department) · atendente específico (agent) ·
//      devolver ao responsável (owner) · fila geral (pool). Espelha a semântica
//      da transferência MANUAL (transferConversation): fila do setor zera o dono;
//      agent vira o dono; owner mantém; pool zera tudo.
//   2. DISPONIBILIDADE + PLANO B — checa horário comercial (♻ business-hours) +
//      gente ativa no destino (♻ self-pause). Indisponível → fallback:
//      queue (enfileira mesmo assim, =clássico) · wait_message (avisa e enfileira)
//      · keep_ai (NÃO transfere; a IA segue na frente).
//   3. GUARDA — destino inválido no caminho DETERMINÍSTICO vira nota interna
//      visível (não mais no-op silencioso); no caminho da IA devolve toolMessage
//      pra LLM re-tentar. (Anti-loop avaliado: transfer é terminal por turno —
//      sem vetor de loop; contador seria especulação.)
// Emite eventos: `transferred` (sempre que encaminha) + `plan_b` (fallback disparou).
//
// v2 grava a COLUNA real chat_conversations.department_id → conversa cai na FILA
// DO SETOR com badge "Aguardando · <Setor>" (visibilidade aditiva).
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { sendBotText } from "../outbound"
import { extractDossier } from "../flow/dossier"
import { logConversationEvent } from "@/lib/atendimento/events"
import { checkDestinationAvailability } from "@/lib/atendimento/availability"
import type { TransferTarget, TransferFallback } from "../flow/types"

export const TRANSFER = "transfer"

interface TransferArgs {
  /** Destino (default department — tool da IA e nós antigos). */
  target:           TransferTarget
  department:       string
  /** user_id do atendente (target=agent). */
  agentId:          string | null
  summary:          string
  handoffMessage:   string | null
  /** Plano B quando indisponível (default queue = comportamento clássico). */
  whenUnavailable:  TransferFallback
  /** Mensagem ao cliente quando o Plano B dispara. */
  waitMessage:      string | null
  /** Dossiê coletado (pares label/value) — renderiza no card "Dossiê da IA". */
  collected:        { label: string; value: string }[]
  /** Campos-alvo (do `collect` do nó) — guiam a extração do dossiê. */
  collectHint:      string[]
  /** A transferência foi decidida pela IA? `false` = nó determinístico:
   *  NÃO extrai dossiê via LLM e NÃO rotula "pela IA" — apenas encaminha. */
  byAI:             boolean
  /** true = config SEM `target` (nó antigo/tool da IA) → preserva a semântica
   *  clássica: department NÃO mexe no assigned_to nem no reopen_owner (zero
   *  mudança de comportamento pra fluxo publicado antes do F1). */
  legacyTarget:     boolean
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
    const legacyTarget = p.target == null   // nó antigo / tool da IA — semântica clássica
    const target: TransferTarget =
      p.target === "agent" || p.target === "owner" || p.target === "pool" ? p.target : "department"
    const fallback: TransferFallback =
      p.when_unavailable === "wait_message" || p.when_unavailable === "keep_ai" ? p.when_unavailable : "queue"
    return {
      target,
      department:     typeof p.department === "string" ? p.department : "",
      agentId:        typeof p.agent_id === "string" && p.agent_id ? p.agent_id : null,
      summary:        typeof p.summary === "string" ? p.summary : "",
      handoffMessage: typeof p.handoff_message === "string" && p.handoff_message.trim() ? p.handoff_message.trim() : null,
      whenUnavailable: fallback,
      waitMessage:    typeof p.wait_message === "string" && p.wait_message.trim() ? p.wait_message.trim() : null,
      collected,
      collectHint,
      byAI:           p.byAI !== false,   // default true (caminho IA); o nó determinístico passa false
      legacyTarget,
    }
  },
  execute: async (ctx, args) => {
    const { tenantId, conversationId, conversationMetadata, departments } = ctx

    // Estado atual da conversa (dono/setor) — from_agent dos eventos + target=owner.
    const { data: convRow } = await supabaseAdmin
      .from("chat_conversations")
      .select("assigned_to, department_id")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    const prevOwner = (convRow as { assigned_to: string | null } | null)?.assigned_to ?? null
    const prevDept  = (convRow as { department_id: string | null } | null)?.department_id ?? null

    // ── Bloco 1: resolve o DESTINO → { assignTo, deptId, label } ──────────
    // GUARDA: destino inválido → IA re-tenta (toolMessage); determinístico → nota
    // interna VISÍVEL (não mais no-op silencioso).
    const fail = async (msg: string) => {
      if (!args.byAI) {
        await supabaseAdmin.from("chat_messages").insert({
          conversation_id: conversationId, tenant_id: tenantId,
          sender_type: "system", content_type: "text",
          content: `⚠️ Transferência do fluxo FALHOU: ${msg} Revise o nó Transferir no Kora Studio.`,
          status: "delivered", is_private_note: true,
        })
      }
      return { ok: false, toolMessage: msg, error: msg }
    }

    let assignTo: string | null = null
    let deptId:   string | null = null
    let deptName: string | null = null
    let label = ""
    // Legado (sem target salvo): NÃO mexe em assigned_to nem em reopen_owner —
    // fluxo publicado antes do F1 (e o tool da IA) se comporta EXATAMENTE como hoje.
    let touchAssigned = !args.legacyTarget

    if (args.target === "department") {
      const norm = (s: string) => s.trim().toLowerCase()
      const dept = departments.find((d) => norm(d.name) === norm(args.department))
      if (!dept) {
        const opts = departments.map((d) => d.name).join(", ") || "(nenhum configurado)"
        return fail(`Departamento "${args.department}" não existe. Opções válidas: ${opts}.`)
      }
      deptId = dept.id; deptName = dept.name
      assignTo = null                       // fila do setor de verdade (espelha o manual)
      label = `o departamento ${dept.name}`
    } else if (args.target === "agent") {
      if (!args.agentId) return fail("Nó Transferir sem atendente selecionado.")
      const { data: member } = await supabaseAdmin
        .from("tenant_users")
        .select("user_id, department_id")
        .eq("tenant_id", tenantId).eq("user_id", args.agentId).eq("active", true)
        .maybeSingle()
      if (!member) return fail("O atendente configurado não está mais ativo neste workspace.")
      const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", args.agentId).maybeSingle()
      assignTo = args.agentId
      deptId   = (member as { department_id: string | null }).department_id ?? prevDept  // herda; não limpa à toa
      label    = prof?.full_name ?? "o atendente"
    } else if (args.target === "owner") {
      // Devolver ao responsável (carteira). Sem dono ativo → degrada pra fila geral.
      let ownerOk = false
      if (prevOwner) {
        const { data: m } = await supabaseAdmin
          .from("tenant_users").select("user_id")
          .eq("tenant_id", tenantId).eq("user_id", prevOwner).eq("active", true).maybeSingle()
        ownerOk = !!m
      }
      if (ownerOk) {
        assignTo = prevOwner; deptId = prevDept
        label = "o responsável pelo cliente"
      } else {
        assignTo = null; deptId = null
        label = "a fila geral (cliente sem responsável ativo)"
      }
    } else { // pool
      assignTo = null; deptId = null
      label = "a fila geral"
    }

    // ── Bloco 2: DISPONIBILIDADE + Plano B ────────────────────────────────
    // Legado com dono preservado: a checagem de gente olha o destino EFETIVO
    // (dono mantido = ele; senão o setor).
    const effectiveAgent = touchAssigned ? assignTo : (prevOwner ?? assignTo)
    const avail = await checkDestinationAvailability(tenantId, {
      departmentId: args.target === "department" && !effectiveAgent ? deptId : null,
      agentId:      effectiveAgent,
    })
    let planB: TransferFallback | null = null
    if (!avail.available) {
      planB = args.whenUnavailable
      await logConversationEvent({
        tenantId, conversationId, type: "plan_b",
        actorKind: args.byAI ? "ai" : "system",
        toAgentId: assignTo, departmentId: deptId,
        reason: avail.reason,
        meta: { action: planB, target: args.target },
      })
      // Mensagem de espera (wait_message E keep_ai enviam, se configurada).
      if (args.waitMessage && (planB === "wait_message" || planB === "keep_ai")) {
        try { await sendBotText(ctx, args.waitMessage, { handoff: planB !== "keep_ai" }) }
        catch (e) { console.error("[studio/transfer] falha na msg de espera:", e instanceof Error ? e.message : e) }
      }
      if (planB === "keep_ai") {
        // NÃO transfere: a IA segue na frente (ai_handling intacto). O runtime
        // trata keptAI como turno respondido — senão o hand-back derrubaria a IA.
        await supabaseAdmin.from("chat_messages").insert({
          conversation_id: conversationId, tenant_id: tenantId,
          sender_type: "system", content_type: "text",
          content: `🤖 Transferência adiada (${avail.reason === "off_hours" ? "fora do horário" : "ninguém disponível"}) — a IA segue atendendo (Plano B do fluxo).`,
          status: "delivered", is_private_note: true,
        })
        return { ok: true, keptAI: true, sentText: args.waitMessage ?? null }
      }
      // queue/wait_message → segue e encaminha mesmo assim (fila espera o time voltar).
    }

    // ── Dossiê: usa o que veio; senão EXTRAI da conversa via LLM — SÓ no caminho
    // da IA (byAI). Determinístico não chama LLM (nem inventa dossiê).
    const collected = args.collected.length > 0
      ? args.collected
      : (args.byAI ? await extractDossier(ctx.model ?? "gpt-4.1", ctx.history ?? [], args.collectHint) : [])

    // 1) Nota interna (equipe vê; cliente não) — card "Dossiê da IA" (byAI) ou pílula.
    const collectedLine = collected.length > 0
      ? `\nColetado: ${collected.map((c) => `${c.label}: ${c.value}`).join(" · ")}` : ""
    const planBLine = planB
      ? `\n⏳ ${avail.reason === "off_hours" ? "Fora do horário comercial" : "Ninguém disponível agora"} — entrou na fila pro time ver quando voltar.` : ""
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         `${args.byAI ? "🤖 Encaminhado pela IA" : "📋 Encaminhado"} → ${deptName ?? label}${args.summary ? `\nResumo: ${args.summary}` : ""}${collectedLine}${planBLine}`,
      status:          "sent",
      is_private_note: true,
      // ai_routed=true só quando a IA esteve envolvida → renderiza o card "Dossiê da IA".
      metadata: { ai_routed: args.byAI, studio: true, department_id: deptId, department_name: deptName, summary: args.summary, collected },
    })

    // 2) Mensagem de transição pro cliente (se houver e ainda não mandou espera).
    let sentText: string | null = null
    if (args.handoffMessage && !(planB === "wait_message" && args.waitMessage)) {
      try {
        await sendBotText(ctx, args.handoffMessage, { handoff: true })
        sentText = args.handoffMessage
      } catch (e) {
        console.error("[studio/transfer] falha ao enviar handoff:", e instanceof Error ? e.message : e)
      }
    } else if (planB === "wait_message" && args.waitMessage) {
      sentText = args.waitMessage
    }

    // 3) Aplica o destino: dono/setor + solta a IA. Destino EXPLÍCITO define o
    //    dono e mata o backup reopen_owner (a escolha do autor do fluxo vence o
    //    band-aid do restore); legado preserva ambos (comportamento clássico).
    const preview = sentText ? sentText.substring(0, 100) : `Encaminhado para ${deptName ?? label}`
    const nextMeta: Record<string, unknown> = { ...conversationMetadata, ai_routed: { department_id: deptId, department_name: deptName, at: new Date().toISOString() } }
    if (touchAssigned) delete nextMeta.reopen_owner
    await supabaseAdmin
      .from("chat_conversations")
      .update({
        ai_handling:          false,
        ...(touchAssigned ? { assigned_to: assignTo } : {}),
        department_id:        deptId,
        last_message_at:      new Date().toISOString(),
        last_message_preview: preview,
        last_message_dir:     "out",
        metadata:             nextMeta,
        updated_at:           new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)

    // 4) Evento do ciclo (relatórios). Legado com dono preservado → to = dono.
    await logConversationEvent({
      tenantId, conversationId, type: "transferred",
      actorKind:    args.byAI ? "ai" : "system",
      fromAgentId:  prevOwner,
      toAgentId:    touchAssigned ? assignTo : prevOwner,
      departmentId: deptId,
      reason:       args.summary || args.target,
    })

    // routedDepartmentId pode ser null (pool/owner/agent sem setor) — o runtime
    // usa `ok` pra saber que encaminhou; o tool path (IA) é sempre department.
    return { ok: true, routedDepartmentId: deptId, sentText }
  },
})
