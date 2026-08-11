import { supabaseAdmin } from "@/lib/supabase"
import { notFound } from "next/navigation"
import { CheckCircle2, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { AcceptInviteForm } from "./form"

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data: invite } = await supabaseAdmin
    .from("invites")
    .select(`
      id, tenant_id, email, role, expires_at, accepted_at, department_id,
      tenants ( name ),
      profiles!invites_invited_by_fkey ( full_name ),
      tenant_departments ( name, color )
    `)
    .eq("token", token)
    .maybeSingle()

  if (!invite) notFound()

  const inv = invite as unknown as {
    id: string; tenant_id: string; email: string; role: string
    expires_at: string; accepted_at: string | null; department_id: string | null
    tenants: { name: string } | null
    profiles: { full_name: string | null } | null
    tenant_departments: { name: string; color: string } | null
  }

  const tenantName     = inv.tenants?.name ?? ""
  const inviterName    = inv.profiles?.full_name ?? null
  const departmentName = inv.tenant_departments?.name ?? null

  if (inv.accepted_at) {
    return (
      <InviteShell>
        <div className="bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10 text-center">
          <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-emerald-50 border border-emerald-100 shadow-sm mb-6 relative">
            <div className="absolute inset-0 rounded-2xl bg-emerald-400/20 blur-md" />
            <CheckCircle2 className="size-7 text-emerald-600 relative z-10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Convite já aceito</h1>
          <p className="text-slate-500 text-sm mb-6">
            Este convite para <strong className="text-slate-700">{tenantName}</strong> já foi utilizado. Faça login pra continuar.
          </p>
          <Link
            href="/auth/signin"
            className="inline-block w-full h-11 leading-[44px] rounded-xl bg-primary hover:bg-primary-700 text-white font-medium text-sm shadow-md shadow-primary/20 transition-colors"
          >
            Ir para login
          </Link>
        </div>
      </InviteShell>
    )
  }

  if (new Date(inv.expires_at) < new Date()) {
    return (
      <InviteShell>
        <div className="bg-white/60 backdrop-blur-2xl border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)] rounded-3xl p-8 sm:p-10 text-center">
          <div className="inline-flex items-center justify-center size-14 rounded-2xl bg-amber-50 border border-amber-100 shadow-sm mb-6 relative">
            <div className="absolute inset-0 rounded-2xl bg-amber-400/20 blur-md" />
            <AlertTriangle className="size-7 text-amber-600 relative z-10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Convite expirado</h1>
          <p className="text-slate-500 text-sm">
            O convite para <strong className="text-slate-700">{tenantName}</strong> expirou. Peça um novo ao administrador.
          </p>
        </div>
      </InviteShell>
    )
  }

  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", inv.email)
    .maybeSingle()

  return (
    <InviteShell>
      <AcceptInviteForm
        token={token}
        email={inv.email}
        role={inv.role}
        tenantName={tenantName}
        inviterName={inviterName}
        departmentName={departmentName}
        isNewUser={!existingProfile}
      />
    </InviteShell>
  )
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden bg-slate-50 font-sans selection:bg-primary/20">
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-300/40 blur-[100px] animate-pulse duration-[10000ms]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-violet-300/40 blur-[100px] animate-pulse duration-[7000ms]" />
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] rounded-full bg-blue-300/30 blur-[100px]" />
      </div>
      <div className="relative z-10 w-full max-w-md px-6 py-12">{children}</div>
    </div>
  )
}
