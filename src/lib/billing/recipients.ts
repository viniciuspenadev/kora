import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Quem recebe aviso de cobrança — UMA regra, um lugar
// ═══════════════════════════════════════════════════════════════
//
// 🔑 A REGRA, numa frase: **dinheiro vai pro titular e pro dono; produto vai pra quem
//    opera; atendente nunca recebe valor.**
//
//    Não é preciosismo — é a mesma linha que o resto do sistema já traça: a action de
//    standing zera `invoice` pra `agent`, o PDF da fatura exige owner/admin, e as telas de
//    assinatura redirecionam atendente. Se o e-mail não respeitasse isso, seria a porta
//    dos fundos de uma regra que as portas da frente já cumprem.
//
// 🔴 UNIÃO, NÃO ESCOLHA — e este ponto veio da realidade da base. O `billing_email` do
//    perfil fiscal costuma ser do CONTADOR (medido em produção: um perfil com e-mail de
//    contabilidade e razão social de pessoa física). O contador recebe e não decide; o
//    dono decide e não recebe. Mandar só pro primeiro é garantir que ninguém aja quando o
//    cartão falhar.
//
// ⚠️ Este módulo NÃO envia nada e NÃO decide se o aviso existe. Ele responde uma pergunta
//    só: pra quem. Misturar isso com o disparo faria a regra viajar junto com o conteúdo,
//    e aí cada novo aviso poderia inventar o próprio recorte.

/**
 * O recorte muda com a natureza do aviso — e a diferença é o VALOR no corpo.
 *
 * - `dinheiro`: recibo, cobrança vencida, cancelamento. Tem valor ⇒ titular + owners.
 * - `produto`:  o que parou / voltou a funcionar. Sem valor ⇒ owners + admins, porque é o
 *               admin que descobre no meio do expediente que as campanhas pararam.
 */
export type EscopoAviso = "dinheiro" | "produto"

export interface DestinatariosAviso {
  /** Endereços já normalizados, deduplicados e com teto aplicado. */
  emails: string[]
  /** Nome do tenant — usado no corpo do e-mail. */
  tenantName: string
  /**
   * `true` quando NÃO havia `billing_email` e caímos no dono.
   *
   * ⚠️ Não é erro, é o fail-open deliberado (ver abaixo) — mas quem chama pode querer
   *    registrar, porque cliente sem e-mail de faturamento é um cadastro pela metade.
   */
  usouFallback: boolean
}

/** Teto de destinatários por aviso. Time grande não vira lista de transmissão. */
const TETO = 5

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function resolveBillingRecipients(
  tenantId: string,
  escopo: EscopoAviso,
): Promise<DestinatariosAviso> {
  const papeis = escopo === "dinheiro" ? ["owner"] : ["owner", "admin"]

  const [{ data: tenant }, { data: perfil }, { data: membros }] = await Promise.all([
    supabaseAdmin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_billing_profile").select("billing_email").eq("tenant_id", tenantId).maybeSingle(),
    // 🔴 O EMBED NOMEADO É OBRIGATÓRIO. Sem `profiles!tenant_users_user_id_fkey`, o
    //    PostgREST não sabe qual FK usar, devolve 300 e a lista vem **VAZIA, sem erro** —
    //    o aviso simplesmente não sairia, sem nada no log. É uma armadilha conhecida deste
    //    projeto e está registrada na memória do time.
    supabaseAdmin
      .from("tenant_users")
      .select("role, active, profiles!tenant_users_user_id_fkey ( email )")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .in("role", papeis),
  ])

  const doPerfil = ((perfil as { billing_email?: string | null } | null)?.billing_email ?? "").trim().toLowerCase()

  const dosMembros = ((membros ?? []) as Array<{ profiles: { email?: string | null } | { email?: string | null }[] | null }>)
    .map((m) => (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles))
    .map((p) => (p?.email ?? "").trim().toLowerCase())
    .filter(Boolean)

  // ⚠️ `billing_email` inválido é DESCARTADO individualmente, nunca derruba os outros:
  //    um endereço com typo no cadastro não pode calar o aviso pro dono.
  const brutos = escopo === "dinheiro"
    ? [...(EMAIL_RE.test(doPerfil) ? [doPerfil] : []), ...dosMembros]
    : dosMembros

  // 🔑 FAIL-OPEN PRO DONO, e é o inverso do gate de gasto de propósito. Sem
  //    `billing_email` (medido: há tenant sem perfil nenhum), a escolha é entre não avisar
  //    ninguém e avisar quem a gente conhece pelo login. Não avisar é exatamente o dano
  //    que este trabalho veio consertar.
  // ⚠️ O que NUNCA acontece é fail-open pra endereço ADIVINHADO: só entram endereços já
  //    vinculados ao tenant. Nada vindo de payload de webhook.
  const usouFallback = escopo === "dinheiro" && !EMAIL_RE.test(doPerfil) && dosMembros.length > 0

  const emails = Array.from(new Set(brutos.filter((e) => EMAIL_RE.test(e)))).slice(0, TETO)

  return {
    emails,
    tenantName: ((tenant as { name?: string } | null)?.name ?? "sua conta"),
    usouFallback,
  }
}
