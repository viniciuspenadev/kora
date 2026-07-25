import { getProposals, getProposalsSummary, getProposalAgents } from "@/lib/actions/proposals"
import { PropostasClient } from "./propostas-client"

// Propostas — lista transversal de cotações (acompanhamento/cobrança). Gate = gestor de
// Negócios (a action fail-closa; o item de menu já é deals_manage). Defaults = as mesmas
// do client (aberto + vencendo primeiro) pra a 1ª renderização casar.
export default async function PropostasPage() {
  const [initial, summary, agents] = await Promise.all([
    getProposals({ filters: { status: "open" }, sort: "expiring", limit: 30 }),
    getProposalsSummary(),
    getProposalAgents(),
  ])
  return <PropostasClient initial={initial} summary={summary} agents={agents} />
}
