import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Tag as TagIcon } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { TagsConfigClient } from "./tags-client"

export default async function TagsConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [{ data: tags }, { data: taggings }] = await Promise.all([
    supabaseAdmin
      .from("tags")
      .select("id, name, color, description, created_at")
      .eq("tenant_id", session.user.tenantId)
      .order("created_at", { ascending: false }),
    // Contagem de CONTATOS por tag → a tag vira SEGMENTO (contagem clicável).
    supabaseAdmin
      .from("taggings")
      .select("tag_id")
      .eq("tenant_id", session.user.tenantId)
      .eq("taggable_type", "contact"),
  ])

  const counts = new Map<string, number>()
  for (const t of (taggings ?? []) as { tag_id: string }[])
    counts.set(t.tag_id, (counts.get(t.tag_id) ?? 0) + 1)

  const enriched = (tags ?? []).map((t) => ({ ...t, contacts: counts.get(t.id) ?? 0 }))

  return (
    <PageShell
      title="Tags"
      description="Organize e segmente — cada tag é um público: clique na contagem para ver e agir."
      icon={TagIcon}
    >
      <TagsConfigClient tags={enriched} />
    </PageShell>
  )
}
