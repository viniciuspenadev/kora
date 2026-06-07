// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — barrel + registro determinístico
// ═══════════════════════════════════════════════════════════════
// Registro explícito (não por side-effect de import) — determinístico
// em serverless, sem surpresa de ordem de carga. O motor chama
// ensureCapabilitiesRegistered() no início do turno.

import { registerAll } from "./registry"
import { sendMessageCapability } from "./send-message"
import { transferCapability } from "./transfer"
import { updateContactCapability } from "./update-contact"
import { searchKnowledgeCapability } from "./search-knowledge"
import { httpRequestCapability } from "./http-request"

let _registered = false

/** Idempotente: registra as capacidades core uma vez por processo. */
export function ensureCapabilitiesRegistered(): void {
  if (_registered) return
  registerAll([
    sendMessageCapability,
    transferCapability,
    updateContactCapability,
    searchKnowledgeCapability,
    httpRequestCapability,
  ])
  _registered = true
}

export { SEND_MESSAGE } from "./send-message"
export { TRANSFER } from "./transfer"
export { UPDATE_CONTACT } from "./update-contact"
export { SEARCH_KNOWLEDGE } from "./search-knowledge"
export { HTTP_REQUEST } from "./http-request"
export * from "./registry"
export type { Capability, CapabilitySpec, ExecCtx, CapabilityResult, CapabilityCategory } from "./types"
