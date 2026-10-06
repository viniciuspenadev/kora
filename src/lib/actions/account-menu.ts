"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Menu da Conta (topbar) — dados do dropdown "Cockpit do vendedor".
// Chamado LAZY no primeiro OPEN do dropdown (não no load da página).
// Isolamento de tenant obrigatório: TODA query filtra por tenant_id
// (supabaseAdmin bypassa RLS). Não toca chat_* nem visibility.
// ═══════════════════════════════════════════════════════════════

export interface AccountMenuData {
  tenantName:    string
  tenantSlug:    string
  userName:      string
  userEmail:     string
  unit:          { id: string; name: string; color: string; has_logo: boolean } | null
  /** Soma de estimated_value dos negócios GANHOS no mês corrente (fuso SP), do usuário. */
  soldThisMonth: number
  /** Idem, mês anterior — pra tendência. */
  soldLastMonth: number
  /** Nº de negócios ganhos no mês corrente. */
  wonCountThisMonth: number
  /** Soma de estimated_value dos negócios ABERTOS do usuário (sem recorte de data). */
  openValue:     number
  /** Rótulo abreviado do mês anterior em pt-BR (ex: "jun"). */
  prevMonthLabel: string
}

/**
 * Início do mês corrente e do anterior no fuso America/Sao_Paulo.
 * Brasil não tem DST desde 2019 → offset fixo -03:00.
 */
function spMonthBounds() {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) // YYYY-MM-DD
  const [y, m] = ymd.split("-").map(Number)
  const prevM = m === 1 ? 12 : m - 1
  const prevY = m === 1 ? y - 1 : y
  const pad = (n: number) => String(n).padStart(2, "0")
  const thisStart = `${y}-${pad(m)}-01T00:00:00-03:00`
  const lastStart = `${prevY}-${pad(prevM)}-01T00:00:00-03:00`
  const prevMonthLabel = new Date(prevY, prevM - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
  return { thisStart, lastStart, prevMonthLabel }
}

export async function getAccountMenuData(): Promise<AccountMenuData | null> {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const userId   = session?.user?.id
  if (!tenantId || !userId) return null

  const { thisStart, lastStart, prevMonthLabel } = spMonthBounds()

  const [tenantRes, memberRes, wonRes, openRes] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("name, slug")
      .eq("id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_users")
      .select("unit_id, tenant_units ( id, name, color, logo_path )")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle(),
    // Ganhos do mês corrente + anterior num único fetch (won_at >= início do mês passado).
    supabaseAdmin
      .from("tenant_deals")
      .select("estimated_value, won_at")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .eq("status", "won")
      .gte("won_at", lastStart),
    // Em aberto no funil — sem recorte de data.
    supabaseAdmin
      .from("tenant_deals")
      .select("estimated_value")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .eq("status", "open"),
  ])

  const tenant = tenantRes.data as { name: string; slug: string } | null
  const rawUnit = (memberRes.data?.tenant_units as unknown as
    { id: string; name: string; color: string; logo_path: string | null } | null) ?? null

  const wonRows = (wonRes.data ?? []) as { estimated_value: number | null; won_at: string | null }[]
  // Partição por época, NUNCA por string: won_at vem em +00:00 e thisStart em -03:00 —
  // comparação lexicográfica entre offsets diferentes erra a virada do mês.
  const thisStartMs = new Date(thisStart).getTime()
  let soldThisMonth = 0
  let soldLastMonth = 0
  let wonCountThisMonth = 0
  for (const d of wonRows) {
    const v = Number(d.estimated_value ?? 0)
    if (d.won_at && new Date(d.won_at).getTime() >= thisStartMs) {
      soldThisMonth += v
      wonCountThisMonth += 1
    } else {
      soldLastMonth += v
    }
  }

  const openValue = ((openRes.data ?? []) as { estimated_value: number | null }[])
    .reduce((sum, d) => sum + Number(d.estimated_value ?? 0), 0)

  return {
    tenantName:    tenant?.name ?? "Conta",
    tenantSlug:    tenant?.slug ?? "",
    userName:      session.user.name ?? "Usuário",
    userEmail:     session.user.email ?? "",
    unit: rawUnit && rawUnit.name
      ? { id: rawUnit.id, name: rawUnit.name, color: rawUnit.color, has_logo: !!rawUnit.logo_path }
      : null,
    soldThisMonth,
    soldLastMonth,
    wonCountThisMonth,
    openValue,
    prevMonthLabel,
  }
}
