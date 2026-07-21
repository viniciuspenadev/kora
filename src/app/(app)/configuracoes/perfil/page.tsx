import { getMyProfile, listMySessions } from "@/lib/actions/profile"
import { ProfileClient } from "./client"

export const dynamic = "force-dynamic"

export default async function PerfilPage() {
  const [profile, sessions] = await Promise.all([getMyProfile(), listMySessions()])
  return <ProfileClient profile={profile} sessions={sessions} />
}
