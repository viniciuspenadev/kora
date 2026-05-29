/**
 * Tipos + utils PURAS de saúde de instância — compartilhado server/client.
 * NÃO importa "server-only". A lógica que toca DB fica em `health.ts`.
 */

export type HealthLevel = "green" | "amber" | "orange" | "red"

export interface HealthSignals {
  // Polling ativo (fonte primária de saúde)
  connectionState:    string          // "open" | "close" | "connecting" | "error" | "unknown"
  connectionCheckAge: number | null   // segundos desde último check do cron
  webhookUrlMatches:  boolean | null

  // Atividade (informativo — não pesa no verdict)
  inboundAgeSec:      number | null
  outboundAgeSec:     number | null

  // Servidor Evolution
  serverPingStatus:   "ok" | "error" | "timeout" | "unknown"
  serverLatencyMs:    number | null
}

export interface InstanceHealth {
  level:    HealthLevel
  headline: string
  reason:   string
  signals:  HealthSignals
}

export function formatAge(seconds: number): string {
  if (seconds < 60)        return `${seconds}s`
  if (seconds < 3600)      return `${Math.floor(seconds / 60)} min`
  if (seconds < 86400)     return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
