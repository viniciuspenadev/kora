import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getMyProfile } from "@/lib/actions/profile"
import { ProfileClient } from "./client"

export const dynamic = "force-dynamic"

const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietário", admin: "Administrador", agent: "Atendente",
}

export default async function PerfilPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")
  const userId = session.user.id

  // Resumo de segurança da conta. Tudo do PRÓPRIO usuário (`user_id`/`id` da sessão) —
  // esta tela nunca mostra dado de terceiro, então não há o que filtrar por tenant além
  // disso.
  const [profile, { data: prof }, { data: sessions }] = await Promise.all([
    getMyProfile(),
    supabaseAdmin.from("profiles").select("password_changed_at").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_sessions")
      .select("sid, last_seen_at, user_agent, device_id")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false }),
  ])

  const rows = sessions ?? []
  // Dispositivos ≠ sessões: o mesmo aparelho pode ter mais de uma sessão (aba nova,
  // extensão). Contar sessão como "dispositivo" inflaria o número e assustaria à toa.
  const deviceIds = new Set(rows.map((s) => (s.device_id as string | null) ?? `sid:${s.sid}`))

  return (
    <ProfileClient
      profile={profile}
      role={ROLE_LABEL[session.user.role] ?? session.user.role}
      security={{
        passwordChangedAt: (prof?.password_changed_at as string | null) ?? null,
        deviceCount:       deviceIds.size,
        // A sessão ATUAL é a mais recente do próprio usuário — `last_seen_at` é
        // atualizado a cada request autenticado.
        currentAgent:      (rows[0]?.user_agent as string | null) ?? null,
        lastSeenAt:        (rows[0]?.last_seen_at as string | null) ?? null,
      }}
    />
  )
}
