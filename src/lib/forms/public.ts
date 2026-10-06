import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { checkTenantStatus } from "@/lib/auth/tenant-serviceable"
import { normalizeDefinition, type FormDefinition } from "./definition"
import { signRenderToken } from "./server"
import { isPublicId } from "./identity"
import { normalizeAllowedDomains } from "./embed"

// Kora Formulários — o formulário como a internet vê (link próprio; a moldura do site usa o
// mesmo). Só sai a VERSÃO PUBLICADA; o rascunho nunca. Fora do ar (pausado, empresa que
// deixou de ser cliente, módulo desligado) tem UMA resposta só — não vaza o motivo.

export type PublicForm =
  | { state: "ok"; publicId: string; name: string; businessName: string; definition: FormDefinition; renderToken: string }
  | { state: "unavailable"; businessName: string }
  | { state: "not_found" }

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export async function loadPublicForm(tenantSlug: string, formSlug: string): Promise<PublicForm> {
  if (!SLUG_RE.test(tenantSlug) || tenantSlug.length > 80 || !SLUG_RE.test(formSlug) || formSlug.length > 60) return { state: "not_found" }
  const { data: tenant } = await supabaseAdmin.from("tenants").select("id, name, active").eq("slug", tenantSlug).maybeSingle()
  const t = tenant as { id: string; name: string | null; active: boolean | null } | null
  if (!t?.active) return { state: "not_found" }

  const { data: formRow } = await supabaseAdmin.from("forms")
    .select(FORM_COLS)
    .eq("tenant_id", t.id).eq("slug", formSlug).maybeSingle()
  return publicFormOf(t, formRow as FormRow | null)
}

/**
 * O formulário DENTRO do site do cliente (/embed/<public_id>). Mesma régua do link próprio,
 * mais os sites autorizados — quem os IMPÕE é o navegador (`frame-ancestors`, no proxy);
 * aqui eles só conferem a página que o carregador informa.
 */
export async function loadPublicFormById(publicId: string): Promise<PublicForm & { allowedDomains: string[] }> {
  if (!isPublicId(publicId)) return { state: "not_found", allowedDomains: [] }
  const { data: formRow } = await supabaseAdmin.from("forms").select(`${FORM_COLS}, tenant_id, allowed_domains`)
    .eq("public_id", publicId).maybeSingle()
  const row = formRow as (FormRow & { tenant_id: string; allowed_domains: string[] | null }) | null
  if (!row) return { state: "not_found", allowedDomains: [] }
  const { data: tenant } = await supabaseAdmin.from("tenants").select("id, name, active").eq("id", row.tenant_id).maybeSingle()
  const t = tenant as { id: string; name: string | null; active: boolean | null } | null
  if (!t?.active) return { state: "not_found", allowedDomains: [] }
  return { ...(await publicFormOf(t, row)), allowedDomains: normalizeAllowedDomains(row.allowed_domains) }
}

const FORM_COLS = "id, public_id, name, status, archived_at, published_version_id"
type FormRow = { id: string; public_id: string; name: string; status: string; archived_at: string | null; published_version_id: string | null }

async function publicFormOf(t: { id: string; name: string | null }, form: FormRow | null): Promise<PublicForm> {
  // Rascunho nunca publicado = não existe para a internet.
  if (!form || form.archived_at || !form.published_version_id) return { state: "not_found" }

  const businessName = (t.name ?? "").trim()
  if (form.status !== "published") return { state: "unavailable", businessName }
  const status = await checkTenantStatus(t.id)
  if (!status.degraded && !status.canAccess) return { state: "unavailable", businessName }
  if (!(await hasModule(t.id, "forms"))) return { state: "unavailable", businessName }

  const { data: ver } = await supabaseAdmin.from("form_versions").select("definition")
    .eq("tenant_id", t.id).eq("form_id", form.id).eq("id", form.published_version_id).maybeSingle()
  if (!ver) return { state: "unavailable", businessName }

  return {
    state: "ok", publicId: form.public_id, name: form.name, businessName,
    definition: normalizeDefinition((ver as { definition: unknown }).definition),
    renderToken: signRenderToken(form.public_id),
  }
}
