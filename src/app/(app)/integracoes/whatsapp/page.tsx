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
  // 🔴 O QR NÃO CHECAVA MÓDULO (achado do dono, 06/08). `enabled` olhava só a flag
  //    `hide_qr_channel` do tenant — então "Adicionar número por QR Code" era oferecido a
  //    quem não tem `multi_instance` no plano, e o card de Integrações convidava a
  //    conectar. Medido: o Trial não inclui NENHUM módulo de WhatsApp, e a tela oferecia
  //    os dois caminhos assim mesmo.
  // ⚠️ `|| qr.length > 0` pelo mesmo motivo do canal oficial logo acima: quem já tem número
  //    conectado (de antes do módulo existir, ou de um plano anterior) continua gerenciando
  //    o que é dele. O gate fecha a porta de ENTRADA, não tranca ninguém do lado de fora.
  // 🔴 O FALLBACK PRECISA SER "CONECTADO", NÃO "EXISTE LINHA" (06/08). A 1ª versão usava
  //    `qr.length > 0` pra preservar quem já tinha número de antes do módulo existir — só
  //    que o **signup auto-provisiona uma instância pra toda conta nova**
  //    (`signup.ts` → `autoProvisionWhatsApp`). Ou seja: a condição era verdadeira desde o
  //    primeiro segundo de vida do tenant e o gate de módulo **nunca mordia**. Medido no
  //    tenant recém-criado: instância `disconnected`, sem número, e o canal aparecia livre.
  // 🔑 Instância que nunca pareou é placeholder, não patrimônio. O fallback protege quem
  //    tem um número FUNCIONANDO — esse sim não pode ser trancado por troca de plano.
  const qrConectados = list.filter((i) => i.provider !== "meta_cloud" && CONNECTED.has(i.status ?? ""))
  const qrState       = { enabled: !hideQr && (modules.has("multi_instance") || qrConectados.length > 0), atLimit: !qrLimit.ok, usage: fmtUsage(qrLimit) }
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
