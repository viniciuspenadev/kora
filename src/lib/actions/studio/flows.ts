"use server"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — actions de FLUXOS (CRUD + publicar)
// ═══════════════════════════════════════════════════════════════
// Grava o grafo (nós+arestas) em studio_flows.graph. O runtime da
// Fatia 4 lê e executa esse mesmo formato — sem conversão.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
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
    .select("id, name, status, active, version, updated_at")
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
