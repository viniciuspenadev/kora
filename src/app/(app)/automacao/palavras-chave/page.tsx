import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Wand2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { KeywordsClient, type TriggerRow, type TagOption } from "./client"

export default async function KeywordsPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId

  const [{ data: triggers }, { data: tags }] = await Promise.all([
    supabaseAdmin
      .from("keyword_triggers")
      .select(`
        id, name, patterns, match_type, case_sensitive,
        response_text, apply_tag_id, cooldown_min, enabled,
        position, pause_when_assigned, created_at, updated_at,
        tags ( id, name, color )
      `)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("tags")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .order("name"),
  ])

  const rows: TriggerRow[] = (triggers ?? []).map((t) => {
    const tag = t.tags as unknown as { id: string; name: string; color: string } | null
    return {
      id:                  t.id,
      name:                t.name,
      patterns:            t.patterns ?? [],
      match_type:          t.match_type,
      case_sensitive:      t.case_sensitive,
      response_text:       t.response_text,
      apply_tag_id:        t.apply_tag_id,
      apply_tag:           tag,
      cooldown_min:        t.cooldown_min,
      enabled:             t.enabled,
      position:            t.position,
      pause_when_assigned: t.pause_when_assigned,
    }
  })

  const tagOptions: TagOption[] = (tags ?? []).map((t) => ({
    id:    t.id,
    name:  t.name,
    color: t.color,
  }))

  return (
    <PageShell
      title="Palavras-chave"
      description="Quando o contato disser uma palavra ou frase específica, o bot responde automaticamente e/ou aplica uma tag."
      icon={Wand2}
    >
      <KeywordsClient rows={rows} tags={tagOptions} />
    </PageShell>
  )
}
