// Nome de cada nó como a pessoa vê no Kora Studio — FONTE ÚNICA (painel de ajustes,
// mensagens de publicação e avisos do motor falam a mesma língua). Puro: importável no
// servidor e no navegador.

import type { FlowNodeType } from "./types"

export const NODE_TITLE: Record<FlowNodeType, string> = {
  start: "Início", message: "Mensagem", send_media: "Enviar mídia", menu: "Menu", condition: "Condição",
  set_variable: "Definir variável", switch: "Desviar (switch)", business_hours: "Horário comercial",
  wait: "Esperar",
  http: "Requisição HTTP", collect: "Coletar dado", schedule: "Agendar", ai_agent: "Agente IA",
  data_source: "Fonte de consulta",
  ai_router: "Roteador IA", call_flow: "Executar fluxo", template: "Enviar template",
  outreach: "Disparar no WhatsApp",
  tag: "Etiquetar", move_stage: "Mover etapa",
  transfer: "Transferir", resolve: "Concluir", return: "Voltar", end: "Encerrar",
}
