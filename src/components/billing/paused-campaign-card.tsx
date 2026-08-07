import Link from "next/link"
import { Megaphone, Pause } from "lucide-react"
import { cn } from "@/lib/utils"
import { PayNowButton } from "./pay-now"
import { diaMes } from "./format"

// ═══════════════════════════════════════════════════════════════
// C3 · PausedCampaignCard — o trabalho que ficou esperando
// ═══════════════════════════════════════════════════════════════
// 🔑 TRABALHO EM ESPERA É MOTIVO PRA PAGAR; TRABALHO PERDIDO É MOTIVO PRA NÃO VOLTAR.
//    Este cartão existe pra uma frase só: *nada se perdeu*. Uma campanha marcada como
//    "cancelada" ou "falhou" durante a inadimplência ensina que atrasar destrói coisas —
//    e quem acredita nisso não regulariza, migra. "Pausada, 1.240 esperando" é a mesma
//    verdade contada de forma que o pagamento resolve.
//
// 🔑 O HERÓI É O NÚMERO DE DESTINATÁRIOS, não o nome da campanha e não o valor da
//    fatura. É a fila parada que dá peso à decisão, e é ela que precisa ser lida num
//    piscar — por isso `text-2xl bold tabular-nums`, ancorado à direita como total de
//    documento. O valor devido não aparece aqui: já está na faixa do topo, e repeti-lo
//    transformaria um cartão de trabalho num segundo cartão de cobrança.
//
// 🔑 O RODAPÉ DIZ O QUE VOLTA A ACONTECER, no futuro do indicativo ("retoma", "continuam
//    na fila"). Aviso de bloqueio que só descreve o presente deixa a pessoa imaginando o
//    depois — e o que ela imagina é sempre pior do que é.

export function PausedCampaignCard({
  name,
  recipients,
  href,
  pausedAt,
  payHref,
  onPay,
  className,
}: {
  name: string
  /** Quantos ficaram na fila — o herói do cartão. */
  recipients: number
  /** Abrir a campanha. O nome vira link; o cartão inteiro NÃO é clicável (o rodapé tem
      a ação de pagar, e cartão-inteiro-clicável com botão dentro sempre gera clique errado). */
  href?: string
  pausedAt?: string | null
  payHref?: string
  onPay?: () => void
  className?: string
}) {
  const n = recipients.toLocaleString("pt-BR")
  const plural = recipients === 1 ? "destinatário aguardando" : "destinatários aguardando"
  const desde = diaMes(pausedAt)

  return (
    <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white", className)}>
      <div className="flex items-start gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
          <Megaphone className="size-4" strokeWidth={1.9} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {href ? (
              <Link
                href={href}
                className="truncate text-sm font-semibold text-slate-800 underline-offset-2 hover:text-primary-600 hover:underline"
              >
                {name}
              </Link>
            ) : (
              <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
            )}
            {/* Âmbar, não vermelho: pausa é um estado, não uma falha. Este cartão convive
                com o chip "Falhou" da lista de campanhas e não pode se parecer com ele. */}
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              <Pause className="size-2.5" strokeWidth={3} /> Pausada
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Pausada por pendência financeira
            {desde && <span className="tabular-nums"> · aguardando desde {desde}</span>}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">{n}</p>
          <p className="mt-1 text-[11px] text-slate-400">{plural}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-700">Nada foi perdido.</span> Ao regularizar, a
          campanha retoma de onde parou — {recipients === 1 ? "o destinatário continua" : `os ${n} destinatários continuam`} na
          fila e ninguém recebe duas vezes.
        </p>
        <PayNowButton href={payHref} onClick={onPay} size="sm" />
      </div>
    </div>
  )
}
