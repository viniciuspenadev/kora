"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, X } from "lucide-react"
import { useBrowserPref } from "@/lib/browser-pref"
import { cn } from "@/lib/utils"
import { listarPt } from "./format"

// ═══════════════════════════════════════════════════════════════
// C5 · BillingRestoredToast — o aviso de que acabou
// ═══════════════════════════════════════════════════════════════
// 🔑 O CUSTO DE SUPORTE DA COBRANÇA NÃO ESTÁ NA DESCIDA DA ESCADA, ESTÁ NA SUBIDA.
//    Quem desce é avisado três vezes. Quem paga descobre sozinho — e enquanto não
//    descobre, testa: abre a campanha, tenta disparar, não confia, abre chamado
//    perguntando "já voltou?". Pagar e não receber confirmação é o único momento da
//    escada em que a pessoa fica sem informação nenhuma, logo depois de fazer
//    exatamente o que foi pedido. Este componente existe pra fechar esse buraco.
//
// 🔑 DIZ O QUE VOLTOU, NOMEADAMENTE — e cita o trabalho retomado pelo nome. "Sua
//    assinatura foi regularizada" é sobre o nosso processo; "a campanha Black Friday foi
//    retomada" é sobre o negócio dela. A segunda encerra o assunto; a primeira só
//    convida a ir conferir.
//
// 🔑 UMA VEZ SÓ. Confirmação que reaparece a cada navegação vira ruído e, pior, planta a
//    dúvida de que algo continua acontecendo. O "já vi isto" é gravado pelo carimbo do
//    evento (`restoredAt`), não por um booleano: uma nova restauração meses depois tem
//    carimbo novo e é celebrada de novo, sem nenhuma limpeza manual.
//    O carimbo é gravado quando o aviso **termina** de aparecer, não quando começa: quem
//    trocou de tela em dois segundos não leu nada, e dar por visto o que não foi visto é
//    o mesmo buraco que o componente existe pra fechar, só que mais difícil de perceber.
//
// ⚠️ POSIÇÃO: canto inferior direito, `z-50` — cobre por ~12s a pilha de configuração do
//    `OnboardingBanner` (`z-40`, mesmo canto). É de propósito: um aviso de vida curta que
//    encerra um assunto vale mais que um atalho permanente, e ele se retira sozinho.
//
// ⚠️ LIMITE CONHECIDO: o "já vi" mora no navegador. Quem pagou no celular e abriu no
//    desktop vê o aviso duas vezes — uma por aparelho. Preferi isso a não avisar em
//    aparelho nenhum. Fechar de verdade exigiria carimbo por usuário no servidor;
//    TODO(orquestrador): se virar incômodo, é um campo, não um componente novo.

const ACK_KEY = "kora_billing_restored_ack"
/** Valor do servidor: lá não existe `localStorage`. Nada é pintado enquanto for este. */
const NAO_SEI = "?"
const CAPACIDADES_PADRAO = ["campanhas", "automações", "IA"]
const SEM_ITENS: string[] = []

function parseCarimbo(cru: string): string {
  try {
    const v: unknown = JSON.parse(cru)
    return typeof v === "string" ? v : ""
  } catch {
    return ""
  }
}

export function BillingRestoredToast({
  restoredAt,
  capabilities = CAPACIDADES_PADRAO,
  resumed = SEM_ITENS,
  autoDismissMs = 12_000,
  onClose,
  className,
}: {
  /** Carimbo (ISO) da restauração. É a IDENTIDADE do evento — muda, avisa de novo. */
  restoredAt: string
  /** O que voltou a funcionar. Default: campanhas, automações e IA. */
  capabilities?: string[]
  /** O trabalho que foi retomado, pelo nome ("Black Friday", "Boas-vindas"). */
  resumed?: string[]
  /** 0 desativa o auto-fechamento. */
  autoDismissMs?: number
  /** Fechamento EXPLÍCITO (o "×"). O auto-fechamento não dispara: não foi ato de ninguém. */
  onClose?: () => void
  className?: string
}) {
  const [ack, setAck] = useBrowserPref(ACK_KEY, parseCarimbo, NAO_SEI)
  const [fechado, setFechado] = useState(false)

  // Visibilidade é DERIVADA, não um estado paralelo: `ack === NAO_SEI` é o servidor (nada
  // pintado até o navegador responder), `ack === restoredAt` é "esta restauração já foi
  // comemorada aqui", e `fechado` é a decisão desta visita. Nenhum efeito precisa
  // sincronizar as três — a conta é a mesma a cada render.
  const visivel = ack !== NAO_SEI && ack !== restoredAt && !fechado

  useEffect(() => {
    if (!visivel || !autoDismissMs) return
    const t = setTimeout(() => {
      setFechado(true)
      setAck(restoredAt) // dá por visto só aqui — ver o comentário do cabeçalho
    }, autoDismissMs)
    return () => clearTimeout(t)
  }, [visivel, autoDismissMs, restoredAt, setAck])

  if (!visivel) return null

  const caps = capabilities.filter(Boolean)
  const verbo = caps.length === 1 ? "voltou" : "voltaram"
  const retomados = resumed.slice(0, 3)
  const excedente = resumed.length - retomados.length

  function fechar() {
    setFechado(true)
    setAck(restoredAt)
    onClose?.()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-3 bottom-4 z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-card",
        "animate-in fade-in slide-in-from-bottom-2 duration-300",
        "sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Verde aqui tem significado: é o único momento da escada em que algo deu certo. */}
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-4" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Tudo certo — {listarPt(caps)} {verbo}.
          </p>
          {retomados.length > 0 && (
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Retomado de onde parou:{" "}
              <span className="font-medium text-slate-700">{listarPt(retomados)}</span>
              {excedente > 0 && <span> e mais {excedente}</span>}.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar aviso"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
