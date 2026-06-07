// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — RAG (ingestão + busca)
// ═══════════════════════════════════════════════════════════════
// Ingestão: quebra o conteúdo em chunks → embeddings → grava em
// studio_knowledge_chunks. Busca: embedda a query → RPC de cosseno.
// A tool search_knowledge (a IA decide quando consultar) consome daqui.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { embedText, embedBatch } from "./embeddings"

const MAX_CHUNK = 700

/** Quebra por parágrafos, agrupando até ~MAX_CHUNK; parágrafo gigante é fatiado. */
export function chunkText(content: string, maxLen = MAX_CHUNK): string[] {
  const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let cur = ""
  for (const p of paras) {
    if (cur && (cur.length + p.length + 2) > maxLen) { chunks.push(cur); cur = p }
    else cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) chunks.push(cur)
  // fatia parágrafos isolados muito longos
  return chunks.flatMap((c) => (c.length > maxLen * 1.6 ? sliceLong(c, maxLen) : [c]))
}

function sliceLong(text: string, maxLen: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += maxLen) out.push(text.slice(i, i + maxLen))
  return out
}

/**
 * Re-indexa um item: apaga chunks antigos, re-chunka, embeda e grava.
 * Idempotente por knowledge_id. Lança em erro de embedding (caller trata).
 */
export async function reindexKnowledge(tenantId: string, knowledgeId: string, content: string): Promise<void> {
  await supabaseAdmin.from("studio_knowledge_chunks").delete().eq("knowledge_id", knowledgeId)
  const chunks = chunkText(content)
  if (chunks.length === 0) return
  const vectors = await embedBatch(chunks)
  const rows = chunks.map((chunk, i) => ({
    tenant_id:    tenantId,
    knowledge_id: knowledgeId,
    chunk,
    embedding:    vectors[i],
  }))
  const { error } = await supabaseAdmin.from("studio_knowledge_chunks").insert(rows)
  if (error) throw new Error(`reindex: ${error.message}`)
}

export interface KnowledgeHit { title: string; chunk: string; similarity: number }

/** Busca vetorial (cosseno) via RPC. Vazio em erro (não derruba o turno). */
export async function searchKnowledgeVector(tenantId: string, query: string, limit = 4): Promise<KnowledgeHit[]> {
  let embedding: number[]
  try {
    embedding = await embedText(query)
  } catch (e) {
    console.error("[studio/rag] embed falhou:", e instanceof Error ? e.message : e)
    return []
  }
  const { data, error } = await supabaseAdmin.rpc("studio_match_knowledge", {
    p_tenant_id: tenantId,
    p_embedding: embedding,
    p_limit:     limit,
  })
  if (error) {
    console.error("[studio/rag] busca falhou:", error.message)
    return []
  }
  return (data ?? []) as KnowledgeHit[]
}

/** Fallback keyword (ILIKE) — usado quando a vetorial não retorna nada. */
export async function searchKnowledgeKeyword(tenantId: string, query: string, limit = 4): Promise<KnowledgeHit[]> {
  const safe = query.replace(/[%_]/g, (c) => `\\${c}`).slice(0, 120)
  const { data, error } = await supabaseAdmin
    .from("studio_knowledge")
    .select("title, content")
    .eq("tenant_id", tenantId)
    .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
    .limit(limit)
  if (error || !data) return []
  return data.map((k) => ({ title: k.title, chunk: k.content.slice(0, 700), similarity: 0 }))
}
