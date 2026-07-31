import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { Blocks } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { IntegracoesClient, type IntegrationCard } from "./integracoes-client"

/** Estados que contam como "no ar" numa instância de WhatsApp. */
const CONNECTED_STATES = new Set(["connected", "open"])

/** Widget "vivo" = pediu configuração nos últimos 7 dias. Fora do componente porque
 *  `Date.now()` no corpo do render cai na regra `react-hooks/purity`. */
const isFresh = (iso: string | null, days = 7) =>
  !!iso && Date.now() - new Date(iso).getTime() < days * 24 * 3600_000

export default async function IntegracoesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId

  // Última atividade REAL = data da última MENSAGEM. Usar `updated_at` seria mentira
  // confortável: aquilo mexe quando o STATUS muda (reconexão, refresh de token), não
  // quando um cliente escreve.
  // O WhatsApp nem precisa de consulta: a própria instância carimba
  // `last_inbound_message_at`/`last_outbound_message_at`. Instagram não tem linha
  // equivalente, então ali vem da conversa.
  const lastActivity = (channel: string) =>
    supabaseAdmin.from("chat_conversations")
      .select("last_message_at")
      .eq("tenant_id", tenantId).eq("channel", channel)
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(1)

  const [{ data: instances }, modules, { data: igRows }, { data: igLast }, { data: wRows }] = await Promise.all([
    // ⚠️ Nomes de coluna CONFERIDOS no schema (2026-07-30): `instance_name`/`display_name`
    //    — não existe `label`. Coluna inexistente no `.select()` faz o PostgREST recusar a
    //    consulta INTEIRA, e a página mostraria "conecte seu primeiro número" com dois
    //    números no ar. Falha silenciosa e convincente, a pior combinação.
    supabaseAdmin
      .from("whatsapp_instances")
      .select("id, phone_number, display_name, instance_name, provider, status, last_inbound_message_at, last_outbound_message_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    getEnabledModuleSlugs(tenantId),
    // ⚠️ `.limit(1)` e não `.maybeSingle()`: com DUAS contas de IG o PostgREST devolve
    //    PGRST116 e a página inteira mostraria "não conectado" com a conta no ar. Mesma
    //    armadilha de getInstagramSender (instagram/api.ts).
    supabaseAdmin
      .from("channel_connections")
      .select("username, status, access_token, updated_at, meta")
      .eq("tenant_id", tenantId).eq("channel", "instagram")
      .order("created_at", { ascending: true })
      .limit(1),
    lastActivity("instagram"),
    // `last_seen_*` pode não existir ainda (migration do heartbeat não aplicada) — por
    // isso a seleção é tolerante: `select("*")` aqui é seguro (tabela de config pública,
    // sem segredo) e evita derrubar a página inteira por uma coluna que falta.
    supabaseAdmin.from("site_widget_config").select("*").eq("tenant_id", tenantId).limit(1),
  ])

  const widget       = (wRows?.[0] ?? null) as Record<string, unknown> | null
  const widgetSeenAt = (widget?.last_seen_at as string | null) ?? null
  const widgetOrigin = (widget?.last_seen_origin as string | null) ?? null
  // Site que ficou uma semana sem UMA visita com o widget no ar é raro o bastante pra
  // valer investigar — por isso 7 dias, e não "existe carimbo".
  const widgetLive   = isFresh(widgetSeenAt)

  const igLastAt = (igLast?.[0]?.last_message_at as string | null) ?? null

  const igConn      = igRows?.[0] ?? null
  const igConnected = igConn?.status === "active" && !!igConn?.access_token
  // `webhook_comments` é carimbado no connect/re-assinar (actions/instagram.ts). Ausente
  // = conexão anterior a 2026-07-30, e aí a gente NÃO afirma o que não sabe.
  const igMeta      = (igConn?.meta ?? {}) as { webhook_comments?: boolean }

  const list        = instances ?? []
  const waConnected = list.filter((i) => CONNECTED_STATES.has(i.status ?? ""))
  // A mais recente entre TODAS as instâncias, entrada ou saída: o card fala do canal,
  // não de um número específico.
  const waLastAt = list
    .flatMap((i) => [i.last_inbound_message_at, i.last_outbound_message_at])
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined ?? null

  const cards: IntegrationCard[] = [
    {
      slug: "whatsapp", name: "WhatsApp", source: "whatsapp_inbound", type: "Canal",
      href: "/integracoes/whatsapp",
      status: waConnected.length > 0 ? "connected" : "available",
      headline: list.length === 0
        ? "Conecte seu primeiro número — oficial pela Meta ou via QR Code."
        : `${list.length} ${list.length === 1 ? "número conectado" : "números conectados"}`,
      // Número primeiro (é como o dono reconhece a linha); nome só quando não há número
      // — instância via QR Code fica sem `phone_number` até parear.
      // Número primeiro (é como o dono reconhece a linha); apelido só enquanto o número
      // não chegou — instância pareada por QR nasce sem `phone_number` e o cron
      // (ping-evolution) preenche no ciclo seguinte, lendo o dono da Evolution.
      // `href` por linha: com 2+ números, clicar no número vai DIRETO pra ele em vez de
      // passar pela lista (pedido do dono). Só o canal oficial tem página por número;
      // QR ainda não tem, então cai na lista.
      rows: list.map((i) => ({
        label: (i.phone_number as string | null)
            ?? (i.display_name as string | null)
            ?? (i.instance_name as string | null)
            ?? "Número",
        ok:    CONNECTED_STATES.has(i.status ?? ""),
        note:  CONNECTED_STATES.has(i.status ?? "") ? "Ativo" : "Desconectado",
        href:  i.provider === "meta_cloud"
          ? `/integracoes/whatsapp-oficial?id=${i.id}`
          : "/integracoes/whatsapp",
      })),
      footNote: null,
      lastAt:   waLastAt,
    },
    {
      slug: "instagram", name: "Instagram Direct", source: "instagram", type: "Canal",
      href: "/integracoes/instagram",
      status: igConnected ? "connected" : modules.has("instagram_direct") ? "available" : "soon",
      headline: igConnected && igConn?.username
        ? `@${igConn.username}`
        : "Receba e responda mensagens do Instagram dentro da Kora.",
      rows: [],
      // Só afirma "comentários" quando o carimbo diz que o campo FOI assinado — é a
      // diferença entre o fluxo de comentário funcionar ou não, e chutar aqui manda o
      // cliente caçar problema no lugar errado.
      footNote: igConnected
        ? (igMeta.webhook_comments === true  ? "Mensagens e comentários ativos"
        :  igMeta.webhook_comments === false ? "Mensagens ativas · comentários não autorizados"
        :  "Mensagens ativas")
        : null,
      lastAt:   igConnected ? igLastAt : null,
    },
    {
      slug: "widget_site", name: "Widget do site", source: "webform", type: "Canal",
      href: "/configuracoes/site",
      // "Conectado" só com sinal de vida REAL (o widget pediu configuração). Sem o
      // carimbo a gente não afirma que está instalado — dizer "conectado" porque a
      // config existe seria o mesmo erro de contar o `updated_at` como atividade.
      status: !modules.has("widget_site") ? "soon" : widgetLive ? "connected" : "available",
      headline: widgetLive
        ? (widgetOrigin ? `Instalado em ${widgetOrigin.replace(/^https?:\/\//, "")}` : "Instalado e recebendo visitas")
        : "Capture leads com um widget instalado no seu site.",
      rows: [],
      footNote: widgetLive ? null : "Integre seu site e comece a receber leads",
      lastAt:   widgetSeenAt,
    },
    {
      slug: "messenger", name: "Facebook Messenger", source: "messenger", type: "Canal",
      href: null, status: "soon",
      headline: "Atenda as mensagens da sua página do Facebook sem sair da Kora.",
      rows: [], footNote: "Novidades chegando!", lastAt: null,
    },
  ]

  return (
    <PageShell
      title="Integrações"
      description="Conecte a Kora aos apps que você já usa. Canais, e mais por vir."
      icon={Blocks}
    >
      <IntegracoesClient cards={cards} />
    </PageShell>
  )
}
