import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { matchesSegment, type SegmentRules } from "@/lib/crm/segment-rules"

// ─────────────────────────────────────────────────────────────────
// Resolução de audiência de campanha (compartilhada: preview + motor).
// NÃO é "use server" — é helper de servidor puro (devolve consent/phone),
// consumido por campaigns.ts (preview) e engine.ts (materializar).
// ─────────────────────────────────────────────────────────────────

/** Preço aproximado por conversa iniciada (BRL) — configurável no futuro (admin). */
export const CONV_PRICE = { MARKETING: 0.35, UTILITY: 0.08 } as const

export interface AudContact { id: string; phone: string | null; marketing_opt_in: boolean; consent_opt_in: boolean }

/** Cap de segurança (v1): audiência resolvida limitada a 5000 contatos. */
const AUDIENCE_CAP = 5000

/**
 * Resolve a audiência (lista estática/dinâmica OU tag) → contatos DISTINTOS com
 * telefone + consent. Dinâmica avalia as regras ao vivo.
 */
export async function resolveAudienceContacts(t: string, kind: "list" | "tag", id: string): Promise<AudContact[]> {
  const pick = (rows: unknown[]): AudContact[] =>
    (rows as { id: string; phone_number: string | null; marketing_opt_in: boolean | null; consent_opt_in: boolean | null }[])
      .map((c) => ({ id: c.id, phone: c.phone_number, marketing_opt_in: !!c.marketing_opt_in, consent_opt_in: !!c.consent_opt_in }))

  if (kind === "tag") {
    const { data: tg } = await supabaseAdmin.from("taggings")
      .select("taggable_id").eq("tenant_id", t).eq("taggable_type", "contact").eq("tag_id", id).limit(AUDIENCE_CAP)
    const ids = Array.from(new Set(((tg ?? []) as { taggable_id: string }[]).map((x) => x.taggable_id)))
    if (!ids.length) return []
    const { data } = await supabaseAdmin.from("chat_contacts")
      .select("id, phone_number, marketing_opt_in, consent_opt_in").eq("tenant_id", t).in("id", ids)
    return pick(data ?? [])
  }

  const { data: list } = await supabaseAdmin.from("contact_lists")
    .select("kind, rules").eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!list) return []
  const L = list as { kind: string | null; rules: SegmentRules | null }

  if ((L.kind ?? "static") === "static") {
    const { data: mem } = await supabaseAdmin.from("contact_list_members")
      .select("contact_id").eq("tenant_id", t).eq("list_id", id).limit(AUDIENCE_CAP)
    const ids = ((mem ?? []) as { contact_id: string }[]).map((m) => m.contact_id)
    if (!ids.length) return []
    const { data } = await supabaseAdmin.from("chat_contacts")
      .select("id, phone_number, marketing_opt_in, consent_opt_in").eq("tenant_id", t).in("id", ids)
    return pick(data ?? [])
  }

  // Dinâmica: avalia regras ao vivo (contatos + tags + últimos ganhos).
  if (!L.rules) return []
  const [{ data: cs }, { data: tags }, { data: won }] = await Promise.all([
    supabaseAdmin.from("chat_contacts").select("id, lifecycle_stage, created_at, phone_number, marketing_opt_in, consent_opt_in").eq("tenant_id", t).limit(AUDIENCE_CAP),
    supabaseAdmin.from("taggings").select("tag_id, taggable_id").eq("tenant_id", t).eq("taggable_type", "contact"),
    supabaseAdmin.from("tenant_deals").select("contact_id, won_at").eq("tenant_id", t).eq("status", "won").not("won_at", "is", null).limit(AUDIENCE_CAP),
  ])
  const tagsBy = new Map<string, string[]>()
  for (const x of (tags ?? []) as { tag_id: string; taggable_id: string }[]) {
    const arr = tagsBy.get(x.taggable_id) ?? []; arr.push(x.tag_id); tagsBy.set(x.taggable_id, arr)
  }
  const lastWon = new Map<string, string>()
  for (const w of (won ?? []) as { contact_id: string | null; won_at: string }[]) {
    if (!w.contact_id) continue
    const cur = lastWon.get(w.contact_id)
    if (!cur || w.won_at > cur) lastWon.set(w.contact_id, w.won_at)
  }
  const now = Date.now()
  const out: AudContact[] = []
  for (const c of (cs ?? []) as { id: string; lifecycle_stage: string | null; created_at: string; phone_number: string | null; marketing_opt_in: boolean | null; consent_opt_in: boolean | null }[]) {
    const last = lastWon.get(c.id)
    const seg = {
      lifecycle_stage: c.lifecycle_stage, tag_ids: tagsBy.get(c.id) ?? [], created_at: c.created_at,
      ultima_dias: last ? Math.max(0, Math.floor((now - new Date(last).getTime()) / 86_400_000)) : null,
    }
    if (matchesSegment(seg, L.rules)) out.push({ id: c.id, phone: c.phone_number, marketing_opt_in: !!c.marketing_opt_in, consent_opt_in: !!c.consent_opt_in })
  }
  return out
}

/** Classifica um contato: elegível ou motivo de skip (consent fail-closed pela categoria). */
export function classifyRecipient(c: AudContact, category: "MARKETING" | "UTILITY"): { ok: true } | { skip: "no_phone" | "no_consent" } {
  if (!c.phone) return { skip: "no_phone" }
  const consented = category === "MARKETING" ? c.marketing_opt_in : c.consent_opt_in
  if (!consented) return { skip: "no_consent" }
  return { ok: true }
}
