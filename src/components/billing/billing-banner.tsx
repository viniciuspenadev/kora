"use client"

import { useMemo } from "react"
import { Receipt, X } from "lucide-react"
import { useBrowserPref } from "@/lib/browser-pref"
import { cn } from "@/lib/utils"
import { PayNowButton } from "./pay-now"
import { assuntoDaFatura, linhaDoDocumento, tempoEmAberto } from "./format"
import type { BillingStanding } from "./standing-contract"

// ═══════════════════════════════════════════════════════════════
// C1 · BillingBanner — a faixa no topo do app
// ═══════════════════════════════════════════════════════════════
// 🔑 A REGRA CENTRAL: o aviso sobe de SUPERFÍCIE, nunca de VOLUME.
//    Entre a carência e o bloqueio o que muda é **quanto espaço o aviso ocupa e quanto
//    ele insiste** — não o quanto ele grita. O texto do primeiro degrau e o do último
//    têm o mesmo tom: descrevem um documento em aberto e dizem o que continua
//    funcionando. Escalar por cor (âmbar → vermelho → vermelho piscando) é o caminho
//    fácil e o errado: vermelho é a cor de "algo quebrou no sistema", e cobrança não é
//    defeito. Cliente que aprende a associar cobrança a alarme aprende junto que a cor
//    vermelha do produto às vezes não significa nada.
//
//    A escada aqui é: dispensável e fino (carência) → permanente e explicado
//    (restrição) → permanente, escuro e definitivo (bloqueio). Área e persistência,
//    não decibéis.
//
// 🔑 O ÍCONE É UM RECIBO, não um ⚠️ e não um 🔒. É a tradução visual de "fale do
//    documento, nunca da pessoa": triângulo de alerta acusa quem está olhando; o
//    documento é só um documento. Vale pras cinco superfícies da escada.
//
// 🔑 UM BOTÃO SÓ. Nenhuma variação tem "Ver detalhes", "Falar com o suporte" ou
//    "Entender o que aconteceu". Segunda ação num aviso de cobrança é rota de fuga: ela
//    dá à pessoa algo pra clicar que não resolve o problema, e ela clica. O "×" da
//    carência não é ação — é o direito de adiar, e por isso é ícone e não botão.
//
// ⚠️ `ok` e `terminated` não renderizam nada. Em `ok` não há fato a comunicar; em
//    `terminated` o acesso já caiu e a pessoa não está numa tela com faixa — ali a
//    conversa é uma PÁGINA inteira (escopo do outro designer), não uma tarja.

type DegrauVisivel = "grace" | "restricted" | "readonly"

const SUPERFICIE: Record<
  DegrauVisivel,
  {
    faixa: string
    chip: string
    titulo: string
    apoio: string
    rotulo: string
    item: string
    tone: "quiet" | "primary" | "inverse"
  }
> = {
  // Carência — chrome, não aviso. Some no fundo branco da barra de navegação.
  grace: {
    faixa: "bg-white border-slate-200",
    chip: "border-slate-200 bg-slate-50 text-slate-500",
    titulo: "text-slate-900",
    apoio: "text-slate-500",
    rotulo: "text-slate-600",
    item: "text-slate-500",
    tone: "quiet",
  },
  // Restrição — presente e explicada. Âmbar é "atenção", não "erro".
  restricted: {
    faixa: "bg-amber-50 border-amber-200",
    chip: "border-amber-200 bg-white text-amber-700",
    titulo: "text-slate-900",
    apoio: "text-amber-900/70",
    rotulo: "text-slate-700",
    item: "text-slate-600",
    tone: "primary",
  },
  // Bloqueio — firme. A firmeza vem do CONTRASTE (barra escura, editorial), não de
  // vermelho: o estado é definitivo, não é uma emergência.
  readonly: {
    faixa: "bg-slate-900 border-slate-900",
    chip: "border-white/15 bg-white/10 text-white",
    titulo: "text-white",
    apoio: "text-slate-400",
    rotulo: "text-slate-200",
    item: "text-slate-400",
    tone: "inverse",
  },
}

/** Preferência guardada: o DIA em que a faixa de carência foi dispensada. */
const DISMISS_KEY = "kora_billing_grace_dismissed_on"
/** Valor do servidor: lá não existe `localStorage` e a resposta honesta é "não sei". */
const NAO_SEI = "?"

