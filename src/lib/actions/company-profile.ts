"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rate-limit"
import { normalizarPerfilFiscal, type EntradaFiscal } from "@/lib/billing/fiscal-profile"
import { podeCobrar } from "@/lib/billing/fiscal-profile"
import { syncAsaasCustomer } from "@/lib/asaas/customers"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"

// ═══════════════════════════════════════════════════════════════
// Cadastro da empresa — lado do CLIENTE (/configuracoes/empresa)
// ═══════════════════════════════════════════════════════════════
// A versão do god mode (`admin-company.ts`) recebe `tenantId` por parâmetro porque o
// operador da Kora escolhe de quem é o cadastro. Aqui **não existe esse parâmetro**: o
// tenant sai da sessão, sempre. Reaproveitar a action do god mode neste caminho abriria
// exatamente o furo C-01..C-04 (action pública que aceita tenant alheio).
//
// ⚠️ Este arquivo é `"use server"` — TODA função exportada é uma action pública chamável
//    por qualquer sessão. Por isso as duas se gateiam sozinhas e não há helper exportado.

export interface PerfilEmpresa {
  person_type:            string
  legal_name:             string
  trade_name:             string
  tax_id:                 string
  state_registration:     string
  municipal_registration: string
  billing_email:          string
  phone:                  string
  responsible_name:       string
  zip:                    string
  street:                 string
  number:                 string
  complement:             string
  district:               string
  city:                   string
  state:                  string
  /** Documento travado porque já existe assinatura ativa no gateway (ver abaixo). */
  documento_travado:      boolean
  /** Tem tudo que a cobrança exige? Alimenta o aviso da tela. */
  completo:               boolean
}

const VAZIO = ""

/** Lê o cadastro fiscal do tenant da sessão. `null` = sem permissão. */
export async function getMyCompanyProfile(): Promise<PerfilEmpresa | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  // Dado fiscal e de cobrança é assunto de dono — atendente não vê CNPJ nem endereço
  // de faturamento da empresa (mesmo recorte da tela de assinatura).
  if (!["owner", "admin"].includes(session.user.role)) return null

  const tenantId = session.user.tenantId

  const [{ data: perfil }, { data: tenant }] = await Promise.all([
    supabaseAdmin
      .from("tenant_billing_profile")
      .select("person_type, legal_name, trade_name, tax_id, state_registration, municipal_registration, billing_email, phone, responsible_name, zip, street, number, complement, district, city, state")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenants")
      .select("name, asaas_subscription_id")
      .eq("id", tenantId)
      .maybeSingle(),
  ])

  const p = (perfil ?? {}) as Record<string, string | null>
  const t = (tenant ?? {}) as { name?: string | null; asaas_subscription_id?: string | null }

  return {
    person_type:            p.person_type === "pf" ? "pf" : "pj",
    // ⚠️ Sem perfil ainda (cliente antigo) a tela abre com o nome do tenant no lugar da
    //    razão social — palpite editável, não invenção gravada. Melhor que campo vazio:
    //    quem abre reconhece a própria empresa e só confere.
    legal_name:             p.legal_name ?? t.name ?? VAZIO,
    trade_name:             p.trade_name ?? VAZIO,
    tax_id:                 p.tax_id ?? VAZIO,
    state_registration:     p.state_registration ?? VAZIO,
    municipal_registration: p.municipal_registration ?? VAZIO,
    billing_email:          p.billing_email ?? VAZIO,
    phone:                  p.phone ?? VAZIO,
    responsible_name:       p.responsible_name ?? VAZIO,
    zip:                    p.zip ?? VAZIO,
    street:                 p.street ?? VAZIO,
    number:                 p.number ?? VAZIO,
    complement:             p.complement ?? VAZIO,
    district:               p.district ?? VAZIO,
    city:                   p.city ?? VAZIO,
    state:                  p.state ?? VAZIO,
    // ⚠️ Só assinatura REAL trava o documento. Com a reserva do claim, travava o CPF/CNPJ
    //    de quem ainda nem tinha assinado — e sem documento corrigível não há como cobrar.
    documento_travado:      Boolean(assinaturaRealId(t.asaas_subscription_id)),
    // 🔑 FONTE ÚNICA (`podeCobrar`). Era a 6ª cópia da régua, e como as outras estava sem
    //    o telefone — dizia "completo" pra quem o checkout recusaria.
    // ⚠️ `legal_name` cai pro nome do tenant quando o perfil ainda não tem razão social,
    //    igual ao campo acima: é o mesmo valor que a tela mostra.
    completo: podeCobrar({ ...p, legal_name: p.legal_name ?? t.name }),
  }
}

/**
 * Salva o cadastro fiscal do tenant da sessão.
 *
 * 🔒 `tenantId` vem da SESSÃO. O `input` passa pela allow-list de
 *    `normalizarPerfilFiscal` — chave fora da lista (inclusive `tenant_id`) é descartada
 *    antes de chegar ao banco, e o `tenant_id` é carimbado DEPOIS do spread.
 */
