import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { checkLimit } from "@/lib/limits"
import { PageShell } from "@/components/ui/page-shell"
import { EmptyState } from "@/components/ui/empty-state"
import { AddNumberMenu } from "@/components/integrations/add-number-menu"
import { NumberCard, type NumberCardData } from "@/components/integrations/number-card"
import { Smartphone, ArrowLeft, BadgeCheck, QrCode } from "lucide-react"

export const dynamic = "force-dynamic"

const CONNECTED = new Set(["connected", "open"])

export default async function WhatsappNumbersPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  const tenantId = session.user.tenantId

  const [{ data: instances }, { data: tenantRow }, modules, officialLimit, qrLimit] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_instances")
      .select("id, provider, display_name, instance_name, phone_number, status, account_status")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("tenants").select("hide_qr_channel").eq("id", tenantId).maybeSingle(),
    getEnabledModuleSlugs(tenantId),
    checkLimit(tenantId, "whatsapp_official"),
    checkLimit(tenantId, "whatsapp_qr"),
  ])

  const list     = (instances ?? []) as NumberCardData[]
  const official = list.filter((i) => i.provider === "meta_cloud")
  const baileys  = list.filter((i) => i.provider !== "meta_cloud")
  const hideQr   = (tenantRow as { hide_qr_channel?: boolean } | null)?.hide_qr_channel ?? false
  // Estado por tipo: canal habilitado + limite do plano (gate de verdade é server-side).
  const fmtUsage = (l: { used: number; max: number | null }) => `${l.used}/${l.max ?? "∞"}`
  const officialState = { enabled: modules.has("whatsapp_official") || official.length > 0, atLimit: !officialLimit.ok, usage: fmtUsage(officialLimit) }
  const qrState       = { enabled: !hideQr, atLimit: !qrLimit.ok, usage: fmtUsage(qrLimit) }
  const connectedCount = list.filter((i) => CONNECTED.has(i.status ?? "")).length

  return (
    <PageShell
      title="Números de WhatsApp"
      description="Gerencie os números conectados à Kora — oficiais e via QR."
      icon={Smartphone}
      actions={list.length > 0 ? <AddNumberMenu official={officialState} qr={qrState} /> : undefined}
    >
      <div className="space-y-6 max-w-3xl">
        <Link href="/integracoes" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="size-3.5" /> Voltar para Integrações
        </Link>

        {list.length === 0 ? (
          <EmptyState
            icon={Smartphone}
            title="Nenhum número conectado"
            description="Conecte seu primeiro número de WhatsApp pra começar a atender — oficial pela Meta ou via QR Code."
            action={<AddNumberMenu official={officialState} qr={qrState} />}
          />
        ) : (
          <>
            <p className="text-xs text-slate-400">
              {list.length} {list.length === 1 ? "número" : "números"} · {connectedCount} conectado{connectedCount === 1 ? "" : "s"}
            </p>

            {official.length > 0 && (
              <section>
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                  <BadgeCheck className="size-3.5" /> Oficial (Meta Cloud)
                  <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">· {fmtUsage(officialLimit)}</span>
                </h2>
                <div className="space-y-2.5">
                  {official.map((i) => <NumberCard key={i.id} data={i} />)}
                </div>
              </section>
            )}

            {baileys.length > 0 && (
              <section>
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                  <QrCode className="size-3.5" /> QR (Baileys)
                  <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">· {fmtUsage(qrLimit)}</span>
                </h2>
                <div className="space-y-2.5">
                  {baileys.map((i) => <NumberCard key={i.id} data={i} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PageShell>
  )
}
