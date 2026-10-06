import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getSignupTrialPlan } from "@/lib/plans"
import { SignupClient } from "@/components/signup/signup-client"

export const metadata: Metadata = {
  title: "Criar conta grátis · Kora",
  // ⚠️ Sem número aqui de propósito: metadata é estática e viraria a próxima mentira.
  //    A duração real aparece na tela, lida do plano.
  description: "Teste o Kora sem cartão de crédito.",
}

export default async function SignupPage() {
  const session = await auth()
  if (session) redirect("/")

  // 🔴 A DURAÇÃO VEM DO PLANO, NÃO DE UM LITERAL NA TELA. Até 2026-08-04 o formulário
  //    dizia "3 dias de teste" enquanto o plano Trial dava **5** — o número foi escrito à
  //    mão uma vez e o plano mudou depois, que é como toda promessa fixa em tela envelhece.
  //    Prometer menos do que se entrega parece inofensivo, mas é a primeira frase que a
  //    pessoa lê sobre a Kora; se ela não confere com o que acontece, o resto do cadastro
  //    passa a ser lido com desconfiança.
  // 🔑 `getSignupTrialPlan` é o MESMO helper que o `startSignup` usa pra ATRIBUIR o plano.
  //    Não é "o mesmo critério copiado" — é a mesma função: o que a tela anuncia e o que a
  //    conta recebe não têm como divergir. Quem manda no número é o god mode.
  const plan = await getSignupTrialPlan()

  return <SignupClient trialDays={plan?.trial_days ?? null} />
}
