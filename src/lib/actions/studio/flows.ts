"use server"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — actions de FLUXOS (CRUD + publicar)
// ═══════════════════════════════════════════════════════════════
// Grava o grafo (nós+arestas) em studio_flows.graph. O runtime da
// Fatia 4 lê e executa esse mesmo formato — sem conversão.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { isWindowOpen } from "@/lib/channels/policy"
import { runStudioTurn } from "@/lib/ai-v2/run"
import type { FlowGraph, FlowTrigger } from "@/lib/ai-v2/flow/types"
import type { StudioFlowSummary, StudioFlowFull } from "@/types/studio"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

export async function listFlows(): Promise<StudioFlowSummary[]> {
  const session = await requireAdmin()
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .select("id, name, status, active, version, trigger, updated_at")
    .eq("tenant_id", session.user.tenantId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as StudioFlowSummary[]
}

export async function getFlow(id: string): Promise<StudioFlowFull | null> {
  const session = await requireAdmin()
  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .select("id, name, status, active, version, trigger, graph")
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as StudioFlowFull | null) ?? null
}

export async function createFlow(name: string): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  const clean = name.trim() || "Novo fluxo"
  // Semente: só o nó start. O editor insere os passos a partir dele.
  const graph: FlowGraph = { nodes: [{ id: "start", type: "start", config: {} }], edges: [] }
  const trigger: FlowTrigger = { type: "keyword", keywords: [] }

  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .insert({
      tenant_id: session.user.tenantId,
      name:      clean,
      status:    "draft",
      version:   1,
      active:    false,
      trigger,
      graph,
    })
    .select("id")
    .maybeSingle()

  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return { id: data?.id }
}

/**
 * Copilot (Engine §Pilar 3): gera um fluxo a partir de uma descrição em linguagem
 * natural → cria como RASCUNHO pro cliente revisar (nunca auto-publica).
 */
export async function createFlowWithAI(description: string): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  const { generateFlow } = await import("@/lib/ai-v2/copilot")
  const gen = await generateFlow(session.user.tenantId, description)
  if (gen.error || !gen.flow) return { error: gen.error ?? "Falha ao gerar o fluxo." }

  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .insert({
      tenant_id: session.user.tenantId,
      name:      gen.flow.name,
      status:    "draft",
      version:   1,
      active:    false,
      trigger:   gen.flow.trigger,
      graph:     gen.flow.graph,
    })
    .select("id")
    .maybeSingle()

  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return { id: data?.id }
}

