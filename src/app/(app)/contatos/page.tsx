import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { ContatosList } from "@/components/chat/contatos-list"
import { Contact } from "lucide-react"

export default async function ContatosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const tenantId = session.user.tenantId

  const [{ data: contacts }, { data: tags }, { data: taggings }] = await Promise.all([
    supabaseAdmin
      .from("chat_contacts")
      .select(`
        id, whatsapp_id, phone_number, push_name, profile_pic_url,
        custom_name, email, company, doc_id, birth_date,
        is_blocked, notes, source, lifecycle_stage, created_at, updated_at
      `)
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("tags")
      .select("id, name, color, description")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabaseAdmin
      .from("taggings")
      .select("tag_id, taggable_id")
      .eq("tenant_id", tenantId)
      .eq("taggable_type", "contact"),
  ])

  const tagsByContact = new Map<string, string[]>()
  for (const t of taggings ?? []) {
    const arr = tagsByContact.get(t.taggable_id) ?? []
    arr.push(t.tag_id)
    tagsByContact.set(t.taggable_id, arr)
  }

  const enrichedContacts = (contacts ?? []).map((c) => ({
    ...c,
    tag_ids: tagsByContact.get(c.id) ?? [],
  }))

  const total    = enrichedContacts.length
  const blocked  = enrichedContacts.filter((c) => c.is_blocked).length
  const withTags = enrichedContacts.filter((c) => c.tag_ids.length > 0).length

  return (
    <div className="min-h-full bg-slate-50">

      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Contact className="size-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Contatos</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {total} {total === 1 ? "contato" : "contatos"} · {withTags} com tags
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <ContatosList
          contacts={enrichedContacts}
          tags={tags ?? []}
          stats={{ total, blocked, withTags }}
        />
      </div>
    </div>
  )
}
