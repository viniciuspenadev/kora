import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { AdminShell } from "@/components/admin/admin-shell"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const { data: admin } = await supabaseAdmin
    .from("platform_admins")
    .select("id")
    .eq("user_id", session.user.id)
    .single()

  if (!admin) redirect("/")

  return (
    <AdminShell userName={session.user.name ?? "Admin"} userEmail={session.user.email ?? ""}>
      {children}
    </AdminShell>
  )
}
