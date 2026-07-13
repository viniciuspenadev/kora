// ═══════════════════════════════════════════════════════════════
// God Mode — Limites: tipos + metadados (PURO, safe pra client)
// ═══════════════════════════════════════════════════════════════
// Tudo que pode ser importado por client components fica aqui.
// O lado server (queries, defaults) mora em limits.ts (com server-only).

export type LimitResource =
  | "users"
  | "whatsapp_official"
  | "whatsapp_qr"
  | "messages_per_month"
  | "conversations_per_month"
  | "broadcasts_per_month"
  | "storage_mb"
  | "contacts"

export interface LimitInfo {
  resource:  LimitResource
  max:       number | null   // null = ilimitado
  used:      number
  remaining: number | null
  ok:        boolean
  source:    "override" | "plan" | "default"   // override por tenant · limite do plano · fallback hardcoded
}

export const LIMIT_META: Record<LimitResource, { label: string; unit: string; description: string }> = {
  users:                   { label: "Usuários",              unit: "",         description: "Atendentes ativos + convites pendentes" },
  whatsapp_official:       { label: "Números API Oficial",   unit: "",         description: "Números conectados via WhatsApp Cloud API (Meta)" },
  whatsapp_qr:             { label: "Números QR (Evolution)", unit: "",        description: "Números conectados via QR Code (Baileys/Evolution)" },
  messages_per_month:      { label: "Mensagens/mês",         unit: "msg",      description: "Enviadas e recebidas pelo WhatsApp" },
  conversations_per_month: { label: "Conversas/mês",         unit: "conversa", description: "Novas conversas no mês (enviadas ou recebidas)" },
  broadcasts_per_month:    { label: "Broadcasts/mês",        unit: "envio",    description: "Disparos em massa (em desenvolvimento)" },
  storage_mb:              { label: "Storage",               unit: "MB",       description: "Mídia armazenada no bucket" },
  contacts:                { label: "Contatos",              unit: "",         description: "Total de contatos cadastrados" },
}

export const DEFAULT_LIMITS_BY_PLAN: Record<string, Record<LimitResource, number | null>> = {
  trial: {
    users:                   3,
    whatsapp_official:       1,
    whatsapp_qr:             1,
    messages_per_month:      500,
    conversations_per_month: 1_000,
    broadcasts_per_month:    0,
    storage_mb:              500,
    contacts:                500,
  },
  starter: {
    users:                   5,
    whatsapp_official:       1,
    whatsapp_qr:             1,
    messages_per_month:      3_000,
    conversations_per_month: 5_000,
    broadcasts_per_month:    10,
    storage_mb:              2_000,
    contacts:                5_000,
  },
  pro: {
    users:                   15,
    whatsapp_official:       3,
    whatsapp_qr:             3,
    messages_per_month:      20_000,
    conversations_per_month: 30_000,
    broadcasts_per_month:    100,
    storage_mb:              20_000,
    contacts:                50_000,
  },
  enterprise: {
    users:                   null,
    whatsapp_official:       null,
    whatsapp_qr:             null,
    messages_per_month:      null,
    conversations_per_month: null,
    broadcasts_per_month:    null,
    storage_mb:              null,
    contacts:                null,
  },
}

export const ALL_PLANS = ["trial", "starter", "pro", "enterprise"] as const
