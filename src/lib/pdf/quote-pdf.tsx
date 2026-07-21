import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import { registerPdfFonts } from "./fonts"
import { formatQuantity, formatQuantityWithUnit, unitSpec } from "@/lib/crm/units"
import type { Style } from "@react-pdf/types"
import { RichView } from "./richdoc-pdf"
import { isRichDoc, isEmptyRichDoc, type RichDoc } from "@/lib/commercial/richdoc"

// Cotação em PDF — espelha invoice-pdf.tsx (mesma paleta C, Inter embutida).
// Mockup aprovado (docs/commercial-core-design.md §7.1): faixa primary no topo,
// logo GRANDE da unidade acima do emissor, "COTAÇÃO COT-0001/2026", blocos
// Preparada para / Referente a, tabela de itens (qty decimal + unidade), total
// em softBlue, cards Condições/Validade, rodapé com hash sha256.
registerPdfFonts()

const C = {
  primary: "#004add", navy: "#001548",
  ink: "#0f172a", slate600: "#475569", slate500: "#64748b", slate400: "#94a3b8",
  line: "#e2e8f0", soft: "#f1f5f9", softBlue: "#eef2ff", white: "#ffffff",
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const dt  = (s: string | null) =>
  s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—"

export type QuoteBilling = "one_time" | "monthly" | "yearly"

export interface QuotePdfItem {
  name:             string
  type:             "product" | "service"
  qty:              number
  unit:             string
  unit_price_cents: number
  billing:          QuoteBilling
  term_months:      number | null
  /** Desconto da linha em centavos, no nível da TAXA (sem fator de prazo) —
   *  num mensal, é desconto POR MÊS. 0 = sem desconto. */
  discount_cents:   number
  total_cents:      number
}
export interface QuotePdfAddress {
  zip_code: string | null; street: string | null; number: string | null
  complement: string | null; district: string | null; city: string | null; state: string | null
}
export interface QuotePdfIssuer {
  name:       string
  legal_name: string | null
  tax_id:     string | null
  phone:      string | null
  email:      string | null
  address:    QuotePdfAddress | null
}
export interface QuotePdfData {
  code:         string          // "COT-0001/2026"
  issuedAt:     string          // ISO
  validUntil:   string | null   // yyyy-mm-dd
  issuer:       QuotePdfIssuer
  /** Logo da unidade como data URI base64 (baixado do storage no server). */
  logoDataUri:  string | null
  client:       { name: string; phone: string | null }
  deal:         { name: string | null; seller: string | null }
  items:        QuotePdfItem[]
  totals:       { subtotal_cents: number; discount_cents: number; total_cents: number }
  // payment_terms/notes: RichDoc (novo) OU string (docs legados congelados).
  conditions:   { payment_terms: RichDoc | string | null; notes: RichDoc | string | null }
  // Bloco de contrato (texto único, já congelado) — abaixo das observações.
  contract:     RichDoc | string | null
  // Condição ESTABELECIDA no negócio (Negociação → Pagamento/Parcelas) — estrutural,
  // sempre correta (não depende do vendedor redigitar); aparece ANTES do Total.
  paymentMethod: string | null
  installments:  number | null
  contentHash:  string
}

/** Tem conteúdo? (string não-vazia ou RichDoc não-vazio). */
function condHasContent(v: RichDoc | string | null): boolean {
  if (v == null) return false
  if (typeof v === "string") return v.trim() !== ""
  return !isEmptyRichDoc(v)
}

/** Endereço do emissor em até 3 linhas (mesmo formato da fatura). */
function issuerAddrLines(a: QuotePdfAddress | null): string[] {
  if (!a) return []
  const l1 = [a.street, a.number].filter(Boolean).join(", ") + (a.complement ? ` - ${a.complement}` : "")
  const l2 = [a.district, [a.city, a.state].filter(Boolean).join("/")].filter(Boolean).join(", ")
  // CEP com máscara BR ("03734130" → "03734-130"); fora do padrão fica como veio.
  const zip = a.zip_code?.replace(/^(\d{5})(\d{3})$/, "$1-$2") ?? null
  const l3 = zip ? `CEP ${zip}` : ""
  return [l1, l2, l3].map((s) => s.trim()).filter(Boolean)
}

/** Sublinha do item: natureza + regime de cobrança/medida ("Serviço · cobrança única"). */
function itemSubtitle(it: QuotePdfItem): string {
  const nature = it.type === "service" ? "Serviço" : "Produto"
  const sym = unitSpec(it.unit).symbol
  let regime: string
  if (it.billing === "monthly")     regime = "mensal"
  else if (it.billing === "yearly") regime = "anual"
  else                              regime = it.unit && it.unit !== "un" ? `por ${sym}` : "cobrança única"
  return `${nature} · ${regime}`
}

/**
 * Taxa/preço do item: SEMPRE deixa claro o regime — "/mês"/"/ano" pra recorrente,
 * sufixo de medida quando a unidade não é "un" ("R$ 149,90/kg"). Nunca um número
 * "pelado" que possa ser lido como preço fechado (era a origem da confusão do
 * cliente: R$2.000,00 sem indicar que era mensal, ao lado de um Total de 6 meses).
 */
function rateLabel(it: QuotePdfItem): string {
  const base = brl(it.unit_price_cents)
  if (it.billing === "monthly") return `${base}/mês`
  if (it.billing === "yearly")  return `${base}/ano`
  return it.unit && it.unit !== "un" ? `${base}/${unitSpec(it.unit).symbol}` : base
}

/**
 * Qtd = "o que MULTIPLICA o preço" — a conta Qtd × Preço = Total fecha em toda
 * linha, em todo segmento:
 *  • Recorrente → o PRAZO ("6 meses", "2 anos"); qtd > 1 vira prefixo ("2 · 6 meses").
 *  • Serviço avulso qtd 1 sem medida → em branco (nada multiplica; o preço já diz tudo).
 *  • Produto/medida → quantidade, com símbolo quando a unidade não é "un".
 */
function qtyLabel(it: QuotePdfItem): string {
  const term = it.term_months ?? RECUR_DEFAULT_TERM
  if (it.billing === "monthly" || it.billing === "yearly") {
    const label = termLabel(term, it.billing === "monthly" ? "month" : "year")
    return it.qty > 1 ? `${formatQuantity(it.qty, it.unit)} · ${label}` : label
  }
  const generic = !it.unit || it.unit === "un"
  if (it.type === "service" && generic && it.qty === 1) return ""
  return generic ? formatQuantity(it.qty, it.unit) : formatQuantityWithUnit(it.qty, it.unit)
}

/**
 * Âncora do desconto na LINHA: SÓ o valor cheio riscado sob o Total líquido
 * (owner: "− R$X" junto virava poluição). O riscado sozinho conta a história —
 * inclusive no 100% ("R$ 0,00" + cheio riscado, sem rótulo). Nível do TOTAL da
 * linha (fator de prazo aplicado: desconto abate a taxa).
 */
function discountAnchor(it: QuotePdfItem): string | null {
  if (!it.discount_cents || it.discount_cents <= 0) return null
  const factor = it.billing === "monthly" ? (it.term_months ?? RECUR_DEFAULT_TERM)
               : it.billing === "yearly"  ? (it.term_months ?? RECUR_DEFAULT_TERM) / 12
               : 1
  // Cheio derivado do preço unitário (não de net+desconto) — exato mesmo quando
  // o desconto encosta no piso 0 da linha (100%).
  const grossC = Math.round(it.unit_price_cents * it.qty * factor)
  if (grossC <= it.total_cents) return null
  return brl(grossC)
}

/**
 * Quebra por NATUREZA — separa o que se paga UMA vez (produtos, projetos, setup)
 * do que é RECORRENTE (mensalidade/anuidade). A caixa de totais só muda de forma
 * quando há recorrência: aí distingue "Investimento inicial × Mensalidade × Total
 * do contrato" em vez de um único "Total" gordo que soma 6 meses de serviço e
 * parece preço à vista (origem literal da confusão do cliente). Venda só de
 * produto continua uma nota limpa (Subtotal/Total).
 *
 * Taxa recorrente = total_cents ÷ prazo → embute o desconto por-item e é robusta
 * a prazos diferentes entre itens. `commonTermMonths` só quando TODOS os itens
 * recorrentes compartilham o mesmo prazo (senão "por N meses" mentiria).
 */
interface NatureSplit {
  oneTimeCents:     number
  monthlyRateCents: number
  yearlyRateCents:  number
  hasRecurring:     boolean
  commonTermMonths: number | null
}
const RECUR_DEFAULT_TERM = 12 // espelha DEFAULT_TERM_MONTHS de @/lib/crm/value
function natureSplit(items: QuotePdfItem[]): NatureSplit {
  const termOf = (it: QuotePdfItem) => it.term_months ?? RECUR_DEFAULT_TERM
  let oneTimeCents = 0, monthlyRateCents = 0, yearlyRateCents = 0
  const recurTerms = new Set<number>()
  for (const it of items) {
    if (it.billing === "monthly") {
      monthlyRateCents += Math.round(it.total_cents / termOf(it))
      recurTerms.add(termOf(it))
    } else if (it.billing === "yearly") {
      yearlyRateCents += Math.round(it.total_cents / (termOf(it) / 12))
      recurTerms.add(termOf(it))
    } else {
      oneTimeCents += it.total_cents
    }
  }
  return {
    oneTimeCents, monthlyRateCents, yearlyRateCents,
    hasRecurring:     recurTerms.size > 0,
    commonTermMonths: recurTerms.size === 1 ? [...recurTerms][0] : null,
  }
}

/** "6 meses" / "1 mês" — prazo por extenso, pra colar no rótulo da recorrência. */
function termLabel(months: number, unit: "month" | "year"): string {
  if (unit === "year") {
    const y = Math.round(months / 12)
    return `${y} ${y === 1 ? "ano" : "anos"}`
  }
  return `${months} ${months === 1 ? "mês" : "meses"}`
}

/** Resumo estruturado da forma de pagamento — vai no card Condições de pagamento
 *  (ex: "Cartão de crédito · 3× de R$ 7.174,88"). Neutro a qualquer segmento. */
function paymentSummary(method: string | null, inst: number | null, instValueCents: number | null): string | null {
  if (!method) return null
  return inst && instValueCents ? `${method} · ${inst}× de ${brl(instValueCents)}` : method
}

/** Carimbo de geração em America/Sao_Paulo. */
function genStamp(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso))
}

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, color: C.ink, paddingTop: 42, paddingBottom: 60, paddingHorizontal: 44 },
  band: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: C.primary },
  // Header
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 26 },
  issuerCol: { flex: 1, paddingRight: 20 },
  // objectPosition ancora o logo no CANTO ESQUERDO do box (default centraliza →
  // logo "flutuava" desalinhado do texto do emissor — feedback do owner).
  logo: { height: 76, width: 160, objectFit: "contain", objectPositionX: 0, objectPositionY: 0, marginBottom: 10 },
  issuerName: { fontSize: 15, fontWeight: 700, color: C.navy, letterSpacing: -0.4, marginBottom: 3 },
  issuerLine: { fontSize: 8, color: C.slate500, marginBottom: 1.5, lineHeight: 1.3 },
  metaCol: { alignItems: "flex-end", width: 190 },
  metaKicker: { fontSize: 9, fontWeight: 700, color: C.primary, textTransform: "uppercase", letterSpacing: 2.5, marginBottom: 4 },
  metaCode: { fontSize: 20, fontWeight: 700, color: C.navy, letterSpacing: -0.5, marginBottom: 8 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginBottom: 2 },
  metaLabel: { fontSize: 8, color: C.slate500 },
  metaValue: { fontSize: 8, fontWeight: 600, color: C.ink },
  // Parties
  parties: { flexDirection: "row", gap: 14, marginBottom: 24 },
  party: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 12 },
  partyLabel: { fontSize: 7, fontWeight: 700, color: C.primary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 },
  partyName: { fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 2 },
  partyLine: { fontSize: 8.5, color: C.slate600, marginBottom: 1.5, lineHeight: 1.3 },
  // Tabela
  tHead: { flexDirection: "row", paddingBottom: 7, marginBottom: 2, borderBottomWidth: 2, borderBottomColor: C.navy },
  th: { fontSize: 7.5, fontWeight: 700, color: C.navy, textTransform: "uppercase", letterSpacing: 0.5 },
  tRow: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  itemName: { fontSize: 9.5, fontWeight: 600, color: C.ink, marginBottom: 2 },
  itemSub: { fontSize: 7.5, color: C.slate500 },
  td: { fontSize: 9, color: C.ink },
  // Layout: Item (largura fixa, Qtd logo ao lado à ESQUERDA) → spacer flexível
  // absorve o vão → Preço e Total ancorados à DIREITA, com respiro entre eles.
  // (Antes o Item era flex:1 e empurrava Qtd/Preço/Total todos pra ponta direita.)
  cItem:   { width: 210, paddingRight: 10 },
  cQty:    { width: 40, textAlign: "left" },
  cSpacer: { flex: 1 },
  cUnit:   { width: 96, textAlign: "right" },
  cTot:    { width: 96, textAlign: "right", paddingLeft: 10 },
  tdStrong: { fontWeight: 600 },
  // Âncora de desconto sob o Total da linha: cheio riscado + abatimento.
  totCaption: { fontSize: 7, color: C.slate500, textAlign: "right", marginTop: 1 },
  totStrike:  { textDecoration: "line-through", color: C.slate400 },
  // Totais
  totalsWrap: { marginTop: 16, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 236, backgroundColor: C.softBlue, borderRadius: 8, padding: 14 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totLabel: { fontSize: 9, color: C.slate600 },
  totVal: { fontSize: 9, fontWeight: 600, color: C.ink },
  // Desconto = AJUSTE, não headline: recua (slate, sem bold) pra não competir com
  // as linhas de valor — lê como ajuste da conta antes do Total.
  totDiscountRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totDiscountLabel: { fontSize: 8.5, color: C.slate500 },
  totDiscountVal: { fontSize: 8.5, color: C.slate500 },
  grandRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 7, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#c7d2fe" },
  grandLabel: { fontSize: 11, fontWeight: 700, color: C.navy },
  grandVal: { fontSize: 14, fontWeight: 700, color: C.navy },
  // Recorrência — COLA no Total (logo abaixo), em azul, prazo no rótulo. É a
  // resposta "e por mês?" ao lado do "quanto no total". Neutra a qualquer segmento.
  recurRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 },
  recurLabel: { fontSize: 9, fontWeight: 600, color: C.primary },
  recurVal: { fontSize: 11, fontWeight: 700, color: C.primary },
  // Cards de condições
  cards: { flexDirection: "row", gap: 14, marginTop: 26 },
  card: { flex: 1, backgroundColor: C.soft, borderRadius: 8, padding: 13 },
  cardLabel: { fontSize: 7.5, fontWeight: 700, color: C.slate500, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 },
  // Resumo estruturado da forma de pagamento no topo do card Condições.
  payLine: { fontSize: 9.5, fontWeight: 600, color: C.ink, marginBottom: 4 },
  cardValue: { fontSize: 9.5, color: C.ink, lineHeight: 1.4 },
  cardMuted: { fontSize: 9.5, color: C.slate400 },
  notes: { marginTop: 14, fontSize: 8.5, color: C.slate600, lineHeight: 1.4 },
  // Rodapé
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  footText: { fontSize: 7.5, color: C.slate400 },
})

