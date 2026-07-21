import "server-only"
import type { HealthSignals, InstanceHealth } from "./health-shared"
import { formatAge } from "./health-shared"

export type { HealthLevel, HealthSignals, InstanceHealth } from "./health-shared"
export { formatAge } from "./health-shared"

/**
 * Health diagnóstico de uma instância WhatsApp (server-only).
 *
 * FONTE PRIMÁRIA: polling ativo do cron (last_connection_state, webhook_url_matches).
 * Quiet period com zero atividade é normal → saúde NÃO depende de timestamps de msg.
 *
 * Regras (em ordem de prioridade):
 *   1. Servidor Evolution offline                       → red
 *   2. last_connection_state ∉ {open, connected, ok}    → red
 *   3. webhook_url_matches === false                    → orange ("desconfigurado")
 *   4. last_connection_check_at > 15min                 → orange ("não consegui verificar")
 *   5. Tudo confirmado pelo polling                     → green
 */

interface InstanceRow {
  status?:                       string | null
  last_connection_state?:        string | null
  last_connection_check_at?:     string | null
  webhook_url_matches?:          boolean | null
  last_inbound_message_at?:      string | null
  last_outbound_message_at?:     string | null
}

interface ServerRow {
  last_ping_status?:    string | null
  last_ping_latency_ms?: number | null
  last_ping_at?:        string | null
}

function ageSec(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
}

/** Polling stale = não conseguimos verificar há muito */
const POLLING_STALE_SEC = 15 * 60

const OPEN_STATES = new Set(["open", "connected", "ok"])

export function computeInstanceHealth(instance: InstanceRow, server?: ServerRow | null): InstanceHealth {
  const signals: HealthSignals = {
    connectionState:    instance.last_connection_state ?? "unknown",
    connectionCheckAge: ageSec(instance.last_connection_check_at),
    webhookUrlMatches:  instance.webhook_url_matches ?? null,
    inboundAgeSec:      ageSec(instance.last_inbound_message_at),
    outboundAgeSec:     ageSec(instance.last_outbound_message_at),
    serverPingStatus:   (server?.last_ping_status as HealthSignals["serverPingStatus"]) ?? "unknown",
    serverLatencyMs:    server?.last_ping_latency_ms ?? null,
  }

  // 1. Servidor Evolution offline → tudo vermelho
  if (server?.last_ping_status === "error" || server?.last_ping_status === "timeout") {
    return {
      level: "red",
      headline: "Servidor Evolution offline",
      reason: `Último ping: ${server.last_ping_status}. Nenhuma instância funciona até voltar.`,
      signals,
    }
  }

  // 2. Antes do primeiro polling: usa status legado como provisório
  if (!instance.last_connection_check_at) {
    if (instance.status === "connected") {
      return {
        level: "amber",
        headline: "Aguardando primeiro check",
        reason: "Status legado diz 'conectado'. Cron vai validar em até 5 min.",
        signals,
      }
    }
    return {
      level: "amber",
      headline: "Aguardando primeiro check",
      reason: "Cron ainda não verificou esta instância.",
      signals,
    }
  }

  // 3. Polling stale (cron não está rodando OU Evolution caiu antes de responder)
  if (signals.connectionCheckAge !== null && signals.connectionCheckAge > POLLING_STALE_SEC) {
    return {
      level: "orange",
      headline: "Verificação atrasada",
      reason: `Último check ${formatAge(signals.connectionCheckAge)} atrás. Pode ser cron ou Evolution.`,
      signals,
    }
  }

  // 4. WhatsApp não está aberto
  if (!OPEN_STATES.has(signals.connectionState)) {
    const stateLabels: Record<string, string> = {
      close:      "WhatsApp desconectado",
      connecting: "Conectando ao WhatsApp",
      error:      "Erro de conexão",
      unknown:    "Estado desconhecido",
    }
    return {
      level: signals.connectionState === "connecting" ? "amber" : "red",
      headline: stateLabels[signals.connectionState] ?? `Estado: ${signals.connectionState}`,
      reason: "Cliente precisa reconectar (escanear QR) se persistir.",
      signals,
    }
  }

  // 5. Webhook desconfigurado (URL na Evolution ≠ DB)
  if (signals.webhookUrlMatches === false) {
    return {
      level: "orange",
      headline: "Webhook desconfigurado",
      reason: "URL configurada na Evolution não bate com a do Kora. Cliente envia, não recebe.",
      signals,
    }
  }

  // 6. Tudo verde
  return {
    level: "green",
    headline: "Saudável",
    reason: "Conectada e recebendo eventos da Evolution.",
    signals,
  }
}