function parseDia(cru: string): string {
  try {
    const v: unknown = JSON.parse(cru)
    return typeof v === "string" ? v : ""
  } catch {
    return ""
  }
}

function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function BillingBanner({
  standing,
  payHref,
  onPay,
  className,
}: {
  standing: BillingStanding
  payHref?: string
  /** Presente ⇒ o CTA abre o pagamento na própria tela em vez de navegar. */
  onPay?: () => void
  className?: string
}) {
  // "Dispensei isso hoje?" — a resposta mora no navegador. Guardar o DIA (e não um
  // carimbo de tempo) é o que faz o aviso voltar amanhã de manhã sem nenhuma aritmética
  // de janela: adiar é um direito diário, não um "não me mostre mais".
  const [dispensadoEm, setDispensadoEm] = useBrowserPref(DISMISS_KEY, parseDia, NAO_SEI)
  // "Hoje" congelado na montagem — a faixa não precisa de relógio vivo, e ler a data no
  // corpo do componente faria dois renders iguais darem resultados diferentes.
  const hoje = useMemo(() => hojeLocal(), [])

  const { degrau, invoice, paused, continues, nextClosingAt } = standing
  if (degrau === "ok" || degrau === "terminated") return null

  const s = SUPERFICIE[degrau]
  const dispensavel = degrau === "grace"

  if (dispensavel) {
    // Enquanto o navegador não responde, nada é pintado — evita a faixa piscar e sumir.
    // (Não há estado de "dispensei agora": gravar a preferência já re-renderiza esta
    //  faixa com o valor novo, então um segundo estado só teria como repetir o primeiro.)
    if (dispensadoEm === NAO_SEI) return null
    if (dispensadoEm === hoje) return null
  }

  const assunto = assuntoDaFatura(invoice)
  const emAberto = tempoEmAberto(invoice)

  // O tom é o mesmo nos três: fato sobre o documento + o que continua verdadeiro.
  const titulo =
    degrau === "grace"
      ? `${assunto} está em aberto.`
      : degrau === "restricted"
        ? `${assunto} está em aberto${emAberto ? ` ${emAberto}` : ""}.`
        : `${assunto} segue em aberto.`

  const apoio =
    degrau === "grace"
      ? [linhaDoDocumento(invoice), "tudo segue funcionando normalmente"].filter(Boolean).join(" · ")
      : degrau === "restricted"
        ? linhaDoDocumento(invoice, nextClosingAt)
        : [linhaDoDocumento(invoice, nextClosingAt), "a conta está em leitura, e a exportação segue liberada"]
            .filter(Boolean)
            .join(" · ")

  // A carência fica SLIM por decisão: mesmo que o contrato mande listas, elas não são
  // renderizadas ali. No degrau 2 nada parou — listar "o que continua" quando nada
  // parou inventa uma consequência que ainda não existe.
  const mostraListas = degrau !== "grace" && (paused.length > 0 || continues.length > 0)

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 border-b px-4 py-2.5 sm:px-6",
        s.faixa,
        className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border",
          s.chip,
        )}
      >
        <Receipt className="size-3.5" strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] font-semibold leading-snug", s.titulo)}>{titulo}</p>
        {apoio && (
          <p className={cn("mt-0.5 text-[11px] leading-relaxed tabular-nums", s.apoio)}>{apoio}</p>
        )}

        {mostraListas && (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px] leading-relaxed">
            {paused.length > 0 && (
              <span className={s.rotulo}>
                <span className="font-semibold">Pausado:</span>{" "}
                <span className={s.item}>{paused.join(" · ")}</span>
              </span>
            )}
            {/* "Continua" nunca é omitido quando existe: é ele que segura o tom. Um aviso
                que só enumera perdas lê como punição; enumerar o que segue de pé lê como
                estado. Mesma informação, outra relação com quem lê. */}
            {continues.length > 0 && (
              <span className={s.rotulo}>
                <span className="font-semibold">Continua:</span>{" "}
                <span className={s.item}>{continues.join(" · ")}</span>
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <PayNowButton href={payHref} onClick={onPay} tone={s.tone} size="sm" />
        {dispensavel && (
          <button
            type="button"
            onClick={() => setDispensadoEm(hoje)}
            aria-label="Dispensar por hoje"
            title="Dispensar por hoje"
            className="grid size-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
