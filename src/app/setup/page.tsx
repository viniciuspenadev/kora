import { supabaseAdmin } from "@/lib/supabase"
import { notFound } from "next/navigation"
import { SetupForm } from "./form"

export default async function SetupPage() {
  const { count } = await supabaseAdmin
    .from("platform_admins")
    .select("id", { count: "exact", head: true })

  if ((count ?? 0) > 0) notFound()

  return <SetupForm />
}