export async function saveFlow(
  id: string,
  patch: { name: string; trigger: FlowTrigger; graph: FlowGraph },
): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const { error } = await supabaseAdmin
    .from("studio_flows")
    .update({
      name:    patch.name.trim() || "Fluxo sem nome",
      trigger: patch.trigger,
      graph:   patch.graph,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  revalidatePath(`/studio/fluxos/${id}`)
  return {}
}

export async function publishFlow(
  id: string,
  patch: { name: string; trigger: FlowTrigger; graph: FlowGraph },
): Promise<{ error?: string }> {
  const session = await requireAdmin()

  // Pega a versão atual pra incrementar + snapshot.
  const { data: cur } = await supabaseAdmin
    .from("studio_flows")
    .select("version")
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .maybeSingle()
  const nextVersion = ((cur?.version as number | undefined) ?? 0) + 1

  const { error } = await supabaseAdmin
    .from("studio_flows")
    .update({
      name:    patch.name.trim() || "Fluxo sem nome",
      trigger: patch.trigger,
      graph:   patch.graph,
      status:  "published",
      active:  true,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }

  // Snapshot pra rollback (best-effort — não bloqueia a publicação).
  await supabaseAdmin.from("studio_flow_versions").insert({
    flow_id:   id,
    tenant_id: session.user.tenantId,
    version:   nextVersion,
    graph:     patch.graph,
    trigger:   patch.trigger,
  })

  revalidatePath("/studio/fluxos")
  revalidatePath(`/studio/fluxos/${id}`)
  return {}
}

export async function setFlowActive(id: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const { error } = await supabaseAdmin
    .from("studio_flows")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return {}
}

/**
 * Clona um fluxo → novo RASCUNHO inativo ("Cópia de X"). Copia grafo+gatilho,
 * mas nasce despublicado e inativo: nunca dispara sozinho até o cliente publicar
 * (sem risco de dois fluxos no mesmo gatilho). Não copia runs/versões.
 */
export async function cloneFlow(id: string): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  const { data: src, error: readErr } = await supabaseAdmin
    .from("studio_flows")
    .select("name, trigger, graph")
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
    .maybeSingle()
  if (readErr) return { error: readErr.message }
  if (!src) return { error: "Fluxo não encontrado." }

  const { data, error } = await supabaseAdmin
    .from("studio_flows")
    .insert({
      tenant_id: session.user.tenantId,
      name:      `Cópia de ${src.name as string}`.slice(0, 120),
      status:    "draft",
      version:   1,
      active:    false,
      trigger:   src.trigger,
      graph:     src.graph,
    })
    .select("id")
    .maybeSingle()
  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return { id: data?.id }
}

export async function deleteFlow(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()
  // Soft-delete: arquiva (preserva runs/versions; nunca apaga dado de prod).
  const { error } = await supabaseAdmin
    .from("studio_flows")
    .update({ status: "archived", active: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/studio/fluxos")
  return {}
}

// ── Disparo ATIVO (modo=active) a partir da conversa ────────────────────────

/** Fluxos publicados + ativos com gatilho de modo ATIVO — pro botão "Disparar fluxo" no chat. */
export async function listActiveFlows(): Promise<{ id: string; name: string }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select("id, name")
    .eq("tenant_id", session.user.tenantId)
    .eq("status", "published")
    .eq("active", true)
    .eq("trigger->>mode", "active")
    .order("name")
  return (data ?? []) as { id: string; name: string }[]
}

/**
 * Dispara um fluxo (modo ativo) DENTRO de uma conversa — ação explícita do atendente.
 * Checa visibilidade (mesma regra do envio); o motor roda o fluxo ignorando os guards
 * de inbound (atendente atribuído / já roteada) via opts.forceFlowId.
 */
export async function triggerFlowInConversation(
  conversationId: string,
  flowId:         string,
): Promise<{ ok?: true; error?: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, instance_id, assigned_to, participants, department_id, channel, last_inbound_at")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!conv) return { error: "Conversa não encontrada" }

  const scope = await getViewerScope()
  if (!canViewConversation(scope, {
    assigned_to:   (conv as { assigned_to: string | null }).assigned_to,
    participants:  (conv as { participants?: string[] | null }).participants,
    department_id: (conv as { department_id?: string | null }).department_id,
    instance_id:   (conv as { instance_id?: string | null }).instance_id,
  })) {
    return { error: "Sem permissão para disparar nesta conversa." }
  }

  // Instância pro provider (o runtime do fluxo envia as mensagens).
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", (conv as { instance_id: string }).instance_id)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!instance) return { error: "Número da conversa indisponível." }

  // Gate fail-closed da janela de canal: um fluxo manda texto livre/mídia. No Oficial
  // fora das 24h isso é rejeitado pela Meta — então recusamos ANTES de disparar e
  // mandar o atendente falhar. (Receptivo é seguro: o inbound acabou de abrir a janela.)
  const provider = (instance as { provider?: string | null }).provider ?? null
  if (!isWindowOpen((conv as { channel: string | null }).channel, provider, (conv as { last_inbound_at: string | null }).last_inbound_at)) {
    return { error: "Janela de atendimento fechada — não dá pra disparar um fluxo de texto livre. Reabra com um template aprovado." }
  }

  const r = await runStudioTurn(
    { tenantId, conversationId, incomingText: "", instance },
    { forceFlowId: flowId },
  )
  if (r.status === "error") return { error: r.error ?? "Falha ao disparar o fluxo." }
  if (r.status === "skipped") {
    const msg = r.reason === "flow_unavailable" ? "Fluxo indisponível (despublicado?)." : "Não foi possível disparar agora."
    return { error: msg }
  }
  return { ok: true }
}
