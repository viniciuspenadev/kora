import { supabaseAdmin } from "@/lib/supabase"
import { Users, Eye } from "lucide-react"

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", agent: "Atendente" }
const ROLE_BADGE: Record<string, string> = {
  owner: "bg-violet-50 text-violet-700 border-violet-200",
  admin: "bg-primary-50 text-primary-700 border-primary-200",
  agent: "bg-slate-50 text-slate-600 border-slate-200",
}

export default async function TenantUsersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: members } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id, role, active, view_all, profiles!tenant_users_user_id_fkey ( full_name, email )")
    .eq("tenant_id", id)
    .order("role")

  const rows = (members ?? []).map((m) => {
    const prof = (m as { profiles?: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null }).profiles
    const p = Array.isArray(prof) ? prof[0] : prof
    return {
      userId:   (m as { user_id: string }).user_id,
      role:     (m as { role: string }).role,
      active:   (m as { active: boolean }).active,
      viewAll:  (m as { view_all: boolean }).view_all,
      name:     p?.full_name ?? "—",
      email:    p?.email ?? "—",
    }
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Users className="size-4 text-primary-600" />
        <h2 className="text-sm font-bold text-slate-900">Equipe</h2>
        <span className="text-xs text-slate-400">· {rows.length} {rows.length === 1 ? "usuário" : "usuários"}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">Nenhum usuário neste tenant.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.userId} className="flex items-center gap-3 px-5 py-3">
              <div className="size-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-slate-500">{r.name[0]?.toUpperCase() ?? "?"}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{r.email}</p>
              </div>
              {r.viewAll && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500" title="Vê todas as conversas">
                  <Eye className="size-3" /> Supervisor
                </span>
              )}
              {!r.active && (
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 h-5 inline-flex items-center rounded-md">Inativo</span>
              )}
              <span className={`inline-flex h-5 items-center text-[10px] font-semibold px-2 rounded-md border ${ROLE_BADGE[r.role] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>
                {ROLE_LABEL[r.role] ?? r.role}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
