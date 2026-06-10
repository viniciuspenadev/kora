// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de "esse tenant tem IA ATIVA agora?"
// ═══════════════════════════════════════════════════════════════
// = tem o MÓDULO (god mode) E o master switch (ai_enabled) ligado.
// O dispatcher já faz isso na ENTRADA (módulo → motor; motor checa
// ai_enabled). Esta função leva a MESMA regra aos caminhos LATERAIS
// (cron de resume, fail-safe das políticas de atendimento) — pra
// "desabilitar = parar de verdade, em qualquer caminho".

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"

export async function tenantAiActive(tenantId: string): Promise<boolean> {
  if (await hasModule(tenantId, "ai_studio")) {
    const { data } = await supabaseAdmin.from("studio_config").select("ai_enabled").eq("tenant_id", tenantId).maybeSingle()
    return !!data?.ai_enabled
  }
  if (await hasModule(tenantId, "ai_atendente")) {
    const { data } = await supabaseAdmin.from("ai_config").select("ai_enabled").eq("tenant_id", tenantId).maybeSingle()
    return !!data?.ai_enabled
  }
  return false
}
