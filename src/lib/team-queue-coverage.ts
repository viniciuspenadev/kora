import "server-only"
import { memberSeesUnassigned, type FanoutMemberRow } from "@/lib/visibility"

/** Aviso de configuração: supervisores/atendentes podem cobrir a fila;
 * proprietários e administradores têm acesso, mas não substituem a equipe operacional. */
export function uncoveredTeamQueues(
  members: (FanoutMemberRow & { active: boolean })[],
  departments: { id: string; name: string }[],
  numbers: { id: string; label: string }[],
): string[] {
  const agents = members.filter(m => m.active && m.role === "agent")
  const channels = numbers.length ? numbers.map(n => ({ id: n.id as string | null, label: n.label })) : [{ id: null, label: "canais disponíveis" }]
  return [{ id: null as string | null, name: "Fila geral" }, ...departments].flatMap(queue => {
    const uncovered = channels.filter(channel => !agents.some(m => memberSeesUnassigned(m, { department_id: queue.id, instance_id: channel.id })))
    return uncovered.length ? [`${queue.name}: sem atendente com acesso em ${uncovered.map(c => c.label).join(", ")}.`] : []
  })
}
