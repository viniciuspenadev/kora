import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import type { FlowGraph, TransferNodeConfig } from "@/lib/ai-v2/flow/types"

export async function validateTransferPublish(tenantId: string, graph: FlowGraph): Promise<string | null> {
  const ids = new Set<string>()
  let needsMigration = false
  for (const node of graph.nodes) {
    if(node.type !== "transfer") continue
    const cfg=node.config as unknown as TransferNodeConfig
    if(cfg.target!=="round_robin" && cfg.target!=="agent") {
      if(cfg.handoff?.includes("{{agente}}")) return "A variável {{agente}} exige um destino de atendente ou distribuição entre agentes."
      continue
    }
    needsMigration=true
    const pool=cfg.target==="agent" ? [cfg.agentId] : cfg.agentIds
    if(!Array.isArray(pool)||!pool.length||pool.length>100||pool.some(id=>typeof id!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
      return "Selecione de 1 a 100 agentes válidos no nó Transferir."
    }
    if(new Set(pool).size!==pool.length) return "Há agentes repetidos na distribuição. Selecione cada agente uma vez."
    for(const id of pool) ids.add(id as string)
    for(const text of [cfg.handoff,cfg.waitMessage]) {
      if(text!=null&&(typeof text!=="string"||text.length>4000)) return "A mensagem da transferência deve ter até 4.000 caracteres."
      if(text?.match(/{{(?!agente}})[^}]*}}/)) return "Use somente {{agente}} como variável da apresentação."
    }
  }
  if(!needsMigration) return null
  const {error:schemaError}=await supabaseAdmin.from("studio_distribution_cursors").select("node_id").eq("tenant_id",tenantId).limit(0)
  if(schemaError) return "A distribuição aguarda a atualização do banco. Aplique a migration do Studio antes de publicar."
  const {data:members,error}=await supabaseAdmin.from("tenant_users").select("user_id")
    .eq("tenant_id",tenantId).eq("active",true).in("user_id",[...ids])
  if(error) return "Não foi possível conferir os agentes selecionados."
  if(new Set((members??[]).map(m=>m.user_id)).size!==ids.size) return "Um agente selecionado foi removido ou desativado. Atualize o nó Transferir."
  return null
}
