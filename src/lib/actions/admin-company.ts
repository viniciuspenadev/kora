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
    // tenant_id DEPOIS do spread (clean() é passthrough): o tenant escolhido pelo admin vence um tenant_id que vaze em `input`.
    .upsert({ ...clean(input), tenant_id: tenantId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/empresa`)
  return {}
}

export async function upsertIssuer(input: Record<string, string | null>): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("billing_issuer")
    // 🔴 `id` DEPOIS do spread (12/08). Antes ele vinha primeiro, e um `id` vindo no `input`
    //    o sobrescreveria — o alvo do upsert deixaria de ser o singleton. Hoje só não quebra
    //    porque a coluna é `boolean` e o Postgres recusa a string: a defesa é do BANCO, não
    //    do código, e defesa que depende do tipo da coluna evapora no dia em que alguém
    //    mudar a coluna. Mesma ordem que o vizinho `upsertTenantBillingProfile` já usa pro
    //    `tenant_id` — a regra da skill `database-rules` §2 é essa: o campo que DEFINE o
    //    alvo vem por último, sempre.
    .upsert({ ...clean(input), id: true, updated_at: new Date().toISOString() }, { onConflict: "id" })
  if (error) return { error: error.message }
  revalidatePath("/admin/financeiro/emissor")
  return {}
}
