import { PauseCircle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"

// ═══════════════════════════════════════════════════════════════
// C6 · AgentServiceNotice — o que o ATENDENTE vê
// ═══════════════════════════════════════════════════════════════
// 🔑 NÃO SE FOFOCA A SITUAÇÃO FINANCEIRA DO DONO PARA OS FUNCIONÁRIOS DELE. O atendente
//    precisa saber que a ferramenta não está disponível — precisa disso pra não perder a
//    manhã tentando. Não precisa saber por quê. A diferença entre "Campanhas —
//    indisponível no momento" e "Campanhas bloqueadas: fatura em aberto" é a diferença
//    entre uma informação operacional e um vazamento: a segunda espalha pela equipe (e
//    pelo grupo de WhatsApp dela) que a empresa está com problema de caixa. Nenhum
//    cliente perdoa isso, e é o tipo de dano que não aparece em métrica nenhuma — só no
//    cancelamento.
//
// 🔑 A GARANTIA É ESTRUTURAL, NÃO EDITORIAL. Este componente **não recebe**
//    `BillingStanding`, nem `degrau`, nem valor, nem data. Não existe prop por onde o
//    fato financeiro entre. Se amanhã alguém quiser "só mostrar o motivo pro admin", vai
//    ter que mudar a assinatura do componente — e aí a decisão volta a ser tomada, em
//    vez de acontecer sem ninguém perceber. Vazamento de dado sensível não se evita com
//    disciplina de quem escreve a tela; evita-se não entregando o dado à tela.
//    ⚠️ NÃO adicionar `standing`, `reason`, `invoice` ou CTA de pagamento aqui.
//
// 🔑 SEM AÇÃO. O atendente não pode resolver isto, então dar a ele um botão seria
//    empurrar pra dentro de uma conversa que não é dele. O que resta é o que ele PODE
//    fazer: o atendimento, que segue de pé — e é isso que o texto diz.

export function AgentServiceNotice({
  feature,
  variant = "block",
  className,
}: {
  /** O nome da área, como aparece no menu: "Campanhas", "Automações", "IA". */
  feature: string
  /** `block` = a área inteira indisponível · `inline` = tira fina dentro de uma tela viva. */
  variant?: "block" | "inline"
  className?: string
}) {
  // Travessão em vez de concordância: "Campanhas indisponível" está errado e
  // "indisponíveis" quebra com feature no singular ("Agenda"). O travessão separa o
  // rótulo do estado e funciona com qualquer nome que venha do menu.
  const titulo = `${feature} — indisponível no momento`

  if (variant === "inline") {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2",
          className,
        )}
      >
        <PauseCircle className="size-3.5 shrink-0 text-slate-400" strokeWidth={2} />
        <p className="min-w-0 text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-700">{titulo}.</span> Os responsáveis pela
          conta já foram avisados.
        </p>
      </div>
    )
  }

  return (
    <EmptyState
      className={className}
      icon={PauseCircle}
      title={titulo}
      description="Os responsáveis pela conta já foram avisados. Seu atendimento segue normal — conversas, mensagens e histórico continuam disponíveis."
    />
  )
}
