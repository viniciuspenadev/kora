import BillingTimeline from "./timeline-preview"

/**
 * Linha do tempo de cobrança — **protótipo**, ainda com dados de exemplo.
 *
 * ⚠️ Mora dentro de `(admin)`, então herda o portão de platform admin do layout do grupo —
 *    ninguém de fora da operação alcança. O aviso de "dados de exemplo" está no próprio
 *    componente, e sai junto quando ligarmos nas fontes reais.
 *
 * O que falta para virar real: consulta server-side em `audit_log` + `asaas_webhook_events`
 * (filtradas por tenant), paginação por cursor, e o tenant vindo da rota em vez de fixo.
 */
export default function AuditoriaCobrancaPage() {
  return <BillingTimeline />
}
