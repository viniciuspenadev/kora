import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import { registerPdfFonts } from "./fonts"

// Inter estática embutida (public/fonts) — registro compartilhado com quote-pdf.
registerPdfFonts()

const C = {
  primary: "#004add", navy: "#001548",
  ink: "#0f172a", slate600: "#475569", slate500: "#64748b", slate400: "#94a3b8",
  line: "#e2e8f0", soft: "#f1f5f9", softBlue: "#eef2ff", white: "#ffffff",
}

const STATUS = {
  open:    { label: "EM ABERTO", bg: "#fef3c7", fg: "#92400e" },
  paid:    { label: "PAGA",      bg: "#d1fae5", fg: "#047857" },
  overdue: { label: "VENCIDA",   bg: "#fee2e2", fg: "#b91c1c" },
  void:    { label: "ANULADA",   bg: "#f1f5f9", fg: "#64748b" },
  draft:   { label: "RASCUNHO",  bg: "#f1f5f9", fg: "#64748b" },
} as Record<string, { label: string; bg: string; fg: string }>

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const dt  = (s: string | null) => s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—"

export interface Party {
  person_type?: string | null
  legal_name?: string | null; trade_name?: string | null; tax_id?: string | null
  state_registration?: string | null; municipal_registration?: string | null
  billing_email?: string | null; phone?: string | null
  zip?: string | null; street?: string | null; number?: string | null
  complement?: string | null; district?: string | null; city?: string | null; state?: string | null
}
export interface IssuerParty extends Party {
  pix_key?: string | null; bank_info?: string | null; payment_instructions?: string | null; logo_url?: string | null
}
export interface InvoicePdfData {
  ref:           string
  status:        string
  period_start:  string
  period_end:    string
  due_date:      string | null
  issued_at:     string | null
  subtotal_cents: number
  total_cents:   number
  items:         Array<{ description: string; quantity: number; unit_price_cents: number; amount_cents: number }>
  customer:      Party | null
  customerName:  string
  issuer:        IssuerParty | null
}

function addrLines(p: Party | null): string[] {
  if (!p) return []
  const l1 = [p.street, p.number].filter(Boolean).join(", ") + (p.complement ? ` - ${p.complement}` : "")
  const l2 = [p.district, [p.city, p.state].filter(Boolean).join("/")].filter(Boolean).join(", ")
  const l3 = p.zip ? `CEP ${p.zip}` : ""
  return [l1, l2, l3].map((s) => s.trim()).filter(Boolean)
}
function docLabel(p: Party | null) { return p?.person_type === "pf" ? "CPF" : "CNPJ" }

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 9, color: C.ink, paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44 },
  // Header
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 },
  logo: { height: 26, width: 86, objectFit: "contain" },
  brandText: { fontSize: 20, fontWeight: 700, color: C.navy, letterSpacing: -0.5 },
  invMeta: { alignItems: "flex-end" },
  invTitle: { fontSize: 22, fontWeight: 700, color: C.ink, letterSpacing: -0.5 },
  invRef: { fontSize: 9, color: C.slate500, marginTop: 2 },
  badge: { marginTop: 8, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, fontSize: 8, fontWeight: 700, letterSpacing: 0.5 },
  // Period strip
  strip: { flexDirection: "row", backgroundColor: C.softBlue, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 22 },
  stripCell: { flex: 1 },
  stripLabel: { fontSize: 7, color: C.slate500, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  stripValue: { fontSize: 10, fontWeight: 600, color: C.ink },
  // Parties
  parties: { flexDirection: "row", gap: 18, marginBottom: 24 },
  party: { flex: 1 },
  partyLabel: { fontSize: 7, fontWeight: 700, color: C.primary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5 },
  partyName: { fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 2 },
  partyLine: { fontSize: 8.5, color: C.slate600, marginBottom: 1.5, lineHeight: 1.3 },
  // Table
  tHead: { flexDirection: "row", backgroundColor: C.navy, borderRadius: 4, paddingVertical: 7, paddingHorizontal: 10, marginBottom: 2 },
  th: { fontSize: 7.5, fontWeight: 700, color: C.white, textTransform: "uppercase", letterSpacing: 0.5 },
  tRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  td: { fontSize: 9, color: C.ink },
  cDesc: { flex: 1 }, cQty: { width: 36, textAlign: "right" }, cUnit: { width: 78, textAlign: "right" }, cAmt: { width: 78, textAlign: "right" },
  // Totals
  totals: { marginTop: 14, alignItems: "flex-end" },
  totRow: { flexDirection: "row", width: 220, justifyContent: "space-between", paddingVertical: 3 },
  totLabel: { fontSize: 9, color: C.slate500 },
  totVal: { fontSize: 9, fontWeight: 600, color: C.ink },
  grandRow: { flexDirection: "row", width: 220, justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line },
  grandLabel: { fontSize: 11, fontWeight: 700, color: C.ink },
  grandVal: { fontSize: 13, fontWeight: 700, color: C.primary },
  // Payment footer
  pay: { marginTop: 28, backgroundColor: C.soft, borderRadius: 8, padding: 14 },
  payLabel: { fontSize: 7.5, fontWeight: 700, color: C.slate500, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 5 },
  payLine: { fontSize: 9, color: C.slate600, marginBottom: 2 },
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, textAlign: "center", fontSize: 7.5, color: C.slate400 },
})

