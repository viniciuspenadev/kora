import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import { registerPdfFonts } from "./fonts"
import { formatQuantityWithUnit, unitSpec } from "@/lib/crm/units"

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
  conditions:   { payment_terms: string | null; notes: string | null }
  contentHash:  string
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
  if (it.billing === "monthly")     regime = it.term_months ? `mensal · ${it.term_months} meses` : "mensal"
  else if (it.billing === "yearly") regime = "anual"
  else                              regime = it.unit && it.unit !== "un" ? `por ${sym}` : "cobrança única"
  return `${nature} · ${regime}`
}

/** Preço unitário: com sufixo de medida quando a unidade não é "un" ("R$ 149,90/kg"). */
function unitPriceLabel(it: QuotePdfItem): string {
  const base = brl(it.unit_price_cents)
  return it.unit && it.unit !== "un" ? `${base}/${unitSpec(it.unit).symbol}` : base
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
  cItem: { flex: 1, paddingRight: 8 }, cQty: { width: 74, textAlign: "right" },
  cUnit: { width: 90, textAlign: "right" }, cTot: { width: 90, textAlign: "right" },
  tdStrong: { fontWeight: 600 },
  // Totais
  totalsWrap: { marginTop: 16, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 236, backgroundColor: C.softBlue, borderRadius: 8, padding: 14 },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totLabel: { fontSize: 9, color: C.slate600 },
  totVal: { fontSize: 9, fontWeight: 600, color: C.ink },
  grandRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 7, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#c7d2fe" },
  grandLabel: { fontSize: 11, fontWeight: 700, color: C.navy },
  grandVal: { fontSize: 14, fontWeight: 700, color: C.navy },
  // Cards de condições
  cards: { flexDirection: "row", gap: 14, marginTop: 26 },
  card: { flex: 1, backgroundColor: C.soft, borderRadius: 8, padding: 13 },
  cardLabel: { fontSize: 7.5, fontWeight: 700, color: C.slate500, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 },
  cardValue: { fontSize: 9.5, color: C.ink, lineHeight: 1.4 },
  cardMuted: { fontSize: 9.5, color: C.slate400 },
  notes: { marginTop: 14, fontSize: 8.5, color: C.slate600, lineHeight: 1.4 },
  // Rodapé
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 },
  footText: { fontSize: 7.5, color: C.slate400 },
})

export function QuotePdf({ data }: { data: QuotePdfData }) {
  const { issuer } = data
  const hash = data.contentHash
  const hashShort = hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash

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
          <Text style={[s.th, s.cUnit]}>Preço unit.</Text>
          <Text style={[s.th, s.cTot]}>Total</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={s.tRow} wrap={false}>
            <View style={s.cItem}>
              <Text style={s.itemName}>{it.name}</Text>
              <Text style={s.itemSub}>{itemSubtitle(it)}</Text>
            </View>
            <Text style={[s.td, s.cQty]}>{formatQuantityWithUnit(it.qty, it.unit)}</Text>
            <Text style={[s.td, s.cUnit]}>{unitPriceLabel(it)}</Text>
            <Text style={[s.td, s.cTot, s.tdStrong]}>{brl(it.total_cents)}</Text>
          </View>
        ))}

        {/* Totais */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totRow}>
              <Text style={s.totLabel}>Subtotal</Text>
              <Text style={s.totVal}>{brl(data.totals.subtotal_cents)}</Text>
            </View>
            {data.totals.discount_cents > 0 ? (
              <View style={s.totRow}>
                <Text style={s.totLabel}>Descontos</Text>
                <Text style={s.totVal}>− {brl(data.totals.discount_cents)}</Text>
              </View>
            ) : null}
            <View style={s.grandRow}>
              <Text style={s.grandLabel}>Total</Text>
              <Text style={s.grandVal}>{brl(data.totals.total_cents)}</Text>
            </View>
          </View>
        </View>

        {/* Condições de pagamento / Validade */}
        <View style={s.cards}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Condições de pagamento</Text>
            {data.conditions.payment_terms
              ? <Text style={s.cardValue}>{data.conditions.payment_terms}</Text>
              : <Text style={s.cardMuted}>A combinar</Text>}
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Validade</Text>
            {data.validUntil
              ? <Text style={s.cardValue}>Proposta válida até {dt(data.validUntil)}</Text>
              : <Text style={s.cardMuted}>Sem prazo definido</Text>}
          </View>
        </View>
        {data.conditions.notes ? <Text style={s.notes}>{data.conditions.notes}</Text> : null}

        {/* Rodapé: integridade + carimbo */}
        <View style={s.footer} fixed>
          <Text style={s.footText}>Integridade sha256 · {hashShort}</Text>
          <Text style={s.footText}>Gerada com Kora em {genStamp(data.issuedAt)}</Text>
        </View>
      </Page>
    </Document>
  )
}
