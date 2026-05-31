import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { InboxClient } from "@/components/chat/inbox-client"
import { getConversations } from "@/lib/actions/conversations"
import { getUnreadTotal } from "@/lib/actions/chat"
import type { ChatMessage, ChatContact, ChatQuickReply } from "@/types/chat"

const INITIAL_LIMIT       = 25
const INITIAL_STATUS      = "open"     // tab default
const PRELOAD_MESSAGES_OF = 0          // 0 = não pré-carrega msgs (Fase C move pra carregamento sob demanda)

export default async function InboxPage() {
  const session = await auth()
  if (!session) return null

  const tenantId = session.user.tenantId

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .single()

  const instanceStatus = !instance ? "not_configured" : instance.status

  if (!instance || instance.status === "disconnected") {
    return (
      <div className="h-[calc(100vh-3.5rem)]">
        <InboxClient
          conversations={[]}
          messages={{}}
          contacts={{}}
          quickReplies={[]}
          agents={[]}
          instanceStatus={instanceStatus}
          initialCursor={null}
          initialHasMore={false}
          initialUnreadTotal={0}
          tenantId={tenantId}
          currentUserId={session.user.id}
          supabaseToken={session.user.supabaseToken}
        />
      </div>
    )
  }

  const [
    initialPage,
    initialUnread,
    { data: quickReplies },
    { data: agentsRaw },
    { data: pipelinesRaw },
    { data: stagesRaw },
    { data: tagsRaw },
    { data: taggingsRaw },
  ] = await Promise.all([
    getConversations({ filters: { status: INITIAL_STATUS }, limit: INITIAL_LIMIT }),
    getUnreadTotal(),
    supabaseAdmin
      .from("chat_quick_replies")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("shortcut"),
    supabaseAdmin
      .from("tenant_users")
      .select("user_id, profiles ( full_name )")
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabaseAdmin
      .from("pipelines")
      .select("id, name, color, is_default")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("position"),
    supabaseAdmin
      .from("pipeline_stages")
      .select("id, pipeline_id, name, color, position, is_won, is_lost")
      .eq("tenant_id", tenantId)
      .order("position"),
    supabaseAdmin
      .from("tags")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabaseAdmin
      .from("taggings")
      .select("tag_id, taggable_id")
      .eq("tenant_id", tenantId)
      .eq("taggable_type", "contact"),
  ])

  const conversations = initialPage.conversations

  // Mensagens não são mais pré-carregadas no SSR. Cliente busca quando seleciona conv.
  // (Fase C vai paginar isso também.)
  const messagesByConv: Record<string, ChatMessage[]> = {}
  void PRELOAD_MESSAGES_OF

  const contactsMap: Record<string, ChatContact> = {}
  for (const conv of conversations) {
    if (conv.chat_contacts && conv.contact_id) {
      contactsMap[conv.contact_id] = conv.chat_contacts as ChatContact
    }
  }

  const agents = (agentsRaw ?? []).map((a) => {
    const prof = (a as { profiles?: { full_name: string | null } | { full_name: string | null }[] | null }).profiles
    const fullName = Array.isArray(prof) ? prof[0]?.full_name ?? null : prof?.full_name ?? null
    return {
      id:        (a as { user_id: string }).user_id,
      full_name: fullName,
    }
  })

  const tagsByContact: Record<string, string[]> = {}
  for (const t of taggingsRaw ?? []) {
    const arr = tagsByContact[(t as { taggable_id: string }).taggable_id] ?? []
    arr.push((t as { tag_id: string }).tag_id)
    tagsByContact[(t as { taggable_id: string }).taggable_id] = arr
  }

  return (
    <div className="h-[calc(100vh-3.5rem)]">
      <InboxClient
        conversations={conversations}
        messages={messagesByConv}
        contacts={contactsMap}
        quickReplies={(quickReplies ?? []) as ChatQuickReply[]}
        agents={agents}
        instanceStatus={instanceStatus}
        pipelines={(pipelinesRaw ?? []) as unknown as PipelineMini[]}
        stages={(stagesRaw ?? []) as unknown as StageMini[]}
        tags={(tagsRaw ?? []) as unknown as TagMini[]}
        tagsByContact={tagsByContact}
        initialCursor={initialPage.nextCursor}
        initialHasMore={initialPage.hasMore}
        initialStatus={INITIAL_STATUS}
        initialUnreadTotal={initialUnread}
        tenantId={tenantId}
        currentUserId={session.user.id}
        supabaseToken={session.user.supabaseToken}
      />
    </div>
  )
}

interface PipelineMini { id: string; name: string; color: string; is_default: boolean }
interface StageMini    { id: string; pipeline_id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean }
interface TagMini      { id: string; name: string; color: string }
