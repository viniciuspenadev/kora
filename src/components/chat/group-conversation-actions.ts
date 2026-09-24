import type { WorkflowExtra } from "./conversation-workflow"

export type GroupSection = "details" | "participants" | "access"

/** One action list for the Inbox context menu and the conversation header. */
export function groupConversationActions(canManage: boolean, open: (section: GroupSection) => void): WorkflowExtra[] {
  return [
    { label: "Detalhes do grupo", run: () => open("details") },
    { label: "Participantes do WhatsApp", run: () => open("participants") },
    ...(canManage ? [{ label: "Gerenciar acesso no Kora", run: () => open("access") }] : []),
  ]
}
