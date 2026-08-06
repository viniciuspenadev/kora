"use client"

import { Barcode, CreditCard, Wallet } from "lucide-react"
import { BTN_GHOST, BTN_WHITE, ModalShell } from "./modal-shell"
import { linkSuporte } from "@/lib/support"
import { PixBox } from "./pix-box"
import { brl, dataLonga } from "../format"

// ═══════════════════════════════════════════════════════════════
// Modal "pagar"
// ═══════════════════════════════════════════════════════════════
// DECISÃO: o modal abre já com o QR VISÍVEL. Quem clicou em "Pagar" declarou a
// intenção — fazer ele clicar de novo pra ver o QR é pedágio. Boleto e cartão
// existem, mas ficam abaixo e em peso menor: o Pix resolve em 1 minuto e é o
// que faz a fatura sair do vermelho hoje, não em três dias úteis.

export function PagarModal({
  totalCents, vencimento, referencia, pixCopiaECola, onClose,
}: {
  totalCents:    number
  vencimento:    string
  referencia:    string
  pixCopiaECola: string
  onClose:       () => void
}) {
  return (
    <ModalShell
      icon={Wallet}
      title={`Pagar a fatura de ${referencia.split("/")[0].toLowerCase()}`}
      desc={`${brl(totalCents)} · vence em ${dataLonga(vencimento)}`}
      onClose={onClose}
      size="lg"
      footer={<button type="button" onClick={onClose} className={BTN_GHOST}>Fechar</button>}
    >
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <p className="text-xs font-medium text-slate-500">Total a pagar</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none mt-1.5">{brl(totalCents)}</p>
          </div>
          <p className="text-[11px] text-slate-400 text-right">
            Fatura {referencia}<br />vence em {dataLonga(vencimento)}
          </p>
        </div>

        <PixBox totalCents={totalCents} vencimento={vencimento} pixCopiaECola={pixCopiaECola} compacto />

        <div className="pt-3 border-t border-slate-100">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Outras formas</p>
          {/* 🔴 ERAM DOIS BOTÕES SEM `onClick` (achado do QA, 05/08): clicar não fazia
              nada, nem erro, nem log. Botão que não responde ensina que a tela é
              decorativa — e essa lição contamina os botões que FUNCIONAM.
              🔑 Enquanto boleto e cartão avulso não existirem, o honesto é dizer o que
              existe: falar com a gente. Um caminho real vale mais que dois falsos. */}
          <a
            // Contato vem de `lib/support` — o número mora em UM lugar só.
            href={linkSuporte("Olá! Quero pagar minha fatura Kora por outra forma.")}
            target="_blank" rel="noopener noreferrer"
            className={BTN_WHITE}
          >
            <CreditCard className="size-3.5" /> Falar no WhatsApp
          </a>
          <p className="text-[11px] text-slate-400 mt-2">
            Boleto e cartão avulso a gente resolve junto com você — o que estiver pausado
            volta assim que o pagamento cair.
          </p>
        </div>
      </div>
    </ModalShell>
  )
}
