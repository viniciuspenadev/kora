// ═══════════════════════════════════════════════════════════════
// Escada de inadimplência — superfícies de UI
// ═══════════════════════════════════════════════════════════════
// A política mora em `docs/access-revocation-design.md` §2; aqui está o que ela PARECE.
// Mapa rápido de quem vê o quê:
//
//   DONO / ADMIN            pílula no chrome (C7) · faixa no topo quando o produto PAROU
//                           (C1) · ação travada com motivo (C2) · cartão da campanha em
//                           espera (C3) · item no sino (C4) · toast de volta (C5)
//   ATENDENTE               só o EFEITO (C6) — nunca a causa financeira
//
// Duas regras atravessam as seis: o aviso sobe de SUPERFÍCIE e nunca de VOLUME, e o
// sujeito da frase é sempre o DOCUMENTO, nunca a pessoa.

export { BillingBanner } from "./billing-banner"
export { BillingPill } from "./billing-pill"
export { BlockedAction } from "./blocked-action"
export { PausedCampaignCard } from "./paused-campaign-card"
export { BillingBellItem } from "./billing-bell-item"
export { BillingRestoredToast } from "./billing-restored-toast"
export { AgentServiceNotice } from "./agent-service-notice"

export { PayNowButton } from "./pay-now"
export { BILLING_HREF, PAY_LABEL, DEGRAUS_DE_FAIXA } from "./format"
export type { BillingDegrau, BillingStanding } from "./standing-contract"
