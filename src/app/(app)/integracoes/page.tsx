import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { Blocks, ChevronRight } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { StatusDot } from "@/components/ui/status-dot"
import { SourceLogo } from "@/components/chat/source-logo"

type IntegrationStatus = "connected" | "available" | "soon"

interface IntegrationCard {
  slug:        string
  name:        string
  description: string
  source:      string            // pra reusar o SourceLogo (logo da marca)
  category:    string
  href:        string | null     // rota de config (null quando "em breve")
  status:      IntegrationStatus
}

const CONNECTED_STATES = new Set(["connected", "open"])

export default async function IntegracoesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId

  const [{ data: instances }, modules, { data: igConn }] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_instances")
      .select("provider, status")
      .eq("tenant_id", tenantId),
    getEnabledModuleSlugs(tenantId),
    supabaseAdmin
      .from("channel_connections")
      .select("username, status, access_token")
      .eq("tenant_id", tenantId).eq("channel", "instagram")
      .maybeSingle(),
  ])
  const igConnected = igConn?.status === "active" && !!igConn?.access_token

  const list = instances ?? []
  const waTotal     = list.length
  const waConnected = list.filter((i) => CONNECTED_STATES.has(i.status ?? "")).length
  const whatsappDesc = waTotal === 0
    ? "Conecte seu primeiro número — oficial pela Meta ou via QR Code."
    : `${waTotal} ${waTotal === 1 ? "número" : "números"} · ${waConnected} conectado${waConnected === 1 ? "" : "s"}`

  const integrations: IntegrationCard[] = [
    {
      slug:        "whatsapp",
      name:        "WhatsApp",
      description: whatsappDesc,
      source:      "whatsapp_inbound",
      category:    "Canais",
      // Página dedicada de gestão dos números (oficiais + QR).
      href:        "/integracoes/whatsapp",
      status:      waConnected > 0 ? "connected" : "available",
    },
    {
      slug:        "widget_site",
      name:        "Widget do site",
      description: "Capture leads com um widget instalado no seu site.",
      source:      "webform",
      category:    "Canais",
      href:        "/configuracoes/site",
      status:      modules.has("widget_site") ? "available" : "soon",
    },
    {
      slug:        "instagram",
      name:        "Instagram Direct",
      description: igConnected && igConn?.username
        ? `Conectado · @${igConn.username}`
        : "Receba e responda mensagens do Instagram dentro da Kora.",
      source:      "instagram",
      category:    "Canais",
      href:        "/integracoes/instagram",
      status:      igConnected ? "connected" : "available",
    },
    {
      slug:        "messenger",
      name:        "Facebook Messenger",
      description: "Atenda as mensagens da sua página do Facebook sem sair da Kora.",
      source:      "messenger",
      category:    "Canais",
      href:        null,
      status:      "soon",
    },
  ]

  const visibleIntegrations = integrations

  // Agrupa por categoria (hoje só "Canais", mas já preparado pra crescer)
  const byCategory = new Map<string, IntegrationCard[]>()
  for (const it of visibleIntegrations) {
    if (!byCategory.has(it.category)) byCategory.set(it.category, [])
    byCategory.get(it.category)!.push(it)
  }

  return (
    <PageShell
      title="Integrações"
      description="Conecte a Kora aos apps que você já usa. Canais, e mais por vir."
      icon={Blocks}
    >
      <div className="space-y-8 max-w-5xl">
        {Array.from(byCategory.entries()).map(([category, items]) => (
          <section key={category}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{category}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((it) => (
                <IntegrationTile key={it.slug} integration={it} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </PageShell>
  )
}

function StatusPill({ status }: { status: IntegrationStatus }) {
  if (status === "connected") return <StatusDot tone="success" label="Conectado" size="sm" />
  if (status === "available") return <StatusDot tone="neutral" label="Disponível" size="sm" />
  return (
    <span className="inline-flex items-center text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
      Em breve
    </span>
  )
}

function IntegrationTile({ integration: it }: { integration: IntegrationCard }) {
  const soon = it.status === "soon"
  const clickable = !soon && !!it.href

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="size-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
          <SourceLogo source={it.source} size={22} />
        </div>
        <StatusPill status={it.status} />
      </div>
      <div className="mt-3">
        <p className="text-sm font-semibold text-slate-900">{it.name}</p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{it.description}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100">
        {soon ? (
          <span className="text-xs font-medium text-slate-300">Em breve</span>
        ) : clickable ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700">
            {it.status === "connected" ? "Gerenciar" : "Configurar"}
            <ChevronRight className="size-3.5" />
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-400">Gestão em breve</span>
        )}
      </div>
    </>
  )

  const cardClass =
    "block rounded-xl border bg-white p-5 transition-shadow " +
    (soon
      ? "border-slate-200 opacity-70 cursor-default"
      : "border-slate-200 shadow-card hover:shadow-soft hover:border-slate-300")

  if (clickable) return (
    <Link href={it.href!} className={cardClass}>
      {inner}
    </Link>
  )
  return <div className={cardClass}>{inner}</div>
}
