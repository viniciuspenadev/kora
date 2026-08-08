import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { upsertTemplateCache } from "@/lib/channels/template-cache"

/**
 * Núcleo do sync de cache de templates (`wa_templates`) — server-only, SEM auth,
 * **NÃO é Server Action** (de propósito).
 *
 * ⚠️ 2026-07-30: é chamado de dentro de `after()` num Server Component
 * (templates/page.tsx), onde `auth()`/`headers()` LANÇAM no Next 16. Por isso NÃO pode
 * ter auth aqui. A autorização mora no wrapper `syncTemplatesCache` (action gated
 * owner/admin, whatsapp-official.ts); o caller do `after()` já resolveu o tenantId da
 * sessão FORA do after. (Antes esta lógica era exportada de "use server" e o guard
 * assertSessionTenant que eu adicionei quebrou o auto-sync — regressão corrigida movendo
 * o núcleo p/ cá, como o C-01. Ver database-rules §2/§3.)
 */
export async function syncTemplatesCacheCore(tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenantId)
    .eq("provider", "meta_cloud")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_phone_number_id || !inst.meta_access_token) {
    return { ok: false, error: "Instância oficial não configurada." }
  }

  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst.meta_phone_number_id,
    meta_business_account_id: inst.meta_business_account_id ?? "",
    meta_access_token:        decryptSecret(inst.meta_access_token),
    meta_app_secret:          decryptSecret(inst.meta_app_secret) ?? "",
  })

  try {
    const templates = await provider.listTemplates()
    for (const t of templates) {
      // Best-effort: upsertTemplateCache já engole erros por item.
      await upsertTemplateCache(tenantId, inst.id, inst.meta_business_account_id ?? null, {
        templateId:     t.id,
        name:           t.name,
        language:       t.language,
        category:       t.category,
        status:         t.status,
        qualityScore:   t.quality_score?.score,
        rejectedReason: t.rejected_reason,
        components:     t.components,
      })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
