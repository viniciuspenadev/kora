import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { AdminShell } from "@/components/admin/admin-shell"
import { BootSplash } from "@/components/auth/boot-splash"
import { ENTERING_COOKIE, enteringFromCookie, greetingName } from "@/lib/auth/entering"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const { data: admin } = await supabaseAdmin
    .from("platform_admins")
    .select("id")
    .eq("user_id", session.user.id)
    .single()

  if (!admin) redirect("/")

  // Tela de entrada logo após o login — mesma do app (lib/auth/entering.ts); só depois dos gates acima.
  const entering = enteringFromCookie((await cookies()).get(ENTERING_COOKIE)?.value)
  return (
    <AdminShell userName={session.user.name ?? "Admin"} userEmail={session.user.email ?? ""}>
      {children}
      {entering && <BootSplash startedAt={entering.startedAt} initialIndex={entering.initialIndex} name={greetingName(session.user.name)} />}
    </AdminShell>
  )
}
