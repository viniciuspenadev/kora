import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import {
  MetaCloudProvider,
  type MetaPhoneInfo, type MetaTemplate, type MetaBusinessProfile,
} from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { PageShell } from "@/components/ui/page-shell"
import { OfficialDashboard } from "@/components/integrations/official/official-dashboard"
import { EmbeddedSignupButton } from "@/components/integrations/official/embedded-signup-button"
import { BadgeCheck, ArrowLeft, Lock, ShieldAlert, AlertTriangle } from "lucide-react"

export const dynamic = "force-dynamic"

/** Banner de saúde — só aparece quando há problema (restrição/ban/review ou qualidade baixa). */
const CRITICAL_STATUS: Record<string, string> = {
  RESTRICTED:      "Número restrito pela Meta",
  BANNED:          "Conta desativada pela Meta",
  FLAGGED:         "Número sinalizado pela Meta",
  REVIEW_REJECTED: "Revisão da conta rejeitada",
}
function HealthBanner({ accountStatus, reason, quality }: { accountStatus: string | null; reason: string | null; quality: string | null }) {
  const critical = accountStatus ? CRITICAL_STATUS[accountStatus] : null
  if (critical) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
        <ShieldAlert className="size-5 text-red-600 shrink-0 mt-0.5" />
        <div className="text-sm text-red-800">
          <p className="font-semibold">{critical}.</p>
          <p className="mt-0.5 text-red-700">
            {reason ? <>Motivo: {reason}. </> : null}
            Seus envios podem estar limitados — revise mensagens e templates para regularizar o número.
          </p>
        </div>
      </div>
    )
  }
  if (quality === "RED" || quality === "YELLOW") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold">Qualidade do número {quality === "RED" ? "baixa" : "média"}.</p>
          <p className="mt-0.5 text-amber-700">Revise seus envios (evite conteúdo marcado como spam) para não perder limite de envio.</p>
        </div>
      </div>
    )
  }
  return null
}

export default async function WhatsappOficialPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [{ data: inst }, modules] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_instances")
      .select("meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret, status, account_status, health_reason")
      .eq("tenant_id", session.user.tenantId)
      .eq("provider", "meta_cloud")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    getEnabledModuleSlugs(session.user.tenantId),
  ])

  const hasModule = modules.has("whatsapp_official")
  const connected = !!(inst?.meta_phone_number_id && inst.meta_access_token)

  const backLink = (
    <Link href="/integracoes" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
      <ArrowLeft className="size-3.5" /> Voltar para Integrações
    </Link>
  )

  // ── Ainda não conectado → estado de conexão (Embedded Signup) ou "indisponível"
  if (!connected) {
    return (
      <PageShell
        title="WhatsApp API Oficial"
        description="Conecte seu número oficial do WhatsApp Business à Kora."
        icon={BadgeCheck}
      >
        <div className="space-y-5">
          {backLink}
          {hasModule ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 max-w-xl">
              <div className="size-11 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center mb-4">
                <BadgeCheck className="size-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Conectar seu WhatsApp Oficial</h2>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                Clique abaixo e conecte sua conta do WhatsApp Business em poucos passos, direto pela Meta —
                escolha (ou crie) a conta e o número. Suas credenciais ficam <strong>cifradas</strong> e
                a Kora passa a enviar e receber pelo número oficial.
              </p>
              <div className="mt-5">
                <EmbeddedSignupButton />
              </div>
              <p className="text-[11px] text-slate-400 mt-4">
                Você precisa ser administrador da conta do WhatsApp Business na Meta pra concluir.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 max-w-xl">
              <div className="size-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
                <Lock className="size-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">WhatsApp API Oficial não habilitado</h2>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                O canal oficial não está liberado para sua conta. Fale com o suporte da Kora para habilitar.
              </p>
            </div>
          )}
        </div>
      </PageShell>
    )
  }

  // ── Conectado → dashboard de gestão (token CIFRADO → decifra pra usar)
  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst!.meta_phone_number_id!,
    meta_business_account_id: inst!.meta_business_account_id ?? "",
    meta_access_token:        decryptSecret(inst!.meta_access_token),
    meta_app_secret:          decryptSecret(inst!.meta_app_secret) ?? "",
  })

  let phone: MetaPhoneInfo = {}
  let templates: MetaTemplate[] = []
  let profile: MetaBusinessProfile = {}
  let webhookOk = false
  let error: string | null = null
  try {
    const [p, t, pr, w] = await Promise.all([
      provider.getPhoneInfo(),
      provider.listTemplates(),
      provider.getBusinessProfile(),
      provider.isWebhookSubscribed(),
    ])
    phone = p; templates = t; profile = pr; webhookOk = w
  } catch (e) {
    error = (e as Error).message
  }

  return (
    <PageShell
      title="WhatsApp API Oficial"
      description="Central de gestão da sua linha oficial — status, templates, perfil e testes."
      icon={BadgeCheck}
    >
      <div className="space-y-5">
        {backLink}

        <HealthBanner
          accountStatus={inst!.account_status ?? null}
          reason={inst!.health_reason ?? null}
          quality={phone.quality_rating ?? null}
        />

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Não foi possível carregar todos os dados ao vivo da Meta: {error}
          </div>
        )}

        <OfficialDashboard
          phone={phone}
          templates={templates}
          profile={profile}
          status={inst!.status ?? null}
          wabaId={inst!.meta_business_account_id ?? null}
          webhookOk={webhookOk}
        />
      </div>
    </PageShell>
  )
}
