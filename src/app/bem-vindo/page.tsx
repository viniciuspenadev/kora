import type { Metadata } from "next"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getMyCompanyProfile, type PerfilEmpresa } from "@/lib/actions/company-profile"
import { BemVindoWizard } from "./wizard"

// ═══════════════════════════════════════════════════════════════
// Wizard de boas-vindas — o cadastro completo, no 1º acesso
// ═══════════════════════════════════════════════════════════════
// 🔑 POR QUE AQUI E NÃO NO SIGNUP. As consultas de CNPJ e CEP (`/api/cnpj`, `/api/cep`)
//    exigem sessão — devolvem 401 sem login. Abri-las pro formulário público
//    transformaria o Kora num proxy grátis de consulta cadastral, com o nosso IP levando
//    o bloqueio da BrasilAPI. Aqui dentro há sessão: o autofill funciona, e o cadastro
//    completo sai em dois cliques em vez de doze campos digitados.
//
// 🔑 E é o momento certo comercialmente: a pessoa já é cliente. Pedir cadastro completo
//    ANTES de ela ver o produto é cobrar antes de entregar.
//
// ⚠️ FORA do grupo `(app)`: wizard não tem sidebar nem topbar. Menu aberto no meio de um
//    fluxo é convite pra sair no meio — e sair no meio de um cadastro é não voltar.
//    Como está fora daquele layout, a checagem de sessão é responsabilidade DESTA página.

export const metadata: Metadata = { title: "Bem-vindo · Kora" }
export const dynamic = "force-dynamic"

export default async function BemVindoPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Platform admin não tem tenant — vai pro painel dele, não pro login (que o devolveria
  // pra cá logado). O layout do app usa exatamente este destino.
  if (!session.user.tenantId) redirect("/admin")
  // Wizard é do dono da conta. Atendente que caísse aqui veria um formulário fiscal que
  // não é dele — e o gate real está nas actions, que recusam por papel.
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { editar } = await searchParams

  const [perfil, { data: row }] = await Promise.all([
    getMyCompanyProfile(),
    supabaseAdmin
      .from("tenants")
      .select("name, acquisition_source, acquisition_detail, business_segment, team_size, current_tool, onboarding_profile_at")
      .eq("id", session.user.tenantId)
      .maybeSingle(),
  ])

  const t = (row ?? {}) as Record<string, string | null>

  // Já concluiu → não repete sozinho. `?editar=1` permite voltar de propósito (o link do
  // checklist de setup usa isso), mas nunca por acidente de navegação.
  if (t.onboarding_profile_at && editar !== "1") redirect("/inbox")

  // 🔴 MINA DE LOOP DESARMADA. Aqui havia `if (!perfil) redirect("/inbox")`. Como o
  //    layout do `(app)` manda pra CÁ todo owner/admin sem carimbo de cadastro, qualquer
  //    saída pra `/inbox` nesse estado é um pingue-pongue infinito: layout → wizard →
  //    layout → wizard, e a pessoa não entra no produto.
  //    Hoje `getMyCompanyProfile` nunca devolve `null` depois dos gates acima — mas isso
  //    é uma garantia de OUTRO arquivo, e basta alguém adicionar lá um `return null` em
  //    caso de erro pra derrubar o login de todo mundo que ainda não se cadastrou.
  //    Formulário vazio é degradação; loop de redirect é a pessoa sem acesso nenhum.
  const inicial: PerfilEmpresa = perfil ?? {
    person_type: "pj", legal_name: t.name ?? "", trade_name: "", tax_id: "",
    state_registration: "", municipal_registration: "", billing_email: "", phone: "",
    responsible_name: "", zip: "", street: "", number: "", complement: "",
    district: "", city: "", state: "", documento_travado: false, completo: false,
  }

  return (
    <BemVindoWizard
      primeiroNome={(session.user.name ?? "").split(" ")[0] || ""}
      nomeTenant={t.name ?? ""}
      perfil={inicial}
      pesquisa={{
        acquisition_source: t.acquisition_source ?? "",
        acquisition_detail: t.acquisition_detail ?? "",
        business_segment:   t.business_segment ?? "",
        team_size:          t.team_size ?? "",
        current_tool:       t.current_tool ?? "",
      }}
      reeditando={editar === "1"}
    />
  )
}
