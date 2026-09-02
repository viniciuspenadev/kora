import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { asaas, AsaasError } from "./client"

// ═══════════════════════════════════════════════════════════════
// Tenant do Kora → customer do Asaas
// ═══════════════════════════════════════════════════════════════
// docs/asaas-billing-design.md §4
//
// O mapeamento é quase 1:1 com `tenant_billing_profile`, que **já existe e já é preenchido
// no cadastro** (`signup.ts` inclusive usa o `tax_id` como anti-duplicata). Ou seja: o dado
// nasce no signup, não precisa de backfill.

export interface AsaasCustomer {
  id: string
  name: string
  cpfCnpj: string
  email: string | null
  externalReference: string | null
}

interface BillingProfileRow {
  legal_name: string | null
  trade_name: string | null
  tax_id: string | null
  billing_email: string | null
  phone: string | null
  zip: string | null
  street: string | null
  number: string | null
  complement: string | null
  district: string | null
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "")

/**
 * Garante que o tenant tem um `customer` no Asaas e devolve o id.
 *
 * 🔑 `externalReference = tenant_id` é o que amarra os dois mundos, e não é conveniência:
 *    é o **filtro de tenancy do webhook**. Um webhook do Asaas entrega TODOS os eventos da
 *    conta — inclusive de outro produto que compartilhe a mesma conta (medido no sandbox:
 *    já há um webhook de outro sistema apontando pra outro projeto). Sem este carimbo, não
 *    há como saber se um pagamento é nosso, e o Kora daria baixa em fatura alheia.
 *
 * ⚠️ Idempotente por construção: se `asaas_customer_id` já está gravado, só devolve. A
 *    criação duplicada no Asaas geraria dois customers pro mesmo CNPJ e a reconciliação
 *    passaria a depender de adivinhar qual é o certo.
 */
export async function ensureAsaasCustomer(tenantId: string): Promise<{ id: string } | { error: string }> {
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from("tenants")
    .select("id, name, asaas_customer_id, billing_mode")
    .eq("id", tenantId)
    .maybeSingle()

  // ⚠️ Fail-closed: sem confirmar o tenant, não cria nada no gateway. Criar customer
  //    "no escuro" produziria lixo no Asaas que ninguém sabe a quem pertence.
  if (tErr) return { error: "Não foi possível ler o cliente." }
  if (!tenant) return { error: "Cliente não encontrado." }
  if ((tenant as { billing_mode?: string | null }).billing_mode !== "gateway") {
    return { error: "Este cliente está em cobrança manual." }
  }

  const existing = (tenant as { asaas_customer_id?: string | null }).asaas_customer_id
  if (existing) return { id: existing }

  const { data: perfil } = await supabaseAdmin
    .from("tenant_billing_profile")
    .select("legal_name, trade_name, tax_id, billing_email, phone, zip, street, number, complement, district")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  const p = (perfil ?? {}) as BillingProfileRow
  const cpfCnpj = digits(p.tax_id)

  // 🔴 CPF/CNPJ é OBRIGATÓRIO no Asaas. Falhar aqui com mensagem clara é melhor que
  //    mandar vazio e receber um erro genérico do gateway — o dono precisa saber que o
  //    bloqueio é cadastro, não integração.
  if (!cpfCnpj) return { error: "Cadastre o CPF/CNPJ do cliente antes de ativar a cobrança." }

  const nome = p.legal_name?.trim() || p.trade_name?.trim() || (tenant as { name: string }).name
  if (!nome) return { error: "Cadastre a razão social do cliente antes de ativar a cobrança." }

  try {
    const created = await asaas.post<AsaasCustomer>("/customers", {
      name:              nome,
      cpfCnpj,
      email:             p.billing_email || undefined,
      mobilePhone:       digits(p.phone) || undefined,
      postalCode:        digits(p.zip) || undefined,
      address:           p.street || undefined,
      addressNumber:     p.number || undefined,
      complement:        p.complement || undefined,
      province:          p.district || undefined,   // "province" no Asaas = bairro
      externalReference: tenantId,                  // 🔑 ver o comentário do topo
      notificationDisabled: true,                   // quem avisa o cliente é a Kora, não o gateway
    })

    const { data: vinculado, error: upErr } = await supabaseAdmin
      .from("tenants")
      .update({ asaas_customer_id: created.id })
      .eq("id", tenantId)
      .eq("billing_mode", "gateway")
      .is("asaas_customer_id", null)
      .select("id")

    // ⚠️ Criado no Asaas mas não gravado aqui = órfão que vira duplicata na próxima
    //    tentativa. Devolve erro explícito com o id, pra recuperação manual ser possível.
    if (upErr || !vinculado || vinculado.length === 0) {
      console.error("[asaas] customer criado mas NÃO gravado:", tenantId, created.id,
        upErr?.message ?? "estado do tenant mudou durante a criação")
      return { error: `Cliente criado no gateway (${created.id}) mas não vinculado. Contate o suporte.` }
    }

    return { id: created.id }
  } catch (e) {
    const msg = e instanceof AsaasError ? e.message : "Falha ao criar o cliente no gateway."
    return { error: msg }
  }
}

