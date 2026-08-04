// ═══════════════════════════════════════════════════════════════
// Assinatura — contrato + tipos de tela
// ═══════════════════════════════════════════════════════════════
// DECISÃO: as telas de assinatura NÃO conhecem o banco. Elas recebem um
// "standing" (em que degrau da escada o cliente está) e listas já traduzidas
// pra LINGUAGEM DE RESULTADO. O motivo é político, não técnico: se a tela
// puder ler `tenant_modules`, alguém um dia vai escrever "ai_studio" na cara
// do cliente. O contrato força a tradução a acontecer antes.

// ── Contrato ───────────────────────────────────────────────────
// ✅ JUNÇÃO FEITA (2026-08-03). Era cópia temporária enquanto a camada de dados era
//    construída em paralelo; os dois contratos foram conferidos campo a campo antes da
//    troca. Reexport em vez de import direto nas telas: se o contrato mudar na origem, o
//    `tsc` reclama AQUI, num lugar só.
export type { BillingDegrau, BillingStanding } from "@/lib/billing/standing"

// ── Tipos de tela (view models) ────────────────────────────────
// TODO(dev): estes são os shapes que as telas consomem. A fonte real pode
// montá-los onde preferir; o importante é que a tela receba REAIS já
// calculados — ela nunca multiplica preço por quantidade.

/** Evidência: o cliente não deve precisar CONFIAR na conta, deve poder CONFERIR. */
export interface Evidencia {
  /** Quem/o quê gerou a linha ("Marcos Vieira", "14 de agosto"). */
  quem:     string
  /** Quando entrou ("12/08"). */
  quando?:  string
  /** Detalhe numérico ("312 respostas"). */
  detalhe?: string
}

/**
 * Linha que PODE virar dinheiro (usuários, disparos, IA).
 * Só estas ganham destaque na tela de Consumo — ver comentário do consumo-client.
 */
export interface LinhaMedida {
  key:            string
  /** Linguagem de resultado: "Usuários", "Disparos de campanha", "Inteligência artificial". */
  label:          string
  /** Singular da unidade: "usuário", "disparo", "resposta". */
  unidade:        string
  usado:          number
  /** null = ilimitado no plano. */
  cota:           number | null
  precoUnitCents: number
  /** Unidades além da cota que JÁ rodaram (serviço prestado). */
  excedente:      number
  excedenteCents: number
  /** Projeção até o fechamento, no ritmo atual. Responde "isso vai virar dinheiro?". */
  projecaoCents:  number
  /** ⛔ o recurso PAROU de funcionar. Só isto justifica vermelho. */
  parou?:         boolean
  evidencia?:     Evidencia[]
}

/** Linha que NÃO vira dinheiro (contatos, armazenamento, números). Discreta por decreto. */
export interface LinhaDiscreta {
  key:      string
  label:    string
  usado:    number
  cota:     number | null
  /** Texto já formatado ("1,8 GB de 20 GB") quando a unidade não é contável. */
  textoUso: string
  /** Quebra opcional (ex: armazenamento por origem). */
  detalhe?: { label: string; texto: string }[]
}

/** A linha da conta do mês — o "quanto vai dar" antes de fechar. */
export interface ContaDoMes {
  planoLabel: string
  planoCents: number
  extras:     { label: string; cents: number }[]
  totalCents: number
  fechaEm:    string | null
}

/**
 * Status da fatura **na visão da tela** — não é a coluna do banco.
 *
 * 🔴 `"overdue"` NÃO EXISTE em `invoices.status` (verificado 2026-08-03: o motor só grava
 *    `open`, `paid` e `void`; nenhum caminho do código escreve "overdue"). Ele é
 *    **derivado** de `due_date < hoje && status === "open"`.
 *    Quem ligar o dado real: **não copie `invoice.status` direto pra cá.** Mapeando às
 *    cegas, a tela mostraria "Em aberto" para uma fatura vencida há 40 dias e o cliente
 *    concluiria que está tudo bem — e o selo "Vencida" nunca apareceria pra ninguém.
 *    O `standing.ts` já mede o atraso por `due_date` pelo mesmo motivo.
 */
export type FaturaStatus = "open" | "overdue" | "paid" | "void"

export interface FaturaLinha {
  key:        string
  kind:       "plan" | "overage" | "addon" | "discount"
  titulo:     string
  /** Como o preço se formou ("R$ 39,90 por usuário/mês"). */
  detalhe?:   string
  qtd:        number
  unitCents:  number
  totalCents: number
  evidencia?: Evidencia[]
}

export interface Fatura {
  id:            string
  /** "Agosto/2026" — como o cliente chama. */
  referencia:    string
  periodoInicio: string
  periodoFim:    string
  vencimento:    string
  status:        FaturaStatus
  totalCents:    number
  linhas:        FaturaLinha[]
  /** Payload Pix copia-e-cola. TODO(dev): vem do PSP. */
  pixCopiaECola: string
  pagoEm?:       string | null
  formaPagamento?: string | null
}

/** Cabeçalho da assinatura — o "como você paga", discreto por natureza. */
export interface AssinaturaResumo {
  planoNome:       string
  planoCents:      number
  /** `null` = sem dia de fechamento definido. Medido: 3 dos 4 clientes estão assim —
   *  renderizar "todo dia 0" seria a tela afirmando uma data que não existe. */
  cicloDia:        number | null
  formaPagamento:  string
  emailCobranca:   string
  /** "Preciso de mais alguns dias" já usado neste ciclo? (1×/ciclo) */
  adiamentoUsado:  boolean
  /** Data até onde o adiamento levaria (pré-calculada pelo server). */
  adiamentoAte:    string | null
}