/** Renderiza um valor de condição: RichDoc → RichView; string legada → Text. */
function CondValue({ value, textStyle }: { value: RichDoc | string; textStyle: Style }) {
  if (isRichDoc(value)) return <RichView doc={value} textStyle={textStyle} />
  return <Text style={textStyle}>{value}</Text>
}

export function QuotePdf({ data }: { data: QuotePdfData }) {
  const { issuer } = data
  const hash = data.contentHash
  const hashShort = hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash

  // Parcela: total ÷ nº de parcelas (só quando >1× — 1× é "à vista", sem fração a mostrar).
  const inst = data.installments && data.installments > 1 ? data.installments : null
  const instValueCents = inst ? Math.round(data.totals.total_cents / inst) : null
  // Quebra por natureza — decide se a caixa de totais mostra o desdobramento
  // (investimento inicial × mensalidade × total) ou fica simples.
  const split = natureSplit(data.items)
  // Forma de pagamento estruturada → card Condições de pagamento (não mais na
  // caixa de totais). Ex: "Cartão de crédito · 3× de R$ 7.174,88".
  const paySummary = paymentSummary(data.paymentMethod, inst, instValueCents)

  return (
    <Document title={`Cotação ${data.code}`}>
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />

        {/* Cabeçalho: emissor (logo grande) × identificação da cotação */}
        <View style={s.headRow}>
          <View style={s.issuerCol}>
            {data.logoDataUri ? <Image src={data.logoDataUri} style={s.logo} /> : null}
            <Text style={s.issuerName}>{issuer.name}</Text>
            {issuer.legal_name && issuer.legal_name !== issuer.name ? <Text style={s.issuerLine}>{issuer.legal_name}</Text> : null}
            {issuer.tax_id ? <Text style={s.issuerLine}>CNPJ: {issuer.tax_id}</Text> : null}
            {issuerAddrLines(issuer.address).map((l, i) => <Text key={i} style={s.issuerLine}>{l}</Text>)}
            {issuer.phone ? <Text style={s.issuerLine}>{issuer.phone}</Text> : null}
            {issuer.email ? <Text style={s.issuerLine}>{issuer.email}</Text> : null}
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaKicker}>Cotação</Text>
            <Text style={s.metaCode}>{data.code}</Text>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Emitida</Text>
              <Text style={s.metaValue}>{dt(data.issuedAt)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Válida até</Text>
              <Text style={s.metaValue}>{dt(data.validUntil)}</Text>
            </View>
          </View>
        </View>

        {/* Preparada para / Referente a */}
        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.partyLabel}>Preparada para</Text>
            <Text style={s.partyName}>{data.client.name}</Text>
            {data.client.phone ? <Text style={s.partyLine}>{data.client.phone}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.partyLabel}>Referente a</Text>
            <Text style={s.partyName}>{data.deal.name || "Negócio"}</Text>
            {data.deal.seller ? <Text style={s.partyLine}>Atendido por {data.deal.seller}</Text> : null}
          </View>
        </View>

        {/* Itens */}
        <View style={s.tHead}>
          <Text style={[s.th, s.cItem]}>Item</Text>
          <Text style={[s.th, s.cQty]}>Qtd</Text>
          <View style={s.cSpacer} />
          <Text style={[s.th, s.cUnit]}>Preço</Text>
          <Text style={[s.th, s.cTot]}>Total</Text>
        </View>
        {data.items.map((it, i) => {
          const disc = discountAnchor(it)
          return (
            <View key={i} style={s.tRow} wrap={false}>
              <View style={s.cItem}>
                <Text style={s.itemName}>{it.name}</Text>
                <Text style={s.itemSub}>{itemSubtitle(it)}</Text>
              </View>
              <Text style={[s.td, s.cQty]}>{qtyLabel(it)}</Text>
              <View style={s.cSpacer} />
              <Text style={[s.td, s.cUnit]}>{rateLabel(it)}</Text>
              <View style={s.cTot}>
                <Text style={[s.td, s.tdStrong, { textAlign: "right" }]}>{brl(it.total_cents)}</Text>
                {disc ? <Text style={[s.totCaption, s.totStrike]}>{disc}</Text> : null}
              </View>
            </View>
          )
        })}

        {/* Totais — conta de nota padrão (Subtotal → Descontos → Total), e quando
            há recorrência a Mensalidade/Anuidade COLA logo abaixo do Total (azul,
            prazo no rótulo) respondendo "e por mês?" sem confundir com o à vista.
            Forma de pagamento vai no card Condições. */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totRow}>
              <Text style={s.totLabel}>Subtotal</Text>
              <Text style={s.totVal}>{brl(data.totals.subtotal_cents)}</Text>
            </View>
            {data.totals.discount_cents > 0 ? (
              <View style={s.totDiscountRow}>
                <Text style={s.totDiscountLabel}>Descontos</Text>
                <Text style={s.totDiscountVal}>− {brl(data.totals.discount_cents)}</Text>
              </View>
            ) : null}
            <View style={s.grandRow}>
              <Text style={s.grandLabel}>Total</Text>
              <Text style={s.grandVal}>{brl(data.totals.total_cents)}</Text>
            </View>
            {split.monthlyRateCents > 0 ? (
              <View style={s.recurRow}>
                <Text style={s.recurLabel}>Mensalidade{split.commonTermMonths ? ` · ${termLabel(split.commonTermMonths, "month")}` : ""}</Text>
                <Text style={s.recurVal}>{brl(split.monthlyRateCents)}/mês</Text>
              </View>
            ) : null}
            {split.yearlyRateCents > 0 ? (
              <View style={s.recurRow}>
                <Text style={s.recurLabel}>Anuidade{split.commonTermMonths ? ` · ${termLabel(split.commonTermMonths, "year")}` : ""}</Text>
                <Text style={s.recurVal}>{brl(split.yearlyRateCents)}/ano</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Condições de pagamento / Validade — o cartão de Condições SÓ existe
            quando tem conteúdo (nada de "A combinar" que o vendedor não escreveu;
            owner 2026-07-20). Sem condições → Validade ocupa a linha sozinha. */}
        <View style={s.cards}>
          {paySummary || condHasContent(data.conditions.payment_terms) ? (
            <View style={s.card}>
              <Text style={s.cardLabel}>Condições de pagamento</Text>
              {paySummary ? <Text style={s.payLine}>{paySummary}</Text> : null}
              {condHasContent(data.conditions.payment_terms)
                ? <CondValue value={data.conditions.payment_terms!} textStyle={s.cardValue} />
                : null}
            </View>
          ) : null}
          <View style={s.card}>
            <Text style={s.cardLabel}>Validade</Text>
            {data.validUntil
              ? <Text style={s.cardValue}>Proposta válida até {dt(data.validUntil)}</Text>
              : <Text style={s.cardMuted}>Sem prazo definido</Text>}
          </View>
        </View>
        {condHasContent(data.conditions.notes)
          ? <View style={s.notes}><CondValue value={data.conditions.notes!} textStyle={s.cardValue} /></View>
          : null}

        {/* Bloco de contrato — texto único (mesma linguagem dos cartões cinza) */}
        {condHasContent(data.contract) ? (
          <View style={[s.card, { marginTop: 14 }]}>
            <Text style={s.cardLabel}>Contrato</Text>
            <CondValue value={data.contract!} textStyle={s.cardValue} />
          </View>
        ) : null}

        {/* Rodapé: integridade + carimbo */}
        <View style={s.footer} fixed>
          <Text style={s.footText}>Integridade sha256 · {hashShort}</Text>
          <Text style={s.footText}>Gerada com Kora em {genStamp(data.issuedAt)}</Text>
        </View>
      </Page>
    </Document>
  )
}
