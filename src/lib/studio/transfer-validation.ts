import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import type { FlowGraph, TransferNodeConfig } from "@/lib/ai-v2/flow/types"

export async function validateTransferPublish(tenantId: string, graph: FlowGraph): Promise<string | null> {
  const ids = new Set<string>()
  let needsMigration = false
  for (const node of graph.nodes) {
    if(node.type !== "transfer") continue
    const cfg=node.config as unknown as TransferNodeConfig
    // 🔴 No NÓ, "Manter a IA atendendo" nunca pôs a IA pra conversar: o run fica parado no
    //    Transferir e cada mensagem do cliente só re-tenta a transferência e repete a espera
    //    (mesmo com Agente IA no fluxo). 0 de 9 nós em prod usavam (26/09). O motor mantém o
    //    suporte (rascunho antigo não quebra); a publicação não aceita mais.
    if(cfg.whenUnavailable==="keep_ai") return "No nó Transferir, “Manter a IA atendendo” não está mais disponível: ela não punha a IA para conversar, só segurava o cliente. Escolha “Encaminhar mesmo assim” ou “Avisar o cliente e encaminhar”."
    for(const text of [cfg.handoff,cfg.waitMessage]) {
      if(text!=null&&(typeof text!=="string"||text.length>4000)) return "A mensagem da transferência deve ter até 4.000 caracteres."
    }
    // As variáveis do fluxo são trocadas no envio (runtime); {{agente}} só existe quando
    // o destino escolhe uma pessoa.
    if(cfg.target!=="round_robin" && cfg.target!=="agent") {
      if([cfg.handoff,cfg.waitMessage].some(t=>t?.includes("{{agente}}"))) return "A variável {{agente}} só funciona quando o destino é um atendente ou a distribuição entre atendentes."
      continue
    }
    needsMigration=true
    const pool=cfg.target==="agent" ? [cfg.agentId] : cfg.agentIds
    if(!Array.isArray(pool)||!pool.length||pool.length>100||pool.some(id=>typeof id!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
      return "Selecione de 1 a 100 atendentes válidos no nó Transferir."
    }
    if(new Set(pool).size!==pool.length) return "Há atendentes repetidos na distribuição. Selecione cada um uma vez."
    for(const id of pool) ids.add(id as string)
  }
  if(!needsMigration) return null
  const {error:schemaError}=await supabaseAdmin.from("studio_distribution_cursors").select("node_id").eq("tenant_id",tenantId).limit(0)
  if(schemaError) return "A distribuição aguarda a atualização do banco. Aplique a migration do Studio antes de publicar."
  const {data:members,error}=await supabaseAdmin.from("tenant_users").select("user_id")
    .eq("tenant_id",tenantId).eq("active",true).in("user_id",[...ids])
  if(error) return "Não foi possível conferir os atendentes selecionados."
  if(new Set((members??[]).map(m=>m.user_id)).size!==ids.size) return "Um atendente selecionado foi removido ou desativado. Atualize o nó Transferir."
  return null
}
