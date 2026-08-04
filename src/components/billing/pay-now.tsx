import Link from "next/link"
import { cn } from "@/lib/utils"
import { BILLING_HREF, PAY_LABEL } from "./format"

// ═══════════════════════════════════════════════════════════════
// PayNowButton — o ÚNICO botão de toda a escada de cobrança
// ═══════════════════════════════════════════════════════════════
// DECISÃO DE UX: o rótulo NÃO é prop. "Pagar agora" é constante de módulo justamente pra
// que nenhuma superfície possa inventar a sua variação ("Regularizar assinatura",
// "Resolver pendência", "Ver fatura"). Quem está atrasado precisa reconhecer o MESMO
// botão na faixa, no cartão da campanha e no sino — se cada tela chama a mesma ação por
// um nome diferente, a pessoa não conclui que é a mesma ação, conclui que são três
// problemas. Um caminho, um nome, um botão.
//
// O `tone` NÃO muda a hierarquia da ação — muda só o contraste necessário pra ela
// continuar legível sobre a superfície onde caiu (barra branca, barra âmbar, barra
// escura). É acabamento, não escalada.

type Tone = "primary" | "quiet" | "inverse"

const TONE: Record<Tone, string> = {
  // Degrau alto / superfície clara: a ação é a coisa mais importante da faixa.
  primary: "bg-primary text-white hover:bg-primary-700",
  // Carência: o aviso é dispensável, então o botão não pode gritar mais que o texto.
  quiet: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
  // Sobre a barra escura do bloqueio — inverte pra manter contraste sem virar alarme.
  inverse: "bg-white text-slate-900 hover:bg-slate-100",
}

export function PayNowButton({
  href = BILLING_HREF,
  onClick,
  tone = "primary",
  size = "md",
  className,
}: {
  href?: string
  /** Presente ⇒ vira `<button>` (modal de pagamento na própria tela). Ausente ⇒ navega. */
  onClick?: () => void
  tone?: Tone
  size?: "sm" | "md"
  className?: string
}) {
  const cls = cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors",
    size === "sm" ? "h-8 px-3 text-[11px]" : "h-9 px-4 text-xs",
    TONE[tone],
    className,
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {PAY_LABEL}
      </button>
    )
  }
  return (
    <Link href={href} className={cls}>
      {PAY_LABEL}
    </Link>
  )
}
