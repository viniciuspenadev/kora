// ═══════════════════════════════════════════════════════════════
// Nome do documento comercial enviado ao cliente — FONTE ÚNICA da palavra na tela
// ═══════════════════════════════════════════════════════════════
// Dono (29/09/2026): "Orçamento, inicialmente". Antes a mesma coisa aparecia como
// "Proposta" (menu, abas, botões) e "Cotação" (PDF, Configurações, Studio).
// Trocar o nome = editar SÓ este objeto: ele já carrega as formas com gênero
// ("vencido"/"vencida", "novo"/"nova"), para nenhuma tela precisar concordar sozinha.
// Não toca em rota, tabela nem numeração (o prefixo do número mora em documents.ts).
import type { DocumentStatus } from "@/lib/commercial/documents"

export const QUOTE_TERM = {
  /** Gênero da palavra — as frases concordam por `qg()` ("gerado"/"gerada", "este"/"esta"). */
  gender:     "m" as "m" | "f",
  one:        "Orçamento",
  many:       "Orçamentos",
  /** Prefixo do número dos NOVOS (ORC-0012/2026). Os emitidos guardam o seu (code_prefix). */
  codePrefix: "ORC",
  oneLower:   "orçamento",
  manyLower:  "orçamentos",
  /** "o orçamento" / "do orçamento" / "ao orçamento". */
  the:        "o orçamento",
  ofThe:      "do orçamento",
  new:        "Novo orçamento",
  generate:   "Gerar orçamento",
  view:       "Ver orçamento",
  none:       "Nenhum orçamento",
  without:    "Sem orçamento",
  with:       "Com orçamento",
  expired:    "Orçamento vencido",
  expiringSoon: "Vencendo esta semana",
  /** Configurações → modelos de condições/observações/contrato. */
  settings:   "Orçamentos e contratos",
  status: {
    draft:    "Rascunho",
    active:   "Emitido",
    sent:     "Enviado",
    accepted: "Aceito",
    declined: "Recusado",
    signed:   "Assinado",
    void:     "Cancelado",
  } satisfies Record<DocumentStatus, string>,
  /** Estado derivado: emitido/enviado com a validade já passada. */
  expiredState: "Vencido",
  markAccepted: "Marcar como aceito",
  markDeclined: "Marcar como recusado",
} as const

/** Concordância com o nome do documento: `qg("gerado", "gerada")`. */
export function qg(masculine: string, feminine: string): string {
  return QUOTE_TERM.gender === "m" ? masculine : feminine
}
