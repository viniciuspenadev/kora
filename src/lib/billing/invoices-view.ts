import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Faturas na visão do CLIENTE (o tenant que assina a Kora)
// ═══════════════════════════════════════════════════════════════
// 🔴 TODA query aqui filtra `tenant_id`. Não é zelo — é a diferença entre uma tela de
//    faturas e um IDOR: sem o filtro, trocar o id na URL mostraria a fatura de OUTRO
//    cliente, com valor, CNPJ e itens. É o mesmo padrão B do database-rules §2
//    (buscar → validar → devolver), e o designer da tela já tinha deixado o aviso.

export type FaturaStatusView = "open" | "overdue" | "paid" | "void"

export interface FaturaResumoView {
  id: string
  referencia: string
  vencimento: string
  status: FaturaStatusView
  totalCents: number
  pagoEm: string | null
}

export interface FaturaLinhaView {
  key: string
  kind: "plan" | "overage" | "addon" | "discount"
  titulo: string
  detalhe?: string
  qtd: number
  unitCents: number
  totalCents: number
}

export interface FaturaDetalheView extends FaturaResumoView {
  periodoInicio: string
  periodoFim: string
  linhas: FaturaLinhaView[]
  formaPagamento: string | null
  /** Vazio até o gateway existir — a tela decide o que mostrar sem Pix. */
  pixCopiaECola: string
}

const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"]

/** "Agosto/2026" — como o cliente chama a fatura, não como o banco guarda. */
function referenciaDe(periodStart: string | null, fallback: string): string {
  const d = new Date(periodStart ?? fallback)
  if (Number.isNaN(d.getTime())) return "—"
  const m = MES[d.getUTCMonth()] ?? ""
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}/${d.getUTCFullYear()}`
}

/**
 * 🔴 DERIVA o status de exibição — nunca copia `invoices.status`.
 *    "overdue" NÃO existe no banco (o motor grava só open/paid/void). Copiar a coluna
 *    faria a tela dizer "Em aberto" numa fatura vencida há 40 dias, e o cliente concluiria
 *    que está tudo bem. O atraso se mede por `due_date`, igual ao `standing.ts`.
 */
function statusDe(status: string | null, dueDate: string | null): FaturaStatusView {
  if (status === "paid") return "paid"
  if (status === "void") return "void"
  // ⚠️ `partial` (nasceu 08/08) NÃO ganha estado próprio aqui, e a omissão é deliberada:
  //    ele cai em `open`/`overdue` pela data, que é a verdade que importa pro cliente —
  //    **ainda falta pagar**, e a urgência é a mesma. Um 5º estado na tela exigiria a UI
  //    saber exibir "recebido X de Y", que não existe; enquanto não existir, inventar o
  //    rótulo mostraria uma palavra nova sem o número que a explica.
  // 🔑 O que NÃO pode acontecer é `partial` virar "paga" ou sumir da lista — e não vira:
  //    o `standing.ts` já o conta como em aberto, e este mapa o trata como devido.
  if (dueDate) {
    const venc = new Date(`${dueDate}T23:59:59Z`).getTime()
    if (Number.isFinite(venc) && venc < Date.now()) return "overdue"
  }
  return "open"
}

export async function listInvoicesForTenant(tenantId: string, limit = 24): Promise<FaturaResumoView[]> {
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("id, status, period_start, due_date, total_cents, paid_at, created_at")
    .eq("tenant_id", tenantId)                       // 🔒 escopo — ver cabeçalho
    .order("due_date", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) { console.error("[invoices-view] lista falhou:", tenantId, error.message); return [] }

  return (data ?? []).map((r) => {
    const row = r as { id: string; status: string | null; period_start: string | null; due_date: string | null; total_cents: number | null; paid_at: string | null; created_at: string }
    return {
      id:         row.id,
      referencia: referenciaDe(row.period_start, row.created_at),
      vencimento: row.due_date ?? "",
      status:     statusDe(row.status, row.due_date),
      totalCents: row.total_cents ?? 0,
      pagoEm:     row.paid_at,
    }
  })
}

/**
 * Uma fatura pelo id. **Devolve null se não for do tenant** — o filtro está na query, então
 * "não é sua" e "não existe" são indistinguíveis de fora. É de propósito: confirmar que um
 * id existe já é informação.
 */
export async function getInvoiceForTenant(tenantId: string, invoiceId: string): Promise<FaturaDetalheView | null> {
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("id, status, period_start, period_end, due_date, total_cents, paid_at, paid_method, created_at, invoice_items ( id, kind, description, quantity, unit_price_cents, amount_cents )")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)                       // 🔒 sem isto, trocar o id na URL = IDOR
    .maybeSingle()

  if (error) { console.error("[invoices-view] detalhe falhou:", invoiceId, error.message); return null }
  if (!data) return null

  const row = data as {
    id: string; status: string | null; period_start: string | null; period_end: string | null
    due_date: string | null; total_cents: number | null; paid_at: string | null; paid_method: string | null
    created_at: string
    invoice_items: Array<{ id: string; kind: string | null; description: string | null; quantity: number | null; unit_price_cents: number | null; amount_cents: number | null }> | null
  }

  const kinds: Record<string, FaturaLinhaView["kind"]> = { plan: "plan", overage: "overage", addon: "addon", discount: "discount" }

  return {
    id:            row.id,
    referencia:    referenciaDe(row.period_start, row.created_at),
    periodoInicio: row.period_start ?? "",
    periodoFim:    row.period_end ?? "",
    vencimento:    row.due_date ?? "",
    status:        statusDe(row.status, row.due_date),
    totalCents:    row.total_cents ?? 0,
    pagoEm:        row.paid_at,
    formaPagamento: row.paid_method,
    pixCopiaECola: "",                               // sem gateway ainda — a tela trata vazio
    linhas: (row.invoice_items ?? []).map((it) => ({
      key:        it.id,
      kind:       kinds[it.kind ?? ""] ?? "addon",
      titulo:     it.description ?? "Item",
      qtd:        it.quantity ?? 1,
      unitCents:  it.unit_price_cents ?? 0,
      totalCents: it.amount_cents ?? 0,
    })),
  }
}