export async function saveMyCompanyProfile(
  input: EntradaFiscal,
): Promise<{ error?: string; aviso?: string; ok?: boolean }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Sessão expirada. Entre novamente." }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Só o dono ou um administrador pode alterar o cadastro da empresa." }
  }
  const tenantId = session.user.tenantId

  // ⚠️ Cada save dispara uma chamada ao Asaas (`syncAsaasCustomer`). Sem teto, um cliente
  //    segurando o botão bate na cota da NOSSA conta no gateway — e quem sente é todo
  //    mundo, não só ele. 30/hora é folgado pra uso humano e barato pra nós.
  if (!rateLimit(`company:save:${tenantId}`, 30, 60 * 60_000).ok) {
    return { error: "Muitas alterações seguidas. Tente de novo em alguns minutos." }
  }

  // 1 · A regra — a MESMA do signup. `exigirCobranca` fica false: dá pra salvar um
  //     cadastro parcial e voltar depois. Quem cobra o resto é o gate do pagamento, e a
  //     tela mostra o que falta. Barrar o "salvar" faria a pessoa perder o que digitou.
  const r = normalizarPerfilFiscal(input, { exigirCobranca: false })
  if ("error" in r) return { error: r.error }
  const { valores, completo } = r

  // 2 · Documento já usado por OUTRO cliente.
  //
  // 🔴 O `signup` usa `tax_id` como chave anti-duplicata (`alreadyExists`). Sem esta
  //    checagem, alguém poderia contornar aquilo cadastrando com um CNPJ qualquer e
  //    trocando aqui depois — e passaríamos a ter dois tenants com o mesmo documento,
  //    dois customers no Asaas com o mesmo CNPJ, e nenhuma forma de saber qual é o certo
  //    na hora de reconciliar um pagamento.
  // ⚠️ `.limit(1)` antes do `maybeSingle()`: se o documento estiver duplicado em DUAS
  //    contas antigas, o `maybeSingle` sozinho devolveria ERRO (mais de uma linha) em vez
  //    de "achei colisão" — e a mensagem que a pessoa leria seria "tente de novo", pra
  //    sempre. Com o limite, duas colisões e uma têm o mesmo resultado: recusa clara.
  const { data: colisao, error: cErr } = await supabaseAdmin
    .from("tenant_billing_profile")
    .select("tenant_id")
    .eq("tax_id", valores.tax_id as string)
    .neq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle()
  // ⚠️ Fail-closed: se a checagem não pôde ser feita, não salva. Deixar passar "porque a
  //    consulta falhou" é exatamente como duplicata entra.
  if (cErr) return { error: "Não foi possível validar o documento agora. Tente de novo." }
  if (colisao) {
    return { error: "Este CPF/CNPJ já está cadastrado em outra conta. Fale com a gente pra resolver." }
  }

  // 3 · Documento travado com assinatura ativa.
  //
  // 🔴 Trocar o CPF/CNPJ aqui com assinatura rodando criaria DIVERGÊNCIA com o gateway:
  //    as cobranças seguiriam saindo no documento antigo (é ele que está no customer do
  //    Asaas e nos recibos já emitidos), enquanto o Kora mostraria o novo. Divergência de
  //    documento em cobrança é problema fiscal, não cosmético — e a correção certa
  //    envolve olhar o que já foi cobrado. Por isso passa por gente.
  const { data: atual } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id").eq("id", tenantId).maybeSingle()
  const temAssinatura = Boolean(assinaturaRealId((atual as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id))

  if (temAssinatura) {
    const { data: anterior } = await supabaseAdmin
      .from("tenant_billing_profile").select("tax_id").eq("tenant_id", tenantId).maybeSingle()
    const docAntigo = (anterior as { tax_id?: string | null } | null)?.tax_id ?? null
    if (docAntigo && docAntigo !== valores.tax_id) {
      return { error: "Com a assinatura ativa, o CPF/CNPJ só muda com a nossa equipe — as cobranças já emitidas usam o documento atual." }
    }
  }

  // 4 · Grava. `tenant_id` DEPOIS do spread: mesmo que algo escape da allow-list, o
  //    tenant da sessão vence (defesa em profundidade — §1/§2 de database-rules).
  const { error } = await supabaseAdmin
    .from("tenant_billing_profile")
    .upsert(
      { ...valores, tenant_id: tenantId, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    )
  if (error) return { error: "Não foi possível salvar. Tente novamente." }

  // 5 · Auditoria. Mudança de dado fiscal é das que se precisa saber QUEM fez.
  //     ⚠️ Sem o valor do documento no metadata — é PII e o audit_log não é lugar dela.
  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "company.profile_updated",
    targetType: "tenant_billing_profile",
    targetId:   tenantId,
    metadata:   { person_type: valores.person_type, completo },
  })

  revalidatePath("/configuracoes/empresa")
  revalidatePath("/configuracoes/assinatura/pagamento")

  // 6 · Espelha no gateway, se o cliente já existe lá.
  //
  // ⚠️ Best-effort DE PROPÓSITO: o dado já está salvo aqui: falhar a resposta agora faria
  //    a pessoa achar que perdeu o que digitou e reenviar. O gateway ficar um passo atrás
  //    é recuperável; a pessoa desistir do formulário não.
  const sync = await syncAsaasCustomer(tenantId)
  if ("error" in sync) {
    return { ok: true, aviso: "Salvo. A atualização no sistema de cobrança não completou agora — a gente reprocessa." }
  }

  return { ok: true }
}
