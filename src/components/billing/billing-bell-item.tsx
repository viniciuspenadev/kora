import Link from "next/link"
import { Receipt } from "lucide-react"
import { cn } from "@/lib/utils"
import { BILLING_HREF, assuntoDaFatura, linhaDoDocumento, tempoEmAberto } from "./format"
import type { BillingStanding } from "./standing-contract"

// ═══════════════════════════════════════════════════════════════
// C4 · BillingBellItem — a cobrança dentro do sino, como qualquer outro aviso
// ═══════════════════════════════════════════════════════════════
// 🔑 O ITEM NÃO SE DESTACA DOS OUTROS. Mesma anatomia dos itens de agenda e transferência
//    (`notification-bell.tsx`): chip de ícone size-8, título truncado, tempo à direita,
//    corpo em duas linhas, ponto de não-lida. Nenhuma tarja vermelha, nenhum "!". Um
//    aviso de cobrança que quebra o padrão do feed diz "isto aqui é diferente dos seus
//    assuntos de trabalho" — e a intenção é o oposto: cobrança é um assunto de trabalho,
//    resolve-se e sai da lista.
//    Segue a regra do sino: o TIPO é comunicado pela FORMA do ícone (recibo), nunca pela
//    cor. Cor no sino significa "não-lida", e só.
//
// 🔑 O SINO É LEMBRETE, NÃO EXPLICAÇÃO. Ele diz o fato e leva pro lugar onde se resolve;
//    quem explica a escada é a faixa do topo (C1). Duplicar a explicação aqui daria à
//    pessoa duas leituras do mesmo problema no mesmo instante — e a sensação de estar
//    sendo cobrada em dois canais ao mesmo tempo.
//
// ⚠️ `timeAgo` é cópia do helper de `notification-bell.tsx`, que é local àquele arquivo.
//    Seis linhas duplicadas custam menos que exportar (e travar) o formato de tempo do
//    sino agora. TODO(orquestrador): se um terceiro consumidor aparecer, promover a
//    `@/lib/time`.

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "agora"
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Título e corpo saem do MESMO vocabulário da faixa — o fato é um só. */
function texto(standing: BillingStanding): { title: string; body: string } | null {
  const { degrau, invoice, paused, continues, nextClosingAt } = standing
  if (degrau === "ok" || degrau === "terminated") return null

  // ⚠️ Teste vem ANTES de qualquer coisa de fatura — não existe fatura em teste, então
  //    `assuntoDaFatura` e `linhaDoDocumento` não têm do que falar aqui.
  if (degrau === "trial") {
    const dias = standing.trial?.diasRestantes ?? 0
    return {
      title: dias <= 1 ? "Seu teste termina hoje" : `Seu teste termina em ${dias} dias`,
      body: standing.trial?.podeAssinar
        ? "Depois disso o acesso é interrompido até você ativar a assinatura."
        : "Complete o cadastro da empresa — sem ele não conseguimos emitir a cobrança.",
    }
  }

  const assunto = assuntoDaFatura(invoice)
  const emAberto = tempoEmAberto(invoice)

  if (degrau === "grace") {
    return {
      title: `${assunto} está em aberto`,
      body: [linhaDoDocumento(invoice), "Tudo segue funcionando normalmente."]
        .filter(Boolean)
        .join(" · "),
    }
  }

  // Nos degraus que restringem, o corpo é a CONSEQUÊNCIA — e ela vem das listas do
  // contrato, não de texto fixo: o dia em que a escada mudar, o sino muda junto.
  const partes: string[] = []
  if (paused.length > 0) partes.push(`Pausado: ${paused.join(" · ")}.`)
  if (continues.length > 0) partes.push(`Continua: ${continues.join(" · ")}.`)
  if (partes.length === 0) {
    partes.push(
      degrau === "readonly"
        ? "A conta está em leitura, e a exportação segue liberada."
        : "O atendimento manual segue normal.",
    )
  }
  const doc = linhaDoDocumento(invoice, nextClosingAt)
  if (doc) partes.push(doc)

  return {
    title:
      degrau === "readonly"
        ? `${assunto} segue em aberto`
        : `${assunto} está em aberto${emAberto ? ` ${emAberto}` : ""}`,
    body: partes.join(" "),
  }
}

export function BillingBellItem({
  standing,
  at,
  unread = false,
  href = BILLING_HREF,
  onSelect,
  className,
}: {
  standing: BillingStanding
  /** ISO de quando o aviso foi gerado. */
  at: string
  unread?: boolean
  href?: string
  /** Ex: marcar como lida / fechar o painel do sino antes de navegar. */
  onSelect?: () => void
  className?: string
}) {
  const t = texto(standing)
  if (!t) return null

  return (
    <Link
      href={href}
      onClick={onSelect}
      className={cn(
        "group block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0",
        unread ? "bg-primary-50/35 hover:bg-primary-50/70" : "hover:bg-slate-50/80",
        className,
      )}
    >
      <span className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border",
            unread ? "border-primary-100 bg-white text-primary-600" : "border-slate-100 bg-slate-50 text-slate-400",
          )}
        >
          <Receipt className="size-3.5" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                unread ? "font-semibold text-slate-900" : "font-medium text-slate-600",
              )}
            >
              {t.title}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{timeAgo(at)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-400">
            {t.body}
          </span>
        </span>
        {unread && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />}
      </span>
    </Link>
  )
}
