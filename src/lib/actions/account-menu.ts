"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Menu da Conta (topbar) — dados do dropdown de conta/pessoal.
// Chamado LAZY no primeiro OPEN do dropdown (não no load da página).
// Isolamento de tenant obrigatório: TODA query filtra por tenant_id
// (supabaseAdmin bypassa RLS). Não toca chat_* nem visibility.
// ═══════════════════════════════════════════════════════════════

export interface AccountMenuData {
  tenantName:    string
  tenantSlug:    string
  userName:      string
  userEmail:     string
  unit:          { name: string; color: string } | null
  /** Soma de estimated_value dos negócios GANHOS no mês corrente, do usuário. */
  soldThisMonth: number
}

/** Primeiro dia do mês corrente em ISO (UTC) — recorte de "neste mês". */
function monthStartISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export async function getAccountMenuData(): Promise<AccountMenuData | null> {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const userId   = session?.user?.id
  if (!tenantId || !userId) return null

  const [tenantRes, memberRes, dealsRes] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("name, slug")
      .eq("id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_users")
      .select("unit_id, tenant_units ( name, color )")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_deals")
      .select("estimated_value")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .eq("status", "won")
      .gte("won_at", monthStartISO()),
  ])

  const tenant = tenantRes.data as { name: string; slug: string } | null
  const unit   = (memberRes.data?.tenant_units as unknown as { name: string; color: string } | null) ?? null
  const soldThisMonth = ((dealsRes.data ?? []) as { estimated_value: number | null }[])
    .reduce((sum, d) => sum + Number(d.estimated_value ?? 0), 0)

  return {
    tenantName:    tenant?.name ?? "Conta",
    tenantSlug:    tenant?.slug ?? "",
    userName:      session.user.name ?? "Usuário",
    userEmail:     session.user.email ?? "",
    unit:          unit && unit.name ? { name: unit.name, color: unit.color } : null,
    soldThisMonth,
  }
}
