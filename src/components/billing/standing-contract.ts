// ═══════════════════════════════════════════════════════════════
// Contrato do estado financeiro — ponto ÚNICO de import dos componentes
// ═══════════════════════════════════════════════════════════════
// ✅ JUNÇÃO FEITA (2026-08-03). Nasceu como cópia temporária porque a camada de dados
//    (`src/lib/billing/standing.ts`) estava sendo construída em paralelo por outro agente.
//    Os dois contratos foram conferidos campo a campo antes da troca — eram idênticos.
//
// 🔑 POR QUE O REEXPORT FICA, em vez de cada componente importar da lib direto: os seis
//    componentes desta pasta apontam para cá. Se o contrato mudar na origem, o `tsc`
//    reclama em UM lugar e a correção é UMA — em vez de seis imports espalhados
//    divergirem em silêncio. É o mesmo princípio que fez o predicado de bloqueio virar
//    fonte única depois de ter existido em duas cópias (docs/access-revocation-design §3).

export type { BillingDegrau, BillingStanding } from "@/lib/billing/standing"
