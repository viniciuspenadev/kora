import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { checkTenantStatus } from "@/lib/auth/tenant-serviceable"
import { normalizeDefinition, type FormDefinition } from "./definition"
import { signRenderToken } from "./server"

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
    .select("id, public_id, name, status, archived_at, published_version_id")
    .eq("tenant_id", t.id).eq("slug", formSlug).maybeSingle()
  const form = formRow as { id: string; public_id: string; name: string; status: string; archived_at: string | null; published_version_id: string | null } | null
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
