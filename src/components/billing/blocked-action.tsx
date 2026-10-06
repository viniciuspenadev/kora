import Link from "next/link"
import { PauseCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { BILLING_HREF } from "./format"

// ═══════════════════════════════════════════════════════════════
// C2 · BlockedAction — a ação que ficou de pé, desativada
// ═══════════════════════════════════════════════════════════════
// 🔑 SUMIR É PIOR QUE TRAVAR. Esconder o botão de "Disparar campanha" resolve o
//    problema do sistema (ninguém clica no que não existe) e cria o do cliente: ele
//    procura, não acha, e conclui que o produto quebrou ou que a função foi removida.
//    Aí abre chamado. Ausência não tem explicação — só a presença desativada pode
//    carregar o motivo junto. O custo de suporte da cobrança não está em quem entendeu
//    que está bloqueado; está em quem não entendeu o que aconteceu com a tela.
//
// 🔑 O MOTIVO FICA AO LADO, NÃO EM HOVER. Tooltip exige descobrir que há tooltip, não
//    existe em toque e não é lido por leitor de tela sem foco — e o botão está
//    desativado, então nunca recebe foco. Um motivo que só aparece pra quem já
//    desconfia não serve pra quem só quer trabalhar.
//
// 🔑 "REGULARIZAR" FICA FORA DO `fieldset` DESABILITADO. A saída não pode ser
//    desativada junto com o que ela resolve — é o erro clássico de travar a tela
//    inteira e trancar o caminho do pagamento junto.
//
// A trava real é do servidor. Isto aqui é a **explicação** dela; o `fieldset disabled`
// existe pra que o clique não passe em nenhum navegador, não pra ser a segurança.

export function BlockedAction({
  blocked,
  reason = "Pausado — fatura em aberto",
  href = BILLING_HREF,
  linkLabel = "Regularizar",
  children,
  className,
}: {
  blocked: boolean
  /** Fale do documento: "Pausado — fatura em aberto". Nunca "você não pagou". */
  reason?: string
  href?: string
  linkLabel?: string
  children: React.ReactNode
  className?: string
}) {
  if (!blocked) return <>{children}</>

  return (
    <div className={cn("inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      {/* `fieldset disabled` desativa QUALQUER controle dentro — não precisa conhecer o
          filho nem clonar props. `pointer-events-none` cobre o que não é controle (um
          <a> estilizado de botão, por exemplo), e a opacidade diz visualmente o que o
          atributo já diz semanticamente. */}
      <fieldset
        disabled
        className="m-0 min-w-0 border-0 p-0 opacity-50 pointer-events-none"
      >
        {children}
      </fieldset>

      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] leading-tight text-slate-500">
        <PauseCircle className="size-3.5 shrink-0 text-slate-400" strokeWidth={2} />
        <span>{reason}</span>
        <Link
          href={href}
          className="font-semibold text-primary-600 underline-offset-2 hover:underline"
        >
          {linkLabel}
        </Link>
      </span>
    </div>
  )
}
