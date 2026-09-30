import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Globe } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { getWidgetConfig, getDetectedSiteDomains, type WidgetConfig } from "@/lib/actions/site-widget"
import { SiteWidgetClient } from "./client"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { ModuloNaoIncluido } from "@/components/app/modulo-nao-incluido"

export default async function ConfigSitePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // 🔴 GATE DE MÓDULO QUE NÃO EXISTIA (achado do dono, 06/08/2026). Esta página só checava
  //    PAPEL. O card de Integrações dizia "Em breve" para quem não tem `widget_site`, mas o
  //    botão continuava navegando — e por outro caminho ainda: Relatórios → seção do site →
  //    "Configurar widget" → configuração aberta e editável, de um canal que o plano não
  //    inclui. Menu fechado, porta destrancada.
  // ⚠️ Renderiza em vez de redirecionar: gate que redireciona já criou três laços neste
  //    projeto em um dia. Tela estática não navega.
  const modules = await getEnabledModuleSlugs(session.user.tenantId)
  if (!modules.has("widget_site")) {
    return (
      <ModuloNaoIncluido
        titulo="Widget do site"
        descricao="Um chat no seu site que vira conversa aqui dentro — o visitante manda a primeira mensagem e o atendimento continua no mesmo lugar dos outros canais."
      />
    )
  }

  const [cfg, detectedDomains] = await Promise.all([
    getWidgetConfig(),
    getDetectedSiteDomains(),
  ])
  const tenantId = session.user.tenantId

  // Tenant slug pra montar o snippet
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .single()

  const [{ data: depts }, { data: tags }] = await Promise.all([
    supabaseAdmin
      .from("tenant_departments")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabaseAdmin
      .from("tags")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .order("name"),
  ])

  const initialConfig: WidgetConfig = cfg ?? {
    enabled:               true,
    mode:                  "form",
    chat_suggestions:      ["Quero saber preços", "Falar com vendas", "Tirar uma dúvida"],
    allowed_domains:       [],
    button_color:          "#004add",
    button_position:       "bottom-right",
    button_label:          "Falar conosco",
    greeting:              "Oi! Como posso te ajudar?",
    questions: [
      { id: "intent", label: "Como posso te ajudar?", type: "longtext", required: true },
      { id: "name",   label: "Qual seu nome?",        type: "text",     required: true },
      { id: "phone",  label: "Qual seu WhatsApp?",    type: "phone",    required: true },
    ],
    success_message:       "Pronto! Em alguns minutos vamos te chamar no WhatsApp 🎉",
    default_department_id: null,
    default_tag_id:        null,
    show_after_seconds:    0,
    hide_url_patterns:     [],
    off_hours_enabled:     false,
    off_hours_message:     null,
    logo_url:              null,
    brand_name:            null,
    subtitle:              "Respondemos em alguns minutos",
    privacy_policy_url:    null,
    consent_text:          "Concordo com a {politica_privacidade} e com o tratamento dos meus dados para contato.",
    dpo_email:             null,
  }

  return (
    <PageShell
      title="Widget do site"
      description="Capture leads pelo site. Visitante preenche o formulário, conversa cai aqui no inbox pronta pra você responder via WhatsApp."
      icon={Globe}
    >
      <SiteWidgetClient
        initial={initialConfig}
        tenantSlug={tenant?.slug ?? ""}
        departments={depts ?? []}
        tags={tags ?? []}
        detectedDomains={detectedDomains}
        appUrl={(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")}
      />
    </PageShell>
  )
}
