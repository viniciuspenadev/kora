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
    .select("id, name, asaas_customer_id")
    .eq("id", tenantId)
    .maybeSingle()

  // ⚠️ Fail-closed: sem confirmar o tenant, não cria nada no gateway. Criar customer
  //    "no escuro" produziria lixo no Asaas que ninguém sabe a quem pertence.
  if (tErr) return { error: "Não foi possível ler o cliente." }
  if (!tenant) return { error: "Cliente não encontrado." }

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

    const { error: upErr } = await supabaseAdmin
      .from("tenants").update({ asaas_customer_id: created.id }).eq("id", tenantId)

    // ⚠️ Criado no Asaas mas não gravado aqui = órfão que vira duplicata na próxima
    //    tentativa. Devolve erro explícito com o id, pra recuperação manual ser possível.
    if (upErr) {
      console.error("[asaas] customer criado mas NÃO gravado:", tenantId, created.id, upErr.message)
      return { error: `Cliente criado no gateway (${created.id}) mas não vinculado. Contate o suporte.` }
    }

    return { id: created.id }
  } catch (e) {
    const msg = e instanceof AsaasError ? e.message : "Falha ao criar o cliente no gateway."
    return { error: msg }
  }
}
