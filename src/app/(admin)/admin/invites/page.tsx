import { supabaseAdmin } from "@/lib/supabase"
import { InviteForm, CopyInviteLink, DeleteInviteButton } from "@/components/admin/invite-controls"
import { Mail, CheckCircle2 } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"

const DATE = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Atendente",
}

interface InviteRow {
  id:           string
  tenant_id:    string
  email:        string
  role:         string
  token:        string
  expires_at:   string
  accepted_at:  string | null
  created_at:   string
  tenants:      { name: string } | null
}

export default async function InvitesPage() {
  const [{ data: invites }, { data: tenants }] = await Promise.all([
    supabaseAdmin
      .from("invites")
      .select("id, tenant_id, email, role, token, expires_at, accepted_at, created_at, tenants(name)")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("tenants")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ])

  const all      = (invites ?? []) as unknown as InviteRow[]
  const pending  = all.filter((i) => !i.accepted_at)
  const accepted = all.filter((i) =>  i.accepted_at)

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Convites</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {pending.length} {pending.length === 1 ? "pendente" : "pendentes"} · {accepted.length} {accepted.length === 1 ? "aceito" : "aceitos"}
        </p>
      </div>

      <div className="px-6 py-6 space-y-6">
        <InviteForm tenants={tenants ?? []} />

        <SectionCard
          title="Pendentes"
          description="Aguardando o destinatário aceitar o convite."
          flush
        >
          {pending.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="Nenhum convite pendente"
              description="Todos os convites foram aceitos ou ainda não há nenhum gerado."
              bordered={false}
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {pending.map((i) => (
                <div key={i.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                    <Mail className="size-4 text-amber-700" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{i.email}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      <span className="text-slate-700 font-medium">{i.tenants?.name ?? "—"}</span>
                      <span className="text-slate-300"> · </span>
                      {ROLE_LABELS[i.role] ?? i.role}
                      <span className="text-slate-300"> · </span>
                      <span className="tabular-nums">expira em {DATE(i.expires_at)}</span>
                    </p>
                  </div>
                  <StatusDot tone="warning" size="sm" />
                  <CopyInviteLink token={i.token} />
                  <DeleteInviteButton inviteId={i.id} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {accepted.length > 0 && (
          <SectionCard title="Aceitos" flush>
            <div className="divide-y divide-slate-100">
              {accepted.map((i) => (
                <div key={i.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="size-4 text-emerald-700" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{i.email}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      <span className="text-slate-700 font-medium">{i.tenants?.name ?? "—"}</span>
                      <span className="text-slate-300"> · </span>
                      {ROLE_LABELS[i.role] ?? i.role}
                      <span className="text-slate-300"> · </span>
                      <span className="tabular-nums">aceito em {DATE(i.accepted_at!)}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  )
}
