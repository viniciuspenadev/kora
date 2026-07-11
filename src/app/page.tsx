import { auth } from "@/auth"
import { redirect } from "next/navigation"

export default async function HomePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (session.user.isPlatformAdmin) redirect("/admin")
  redirect("/inbox")
}
