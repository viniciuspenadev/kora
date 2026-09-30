import { BANDEIRA_LABEL, type Bandeira } from "@/lib/billing/card-brand"

// ═══════════════════════════════════════════════════════════════
// Marcas de bandeira — SVG inline, sem dependência externa
// ═══════════════════════════════════════════════════════════════
// Mesmo padrão do `SourceLogo` (components/chat/source-logo.tsx): SVG escrito à mão, sem
// hook e sem estado, então funciona em Server Component e não custa nenhuma requisição.
//
// 🔑 UM `viewBox` PRA TODAS (`0 0 48 32`, proporção 3:2 — a de um cartão) e o MESMO chip
//    branco por baixo. Cinco marcas com fundo próprio viram colcha de retalhos numa
//    fileira de 5; com o chip comum a fileira lê como um conjunto.
//
// ⚠️ São marcas SIMPLIFICADAS — formas primitivas e tipografia própria, não reprodução do
//    logotipo oficial. O papel delas é RECONHECIMENTO a 24px ("meu cartão é aceito"),
//    não representação de marca. Reproduzir logotipo de terceiro traria uma pergunta de
//    licenciamento que este pixel não paga.
// ⚠️ `textLength` + `lengthAdjust` travam a largura da palavra: sem isso, se a Inter não
//    carregar, o fallback do sistema estica o texto pra fora do chip.

interface Props {
  /** `null` = desconhecida (ou campo vazio) — cai no chip neutro, nunca some. */
  marca?:     Bandeira | null
  /** Altura em px; a largura sai da proporção 3:2. */
  size?:      number
  className?: string
}

const TRACO = "#E2E8F0" // slate-200

/** Chip branco com borda — a base comum de todas as marcas. */
function Base() {
  return <rect x="0.5" y="0.5" width="47" height="31" rx="5" fill="#FFFFFF" stroke={TRACO} />
}

function Visa() {
  return (
    <>
      <Base />
      <text x="24" y="20" textAnchor="middle" fontFamily="inherit" fontWeight={700} fontSize="12"
        letterSpacing="0.5" textLength="30" lengthAdjust="spacingAndGlyphs" fill="#1A1F71">VISA</text>
      <rect x="9" y="23" width="30" height="2" rx="1" fill="#F7B600" />
    </>
  )
}

function Mastercard() {
  return (
    <>
      <Base />
      <circle cx="20" cy="16" r="9" fill="#EB001B" />
      <circle cx="28" cy="16" r="9" fill="#F79E1B" />
      {/* A lente é a INTERSEÇÃO dos dois discos: à direita ela segue o arco do disco
          esquerdo, à esquerda o do direito. Desenhada por cima, é o que dá o laranja
          característico no meio sem precisar de máscara nem de opacidade. */}
      <path d="M24 7.94 A9 9 0 0 1 24 24.06 A9 9 0 0 1 24 7.94 Z" fill="#FF5F00" />
    </>
  )
}

function Elo() {
  // Anel tricolor: um círculo por cor, cada um mostrando 100° do traço (dash) e girado
  // 120° do anterior (dashoffset). Três arcos desenhados à mão dariam o mesmo resultado
  // com três vezes mais chance de erro de sinal.
  const C = 2 * Math.PI * 6            // circunferência do anel
  const arco = (C * 100) / 360         // 100° de traço
  const volta = (C * 120) / 360        // passo de 120° entre as cores
  const cores = ["#FFCB05", "#EF4123", "#00A4E0"]
  return (
    <>
      <Base />
      {cores.map((cor, i) => (
        <circle key={cor} cx="13" cy="16" r="6" fill="none" stroke={cor} strokeWidth="3.5"
          strokeDasharray={`${arco.toFixed(2)} ${(C - arco).toFixed(2)}`}
          strokeDashoffset={(-volta * i).toFixed(2)} />
      ))}
      <text x="31" y="20" fontFamily="inherit" fontWeight={700} fontSize="11"
        textLength="14" lengthAdjust="spacingAndGlyphs" fill="#111827">elo</text>
    </>
  )
}

function Amex() {
  return (
    <>
      <Base />
      <rect x="3" y="3" width="42" height="26" rx="3" fill="#006FCF" />
      <text x="24" y="20" textAnchor="middle" fontFamily="inherit" fontWeight={700} fontSize="9"
        letterSpacing="1" textLength="26" lengthAdjust="spacingAndGlyphs" fill="#FFFFFF">AMEX</text>
    </>
  )
}

function Hipercard() {
  return (
    <>
      <Base />
      <rect x="3" y="3" width="42" height="26" rx="3" fill="#B3131B" />
      <text x="24" y="20" textAnchor="middle" fontFamily="inherit" fontWeight={700} fontSize="9"
        letterSpacing="0.5" textLength="28" lengthAdjust="spacingAndGlyphs" fill="#FFFFFF">HIPER</text>
    </>
  )
}

function Neutra() {
  // Tarja magnética + dois traços: lê como "cartão" sem afirmar bandeira nenhuma.
  return (
    <>
      <Base />
      <rect x="0.5" y="9" width="47" height="5" fill={TRACO} />
      <rect x="6" y="20" width="14" height="2.5" rx="1.25" fill="#CBD5E1" />
      <rect x="23" y="20" width="8" height="2.5" rx="1.25" fill="#CBD5E1" />
    </>
  )
}

const MARCAS: Record<Bandeira, () => React.ReactElement> = {
  visa:       Visa,
  mastercard: Mastercard,
  elo:        Elo,
  amex:       Amex,
  hipercard:  Hipercard,
  // Diners não tem marca própria: é resíduo no Brasil e um sexto desenho seria peso morto.
  // O chip neutro é honesto — o cartão passa igual, só não ganha retrato.
  diners:     Neutra,
}

export function BandeiraLogo({ marca, size = 24, className = "" }: Props) {
  const Marca = marca ? MARCAS[marca] : Neutra
  return (
    <svg
      width={(size * 3) / 2} height={size} viewBox="0 0 48 32"
      role="img" aria-label={marca ? BANDEIRA_LABEL[marca] : "Bandeira não identificada"}
      className={`shrink-0 ${className}`}
    >
      <Marca />
    </svg>
  )
}
