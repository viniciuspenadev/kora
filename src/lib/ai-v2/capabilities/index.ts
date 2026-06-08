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
import { tagCapability } from "./tag"
import { moveStageCapability } from "./move-stage"
import { assignCapability } from "./assign"

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
    tagCapability,
    moveStageCapability,
    assignCapability,
  ])
  _registered = true
}

export { SEND_MESSAGE } from "./send-message"
export { TRANSFER } from "./transfer"
export { UPDATE_CONTACT } from "./update-contact"
export { SEARCH_KNOWLEDGE } from "./search-knowledge"
export { HTTP_REQUEST } from "./http-request"
export { TAG } from "./tag"
export { MOVE_STAGE } from "./move-stage"
export { ASSIGN } from "./assign"
export * from "./registry"
export type { Capability, CapabilitySpec, ExecCtx, CapabilityResult, CapabilityCategory } from "./types"
