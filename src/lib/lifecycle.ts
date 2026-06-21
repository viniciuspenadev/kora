import type { LifecycleStage, ContactSource } from "@/types/chat"

/** Configuração visual de cada estágio de lifecycle. */
export const LIFECYCLE_META: Record<LifecycleStage, {
  label: string
  icon:  string  // emoji
  bg:    string
  text:  string
  ring:  string
  short: string
}> = {
  contact:  { label: "Contato", icon: "👤", bg: "bg-slate-100",  text: "text-slate-600",   ring: "ring-slate-200",   short: "C" },
  lead:     { label: "Lead",    icon: "🎯", bg: "bg-primary-50", text: "text-primary-700", ring: "ring-primary-200", short: "L" },
  customer: { label: "Cliente", icon: "🏆", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", short: "C" },
  unfit:    { label: "Sem fit", icon: "🚫", bg: "bg-red-50",     text: "text-red-600",     ring: "ring-red-200",     short: "U" },
  // Legado pré-migração (won→customer, lost→lead) — render-only, não produzido mais.
  won:      { label: "Cliente", icon: "🏆", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", short: "C" },
  lost:     { label: "Perdido", icon: "💔", bg: "bg-slate-100",  text: "text-slate-500",   ring: "ring-slate-300",   short: "P" },
}

/** Configuração visual de cada canal de origem. */
export const SOURCE_META: Record<ContactSource, {
  label: string
  icon:  string
  color: string
}> = {
  whatsapp_inbound:  { label: "WhatsApp (recebido)", icon: "💬", color: "#16a34a" },
  whatsapp_outbound: { label: "WhatsApp (iniciado)", icon: "📤", color: "#2563eb" },
  manual:            { label: "Cadastro manual",     icon: "✋", color: "#64748b" },
  import:            { label: "Importado",           icon: "📥", color: "#d97706" },
  instagram:         { label: "Instagram",           icon: "📷", color: "#db2777" },
  webform:           { label: "Site / Formulário",   icon: "🌐", color: "#0891b2" },
}

export function lifecycleMeta(stage: LifecycleStage | string | null | undefined) {
  return LIFECYCLE_META[(stage ?? "contact") as LifecycleStage] ?? LIFECYCLE_META.contact
}

export function sourceMeta(src: ContactSource | string | null | undefined) {
  return SOURCE_META[(src ?? "whatsapp_inbound") as ContactSource] ?? SOURCE_META.whatsapp_inbound
}
