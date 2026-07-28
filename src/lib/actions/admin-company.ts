"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

/**
 * Dados de faturamento (god mode):
 *   - tenant_billing_profile (perfil fiscal do cliente, 1:1 tenant)
 *   - billing_issuer (emissor — Kora/BlueDigitalHub, singleton)
 * Alimentam a fatura em PDF.
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

export interface BillingProfile {
  person_type:            string  // 'pj' | 'pf'
  legal_name:             string | null
  trade_name:             string | null
  tax_id:                 string | null
  state_registration:     string | null
  municipal_registration: string | null
  billing_email:          string | null
  phone:                  string | null
  responsible_name:       string | null
  zip:                    string | null
  street:                 string | null
  number:                 string | null
  complement:             string | null
  district:               string | null
  city:                   string | null
  state:                  string | null
  notes:                  string | null
}

export interface Issuer extends Omit<BillingProfile, "responsible_name" | "notes"> {
  pix_key:              string | null
  bank_info:            string | null
  payment_instructions: string | null
  logo_url:             string | null
}

function clean<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === "string" ? (v.trim() || null) : v
  }
  if (out.person_type !== "pf" && out.person_type !== "pj") out.person_type = "pj"
  return out as T
}

export async function upsertTenantBillingProfile(tenantId: string, input: Record<string, string | null>): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("tenant_billing_profile")
    .upsert({ tenant_id: tenantId, ...clean(input), updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/empresa`)
  return {}
}

export async function upsertIssuer(input: Record<string, string | null>): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("billing_issuer")
    .upsert({ id: true, ...clean(input), updated_at: new Date().toISOString() }, { onConflict: "id" })
  if (error) return { error: error.message }
  revalidatePath("/admin/financeiro/emissor")
  return {}
}
