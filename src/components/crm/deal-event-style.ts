import {
  Briefcase, TrendingUp, Trophy, XCircle, Ban, RotateCcw,
  StickyNote, Pencil, Bell, CheckCircle2, type LucideIcon,
} from "lucide-react"

// Estilo ÚNICO dos eventos de negócio — ícone (lucide, não emoji), cor de acento e rótulo.
// Usado no chat (cartão), no dossiê (página) e no feed (sidebar) — fonte de verdade visual.
export interface DealEventStyle { Icon: LucideIcon; accent: string; label: string }

export function dealEventStyle(type: string): DealEventStyle {
  switch (type) {
    case "created":       return { Icon: Briefcase,    accent: "#004add", label: "Negócio aberto" }
    case "stage_changed": return { Icon: TrendingUp,   accent: "#004add", label: "Movimentação" }
    case "won":           return { Icon: Trophy,       accent: "#059669", label: "Negócio ganho" }
    case "lost":          return { Icon: XCircle,      accent: "#dc2626", label: "Negócio perdido" }
    case "canceled":      return { Icon: Ban,          accent: "#64748b", label: "Negócio cancelado" }
    case "reopened":      return { Icon: RotateCcw,    accent: "#d97706", label: "Negócio reaberto" }
    case "note":          return { Icon: StickyNote,   accent: "#7c3aed", label: "Nota" }
    case "field_changed": return { Icon: Pencil,       accent: "#0ea5e9", label: "Atualização" }
    case "task_created":  return { Icon: Bell,         accent: "#0ea5e9", label: "Follow-up agendado" }
    case "task_done":     return { Icon: CheckCircle2, accent: "#059669", label: "Follow-up concluído" }
    default:              return { Icon: StickyNote,   accent: "#64748b", label: "" }
  }
}
