import { Text, View, Link, StyleSheet } from "@react-pdf/renderer"
import type { Style } from "@react-pdf/types"
import type { RichDoc, Run } from "@/lib/commercial/richdoc"

// ═══════════════════════════════════════════════════════════════
// RichView — tradutor RichDoc → react-pdf (usado pela cotação/fatura)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/crm-quote-composer-design.md §7. Renderiza o conjunto CURADO com as
// fontes já embutidas (Inter 400/600/700): negrito (700), sublinhado, títulos,
// listas (marcador/número), links, divisória. ⚠️ ITÁLICO deferido — sem
// Inter-Italic.ttf o react-pdf não slanta; a marca `i` é IGNORADA aqui (não
// aplica fontStyle) até o arquivo entrar, pra não quebrar o PDF (WYSIWYG > slant).

const s = StyleSheet.create({
  // Sem margem entre parágrafos: cada Enter = uma linha (single-spaced, igual ao
  // editor); o ESPAÇO vem das linhas em branco que a pessoa digita (WYSIWYG).
  para:   { marginBottom: 0 },
  head:   { fontWeight: 700, fontSize: 10.5, marginTop: 6, marginBottom: 3 },
  liRow:  { flexDirection: "row", marginBottom: 2 },
  liMark: { width: 12 },
  liBody: { flex: 1 },
  hr:     { borderBottomWidth: 1, borderBottomColor: "#e2e8f0", marginVertical: 6 },
  link:   { color: "#004add", textDecoration: "underline" },
})

/** Uma "run" formatada. Negrito/sublinhado/link fiéis; itálico deferido. */
function RunText({ r }: { r: Run }) {
  const style: Style = {}
  if (r.b) style.fontWeight = 700
  if (r.u) style.textDecoration = "underline"
  // r.i (itálico) intencionalmente NÃO aplicado — ver cabeçalho.
  if (r.link) {
    return <Link src={r.link} style={[s.link, style]}>{r.text}</Link>
  }
  return <Text style={style}>{r.text}</Text>
}

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <RunText key={i} r={r} />)}</>
}

/**
 * Renderiza um RichDoc. `textStyle` = estilo-base do container (herda do cartão
 * do PDF: cor/tamanho/lineHeight) pra ficar idêntico ao texto de hoje.
 */
export function RichView({ doc, textStyle }: { doc: RichDoc; textStyle?: Style }) {
  return (
    <View>
      {doc.blocks.map((b, i) => {
        switch (b.t) {
          case "p": {
            // Parágrafo sem texto visível = linha em branco INTENCIONAL → nbsp
            // ocupa uma linha real (senão o react-pdf colapsa pra altura zero e o
            // espaçamento que a pessoa criou some).
            const visible = b.runs.some((r) => r.text.replace(/\n/g, "") !== "")
            return <Text key={i} style={[textStyle ?? {}, s.para]}>{visible ? <Runs runs={b.runs} /> : " "}</Text>
          }
          case "h":
            return <Text key={i} style={[textStyle ?? {}, s.head]}><Runs runs={b.runs} /></Text>
          case "ul":
          case "ol":
            return (
              <View key={i}>
                {b.items.map((item, j) => (
                  <View key={j} style={s.liRow}>
                    <Text style={[textStyle ?? {}, s.liMark]}>{b.t === "ol" ? `${j + 1}.` : "•"}</Text>
                    <Text style={[textStyle ?? {}, s.liBody]}><Runs runs={item} /></Text>
                  </View>
                ))}
              </View>
            )
          case "hr":
            return <View key={i} style={s.hr} />
          default:
            return null
        }
      })}
    </View>
  )
}