/**
 * Reenvia ao Asaas o cadastro atual do tenant.
 *
 * 🔑 POR QUE EXISTE. `ensureAsaasCustomer` copia o cadastro **uma vez**, na criação. Se o
 *    cliente corrigir o endereço ou o e-mail depois (em /configuracoes/empresa), o gateway
 *    continuaria com o dado velho — e é o dado do gateway que vai no recibo, na régua de
 *    cobrança e na análise antifraude do cartão. Endereço divergente do titular é uma das
 *    causas clássicas de recusa: o cliente corrige no Kora, acha que resolveu, e o cartão
 *    segue sendo negado por um dado que só nós enxergamos.
 *
 * ⚠️ Silencioso quando não há o que sincronizar: cliente sem `asaas_customer_id` (cobrança
 *    manual, ou que nunca chegou a pagar) devolve `ok` sem chamar o gateway. Não é erro —
 *    é o caso normal da maioria.
 *
 * ⚠️ NUNCA muda `externalReference`. É o carimbo de tenancy que o webhook usa pra saber
 *    de quem é o pagamento; reescrevê-lo por engano faria a Kora dar baixa em fatura alheia.
 */
export async function syncAsaasCustomer(tenantId: string): Promise<{ ok: true } | { error: string }> {
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from("tenants")
    .select("asaas_customer_id, billing_mode")
    .eq("id", tenantId)
    .maybeSingle()

  if (tErr) return { error: "Não foi possível ler o cliente." }

  if ((tenant as { billing_mode?: string | null } | null)?.billing_mode !== "gateway") {
    return { ok: true }
  }

  const customerId = (tenant as { asaas_customer_id?: string | null } | null)?.asaas_customer_id
  if (!customerId) return { ok: true }   // nada no gateway ainda — nada a espelhar

  const { data: perfil } = await supabaseAdmin
    .from("tenant_billing_profile")
    .select("legal_name, trade_name, tax_id, billing_email, phone, zip, street, number, complement, district")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  const p = (perfil ?? {}) as BillingProfileRow
  const cpfCnpj = digits(p.tax_id)
  const nome    = p.legal_name?.trim() || p.trade_name?.trim() || ""

  // Fail-closed: sem os dois obrigatórios, não manda nada. Um PUT com `name` vazio
  // apagaria o nome que já está correto lá.
  if (!cpfCnpj || !nome) return { error: "Cadastro incompleto para sincronizar." }

  try {
    await asaas.put(`/customers/${customerId}`, {
      name:          nome,
      cpfCnpj,
      email:         p.billing_email || undefined,
      mobilePhone:   digits(p.phone) || undefined,
      postalCode:    digits(p.zip) || undefined,
      address:       p.street || undefined,
      addressNumber: p.number || undefined,
      complement:    p.complement || undefined,
      province:      p.district || undefined,
    })
    return { ok: true }
  } catch (e) {
    // ⚠️ Só a mensagem — o payload tem CPF/CNPJ e endereço (PII).
    const msg = e instanceof AsaasError ? e.message : "Falha ao sincronizar o cliente no gateway."
    console.error(JSON.stringify({ src: "asaas", kind: "sync-customer-falhou", tenant: tenantId, msg }))
    return { error: msg }
  }
}
