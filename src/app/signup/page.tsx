import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { SignupClient } from "@/components/signup/signup-client"

export const metadata: Metadata = {
  title: "Criar conta grátis · Kora",
  description: "Teste o Kora por 3 dias, sem cartão de crédito.",
}

export default async function SignupPage() {
  const session = await auth()
  if (session) redirect("/")
  return <SignupClient />
}
