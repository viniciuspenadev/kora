import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { checkLimit } from "@/lib/limits"
import { Server } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { ConfigPageClient } from "./config-client"
import type { WhatsAppInstance } from "@/types/chat"

export const dynamic = "force-dynamic"

export default async function WhatsAppConfigPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // Tenant "só-oficial" (hide_qr_channel) não acessa a conexão QR/Baileys.
  const { data: tenantRow } = await supabaseAdmin
    .from("tenants")
    .select("hide_qr_channel")
    .eq("id", session.user.tenantId)
    .maybeSingle()
  if ((tenantRow as { hide_qr_channel?: boolean } | null)?.hide_qr_channel) redirect("/integracoes")

  // Multi-número: lista TODAS as instâncias Baileys; `?id=` escolhe qual gerenciar (default: 1ª).
  const [{ data: rows }, qrLimit] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("tenant_id", session.user.tenantId)
      .eq("provider", "baileys")
      .order("created_at", { ascending: true }),
    checkLimit(session.user.tenantId, "whatsapp_qr"),
  ])

  const instances = (rows ?? []) as WhatsAppInstance[]
  const sp = await searchParams
  const selected = (sp.id ? instances.find((i) => i.id === sp.id) : null) ?? instances[0] ?? null

  return (
    <PageShell
      title="WhatsApp"
      description="Conecte seus números via QR Code e veja o status em tempo real."
      icon={Server}
    >
      <ConfigPageClient
        instances={instances}
        instance={selected}
        qrUsage={`${qrLimit.used}/${qrLimit.max ?? "∞"}`}
        qrAtLimit={!qrLimit.ok}
      />
    </PageShell>
  )
}
