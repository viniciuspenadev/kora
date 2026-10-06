import { Headset, Megaphone, Bot } from "lucide-react"

/**
 * Categoria do fluxo = **o que ele faz pro negócio**.
 *
 * ⚠️ Eixo DIFERENTE do gatilho (como o fluxo começa), que tem coluna própria na lista.
 * Confundir os dois foi o que quebrou a taxonomia anterior: o mesmo "Agendamento" ficou
 * como Marketing numa linha e Atendimento noutra, porque o dono classificou pela ENTRADA
 * e não pelo trabalho. Por isso cada opção carrega `hint` e ele aparece no ponto da
 * escolha — o rótulo sozinho não desambigua, e categoria mal preenchida é filtro que mente.
 *
 * Mora em arquivo próprio porque header (flows-actions) e lista (flows-client) precisam
 * dos MESMOS rótulos: duplicar seria garantir que um dia divergem.
 */
export type Purpose = "atendimento" | "marketing" | "automacao"

/** Ordem canônica de exibição (menu, empty state, filtro). */
export const PURPOSE_ORDER = ["atendimento", "marketing", "automacao"] as const

export const PURPOSE_META: Record<Purpose, {
  label: string; hint: string; icon: typeof Headset; tint: string; badge: string
}> = {
  atendimento: { label: "Atendimento", hint: "responde e conduz quem chega",
                 icon: Headset,   tint: "text-sky-600 bg-sky-50",       badge: "bg-sky-50 text-sky-700 ring-sky-200" },
  marketing:   { label: "Marketing",   hint: "a conversa que segue uma campanha",
                 icon: Megaphone, tint: "text-violet-600 bg-violet-50", badge: "bg-violet-50 text-violet-700 ring-violet-200" },
  // Teal, e não verde/âmbar: o badge de categoria fica na coluna vizinha da pílula de
  // status (Ativo verde · Pausado âmbar) — repetir a cor faria os dois se confundirem.
  automacao:   { label: "Automação",   hint: "executa uma tarefa: agendar, capturar, reengajar",
                 icon: Bot,       tint: "text-teal-600 bg-teal-50",     badge: "bg-teal-50 text-teal-700 ring-teal-200" },
}
