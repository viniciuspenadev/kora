import { getMyProfile } from "@/lib/actions/profile"
import { ProfileClient } from "./client"

export const dynamic = "force-dynamic"

export default async function PerfilPage() {
  const profile = await getMyProfile()
  return <ProfileClient profile={profile} />
}
