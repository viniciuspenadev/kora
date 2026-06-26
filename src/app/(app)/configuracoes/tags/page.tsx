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

  const { data: tags } = await supabaseAdmin
    .from("tags")
    .select("id, name, color, description")
    .eq("tenant_id", session.user.tenantId)
    .order("name")

  return (
    <PageShell
      title="Tags"
      description="Crie etiquetas para organizar contatos e conversas — cor, nome e descrição."
      icon={TagIcon}
    >
      <TagsConfigClient tags={tags ?? []} />
    </PageShell>
  )
}
