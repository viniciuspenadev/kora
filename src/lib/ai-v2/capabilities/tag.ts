// ═══════════════════════════════════════════════════════════════
// Capacidade: etiquetar/desetiquetar o CONTATO da conversa
// ═══════════════════════════════════════════════════════════════
// Espelha applyTag/removeTag (actions/tags.ts), mas como ação de SISTEMA
// (tagged_by = null). Tenant-scoping em TODA query (.eq tenant_id); o alvo
// é sempre ctx.contact (já do tenant) — sem caminho pra cross-tenant.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"

export const TAG = "tag"

interface TagArgs { tag: string; action: "add" | "remove" }

export const tagCapability = defineCapability<TagArgs>({
  id:           TAG,
  name:         "Etiquetar contato",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       true,
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return {
      tag:    typeof p.tag === "string" ? p.tag.trim() : "",
      action: p.action === "remove" ? "remove" : "add",
    }
  },
  execute: async (ctx, args) => {
    const { tenantId, contact } = ctx
    if (!args.tag) return { ok: false, error: "tag vazia" }

    // Resolve a tag por nome DENTRO do tenant (case-insensível).
    const { data: tagRows } = await supabaseAdmin
      .from("tags").select("id").eq("tenant_id", tenantId).ilike("name", args.tag).limit(1)
    let tagId = tagRows?.[0]?.id as string | undefined

    if (args.action === "remove") {
      if (!tagId) return { ok: true } // nada a remover
      const { error } = await supabaseAdmin
        .from("taggings").delete()
        .eq("tenant_id", tenantId).eq("tag_id", tagId)
        .eq("taggable_type", "contact").eq("taggable_id", contact.id)
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }

    // add: cria a tag se ainda não existe (no tenant).
    if (!tagId) {
      const { data: created, error } = await supabaseAdmin
        .from("tags").insert({ tenant_id: tenantId, name: args.tag, color: "#64748b" })
        .select("id").single()
      if (error || !created) return { ok: false, error: error?.message ?? "falha ao criar tag" }
      tagId = created.id
    }
    const { error } = await supabaseAdmin.from("taggings").insert({
      tag_id: tagId, tenant_id: tenantId, taggable_type: "contact", taggable_id: contact.id, tagged_by: null,
    })
    if (error && !error.message.includes("duplicate")) return { ok: false, error: error.message }
    return { ok: true }
  },
})