function PartyBlock({ label, name, p, isIssuer }: { label: string; name: string; p: Party | null; isIssuer?: boolean }) {
  return (
    <View style={s.party}>
      <Text style={s.partyLabel}>{label}</Text>
      <Text style={s.partyName}>{name}</Text>
      {p?.tax_id ? <Text style={s.partyLine}>{docLabel(p)}: {p.tax_id}</Text> : null}
      {isIssuer && p?.state_registration ? <Text style={s.partyLine}>IE: {p.state_registration}</Text> : null}
      {addrLines(p).map((l, i) => <Text key={i} style={s.partyLine}>{l}</Text>)}
      {p?.billing_email ? <Text style={s.partyLine}>{p.billing_email}</Text> : null}
      {p?.phone ? <Text style={s.partyLine}>{p.phone}</Text> : null}
    </View>
  )
}

export function InvoicePdf({ data }: { data: InvoicePdfData }) {
  const st = STATUS[data.status] ?? STATUS.draft
  const issuer = data.issuer
  const issuerName = issuer?.trade_name || issuer?.legal_name || "Kora"

  return (
    <Document title={`Fatura ${data.ref}`}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headRow}>
          <View>
            {issuer?.logo_url
              ? <Image src={issuer.logo_url} style={s.logo} />
              : <Text style={s.brandText}>{issuerName}</Text>}
          </View>
          <View style={s.invMeta}>
            <Text style={s.invTitle}>FATURA</Text>
            <Text style={s.invRef}>Nº {data.ref}</Text>
            <Text style={[s.badge, { backgroundColor: st.bg, color: st.fg }]}>{st.label}</Text>
          </View>
        </View>

        {/* Período / vencimento */}
        <View style={s.strip}>
          <View style={s.stripCell}>
            <Text style={s.stripLabel}>Período</Text>
            <Text style={s.stripValue}>{dt(data.period_start)} – {dt(data.period_end)}</Text>
          </View>
          <View style={s.stripCell}>
            <Text style={s.stripLabel}>Emissão</Text>
            <Text style={s.stripValue}>{dt(data.issued_at)}</Text>
          </View>
          <View style={s.stripCell}>
            <Text style={s.stripLabel}>Vencimento</Text>
            <Text style={s.stripValue}>{dt(data.due_date)}</Text>
          </View>
        </View>

        {/* Emissor / Cliente */}
        <View style={s.parties}>
          <PartyBlock label="De" name={issuerName} p={issuer} isIssuer />
          <PartyBlock label="Para" name={data.customer?.legal_name || data.customerName} p={data.customer} />
        </View>

        {/* Itens */}
        <View style={s.tHead}>
          <Text style={[s.th, s.cDesc]}>Descrição</Text>
          <Text style={[s.th, s.cQty]}>Qtd</Text>
          <Text style={[s.th, s.cUnit]}>Unitário</Text>
          <Text style={[s.th, s.cAmt]}>Valor</Text>
        </View>
        {data.items.map((it, i) => (
          <View key={i} style={s.tRow}>
            <Text style={[s.td, s.cDesc]}>{it.description}</Text>
            <Text style={[s.td, s.cQty]}>{it.quantity}</Text>
            <Text style={[s.td, s.cUnit]}>{brl(it.unit_price_cents)}</Text>
            <Text style={[s.td, s.cAmt]}>{brl(it.amount_cents)}</Text>
          </View>
        ))}

        {/* Totais */}
        <View style={s.totals}>
          <View style={s.totRow}>
            <Text style={s.totLabel}>Subtotal</Text>
            <Text style={s.totVal}>{brl(data.subtotal_cents)}</Text>
          </View>
          <View style={s.grandRow}>
            <Text style={s.grandLabel}>Total</Text>
            <Text style={s.grandVal}>{brl(data.total_cents)}</Text>
          </View>
        </View>

        {/* Pagamento */}
        {(issuer?.pix_key || issuer?.bank_info || issuer?.payment_instructions) ? (
          <View style={s.pay}>
            <Text style={s.payLabel}>Pagamento</Text>
            {issuer?.pix_key ? <Text style={s.payLine}>PIX: {issuer.pix_key}</Text> : null}
            {issuer?.bank_info ? <Text style={s.payLine}>{issuer.bank_info}</Text> : null}
            {issuer?.payment_instructions ? <Text style={s.payLine}>{issuer.payment_instructions}</Text> : null}
          </View>
        ) : null}

        <Text style={s.footer} fixed>{issuerName}{issuer?.tax_id ? ` · ${docLabel(issuer)} ${issuer.tax_id}` : ""} · fatura gerada pelo Kora</Text>
      </Page>
    </Document>
  )
}
