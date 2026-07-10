import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canOpenContacts, seesAllContacts, reachableContactIds } from "@/lib/visibility"
import Link from "next/link"
import { ContatosList } from "@/components/chat/contatos-list"
import { NewContactButton } from "@/components/chat/new-contact-dialog"
import { Contact, UploadCloud } from "lucide-react"

export default async function ContatosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const tenantId = session.user.tenantId
  const scope = await getViewerScope()
  if (!canOpenContacts(scope)) redirect("/inbox")
  const crmEnabled = await hasModule(tenantId, "crm")

  // Escopo por RELAÇÃO: quem NÃO vê a base inteira (admin/supervisor/Gerenciar) enxerga só
  // os contatos DELE — conversas dele + negócios dele. Fecha o vazamento da base.
  const reachableIds = seesAllContacts(scope) ? null : await reachableContactIds(scope)
  let contactsQuery = supabaseAdmin
    .from("chat_contacts")
    .select(`
      id, whatsapp_id, phone_number, push_name, profile_pic_url,
      custom_name, email, company, doc_id, birth_date,
      is_blocked, notes, source, lifecycle_stage, created_at, updated_at
    `)
    .eq("tenant_id", tenantId)
  if (reachableIds) contactsQuery = contactsQuery.in("id", reachableIds.length ? reachableIds : ["00000000-0000-0000-0000-000000000000"])

  const [{ data: contacts }, { data: tags }, { data: taggings }, { data: identities }, wonRes, listsRes, membersRes] = await Promise.all([
    contactsQuery.order("updated_at", { ascending: false }).limit(500),
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
    // Canais que o contato REALMENTE tem (identidades) — só os mensageáveis.
    supabaseAdmin
      .from("contact_identities")
      .select("contact_id, channel")
      .eq("tenant_id", tenantId)
      .in("channel", ["whatsapp", "instagram", "site"]),
    // Negócios GANHOS → dados comerciais por contato (Total · Compras · Ciclo · Última compra).
    crmEnabled
      ? supabaseAdmin
          .from("tenant_deals")
          .select("contact_id, estimated_value, created_at, won_at")
          .eq("tenant_id", tenantId).eq("status", "won").not("won_at", "is", null)
          .limit(5000)
      : Promise.resolve({ data: null }),
    // Listas (segmentos salvos) + membros — gracioso se a migration não foi aplicada.
    supabaseAdmin.from("contact_lists").select("id, name, kind, rules").eq("tenant_id", tenantId).order("name"),
    supabaseAdmin.from("contact_list_members").select("list_id, contact_id").eq("tenant_id", tenantId),
  ])

  const tagsByContact = new Map<string, string[]>()
  for (const t of taggings ?? []) {
    const arr = tagsByContact.get(t.taggable_id) ?? []
    arr.push(t.tag_id)
    tagsByContact.set(t.taggable_id, arr)
  }

  // contact_id → set de canais (dedup multi-número do WhatsApp num só "whatsapp").
  const channelsByContact = new Map<string, Set<string>>()
  for (const id of identities ?? []) {
    const set = channelsByContact.get(id.contact_id) ?? new Set<string>()
    set.add(id.channel)
    channelsByContact.set(id.contact_id, set)
  }
  const CHANNEL_ORDER = ["whatsapp", "instagram", "site"]

  // Agrega compras por contato (em memória — won deals são poucos por tenant).
  const dayMs = 86_400_000
  const commerceByContact = new Map<string, { total: number; compras: number; ciclo: number | null; ultimaDias: number | null; ticket: number | null }>()
  {
    const buckets = new Map<string, { total: number; n: number; cicloSum: number; last: string }>()
    for (const w of ((wonRes.data ?? []) as { contact_id: string | null; estimated_value: number | null; created_at: string; won_at: string }[])) {
      if (!w.contact_id) continue
      const b = buckets.get(w.contact_id) ?? { total: 0, n: 0, cicloSum: 0, last: w.won_at }
      b.total += Number(w.estimated_value ?? 0)
      b.n += 1
      b.cicloSum += Math.max(0, Math.round((new Date(w.won_at).getTime() - new Date(w.created_at).getTime()) / dayMs))
      if (w.won_at > b.last) b.last = w.won_at
      buckets.set(w.contact_id, b)
    }
    for (const [id, b] of buckets) {
      commerceByContact.set(id, {
        total: b.total, compras: b.n,
        ciclo: Math.round(b.cicloSum / b.n),
        ultimaDias: Math.max(0, Math.round((new Date().getTime() - new Date(b.last).getTime()) / dayMs)),
        ticket: b.total / b.n,
      })
    }
  }

  // Listas por contato (segmentos salvos).
  const listsByContact = new Map<string, string[]>()
  for (const m of ((membersRes.data ?? []) as { list_id: string; contact_id: string }[])) {
    const arr = listsByContact.get(m.contact_id) ?? []
    arr.push(m.list_id)
    listsByContact.set(m.contact_id, arr)
  }
  const lists = ((listsRes.data ?? []) as { id: string; name: string; kind: "static" | "dynamic" | null; rules: unknown }[])
    .map((l) => ({ id: l.id, name: l.name, kind: (l.kind ?? "static") as "static" | "dynamic", rules: (l.rules ?? null) as import("@/lib/crm/segment-rules").SegmentRules | null }))

  const enrichedContacts = (contacts ?? []).map((c) => ({
    ...c,
    tag_ids:  tagsByContact.get(c.id) ?? [],
    channels: CHANNEL_ORDER.filter((ch) => channelsByContact.get(c.id)?.has(ch)),
    commerce: commerceByContact.get(c.id) ?? null,
    list_ids: listsByContact.get(c.id) ?? [],
  }))

  const total    = enrichedContacts.length
  const blocked  = enrichedContacts.filter((c) => c.is_blocked).length
  const withTags = enrichedContacts.filter((c) => c.tag_ids.length > 0).length

  return (
    <div className="min-h-full bg-canvas">

      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Contact className="size-5 text-primary-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Contatos</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {total} {total === 1 ? "contato" : "contatos"} · {withTags} com tags
            </p>
          </div>
          {["owner", "admin"].includes(session.user.role) && (
            <Link href="/contatos/importar" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors shrink-0">
              <UploadCloud className="size-3.5" /> Importar
            </Link>
          )}
          <NewContactButton />
        </div>
      </div>

      <div className="px-6 py-6">
        <ContatosList
          contacts={enrichedContacts}
          tags={tags ?? []}
          lists={lists}
          stats={{ total, blocked, withTags }}
          crmEnabled={crmEnabled}
        />
      </div>
    </div>
  )
}
