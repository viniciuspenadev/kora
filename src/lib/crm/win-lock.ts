// Trava "exigir item para marcar como ganho" (deal_pipelines.require_items_to_win).
// Quem decide é o BANCO: o gatilho crm_require_items_to_win recusa a passagem para 'won'
// com a mensagem 'deal_requires_items' (migration 20260928000100). Aqui só a tradução,
// uma vez, para os 3 caminhos de ganho (moveDealById, moveDeal, createDeal).
export const DEAL_REQUIRES_ITEMS = "deal_requires_items"

export const REQUIRES_ITEMS_ON_MOVE =
  "Este funil exige pelo menos um item para marcar o negócio como ganho. Adicione um item (do catálogo ou avulso) e tente de novo."
export const REQUIRES_ITEMS_ON_CREATE =
  "Este funil exige pelo menos um item para marcar o negócio como ganho. Crie o negócio em aberto, adicione o item e depois marque como ganho."

/** Mensagem para o usuário a partir do erro de gravação do negócio. */
export function dealWriteErrorMessage(error: { message?: string } | null | undefined, creating = false): string {
  if (error?.message?.includes(DEAL_REQUIRES_ITEMS)) return creating ? REQUIRES_ITEMS_ON_CREATE : REQUIRES_ITEMS_ON_MOVE
  return error?.message || "Falha ao gravar o negócio"
}
