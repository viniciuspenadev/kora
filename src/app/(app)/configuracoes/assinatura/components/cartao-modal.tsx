"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react"
import { getTitularParaCobranca, type TitularPreenchido } from "@/lib/actions/subscription"
import { BandeiraLogo } from "@/components/billing/bandeira-logo"
import type { Bandeira } from "@/lib/billing/card-brand"
import { CardForm } from "../pagamento/card-form"
import { ModalShell, BTN_PRIMARY } from "./modal-shell"

// ═══════════════════════════════════════════════════════════════
// Trocar cartão — MODAL (era uma página)
// ═══════════════════════════════════════════════════════════════
// 🔑 VIROU MODAL (dono, 07/08). Trocar cartão não é uma seção do produto, é um ato curto
//    de 4 campos — e navegar pra outra página pra isso custa o contexto inteiro da tela de
//    assinatura, que é justamente onde a pessoa acabou de ler que a cobrança falhou.
//
// ⚠️ A ROTA `/configuracoes/assinatura/cartao` CONTINUA EXISTINDO, e não é redundância: é
//    pra onde o e-mail de "cartão recusado" aponta. Link de e-mail precisa de URL; a tela
//    precisa de modal. Os dois abrem a MESMA superfície — a página só monta este modal.
//
// ⚠️ O titular é buscado AO ABRIR, não no render da página de assinatura. É uma consulta
//    que 99% das visitas não precisam, e a tela de assinatura já é a mais pesada do
//    produto (ela fala com o gateway).

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto";     titular: TitularPreenchido }
  | { fase: "incompleto"; faltam: string[] }
  | { fase: "sucesso";    bandeira: Bandeira | null; ultimos4: string | null }

export function CartaoModal({
  planoNome, valorCents, proximaCobranca, cartaoAtual, onClose,
}: {
  planoNome:       string
  valorCents:      number
  /** Já formatada pelo servidor. `null` = o gateway não informou. */
  proximaCobranca: string | null
  /** O cartão em uso hoje. `null` = assinatura anterior ao registro do rótulo. */
  cartaoAtual:     { bandeira: Bandeira | null; ultimos4: string } | null
  onClose:         () => void
}) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" })
  // 🔴 Governa a tranca do modal. Enquanto o banco não responde, não há X, não há ESC e
  //    não há clique-fora: quem fecha no meio da tokenização fica sem saber se trocou.
  const [pendente, setPendente] = useState(false)

  useEffect(() => {
    let vivo = true
    getTitularParaCobranca()
      .then((t) => {
        if (!vivo) return
        // ⚠️ O gateway EXIGE o titular completo pra tokenizar. Sem isso a pessoa digitaria
        //    o cartão inteiro pra receber um erro que a gente já sabia antes de ela começar.
        if (t?.completo) setEstado({ fase: "pronto", titular: t })
        else setEstado({ fase: "incompleto", faltam: t?.faltam ?? [] })
      })
      .catch(() => { if (vivo) setEstado({ fase: "incompleto", faltam: [] }) })
    return () => { vivo = false }
  }, [])

  const fechar = () => {
    // Só recarrega o servidor se algo mudou de fato — o rail da direita passa a mostrar o
    // cartão novo, e essa é a confirmação que fica depois que o modal some.
    if (estado.fase === "sucesso") router.refresh()
    onClose()
  }

  return (
    <ModalShell
      icon={CreditCard}
      title="Trocar cartão"
      desc={estado.fase === "sucesso" ? undefined : "Nada é cobrado agora"}
      size="checkout"
      mobileFullscreen
      closeButton
      dismissable={!pendente}
      flush={estado.fase === "pronto"}
      onClose={fechar}
      footer={estado.fase === "sucesso"
        ? <button type="button" onClick={fechar} className={`${BTN_PRIMARY} w-full h-11`}>Voltar para assinatura</button>
        : undefined}
      footerVariant="cta"
    >
      {estado.fase === "carregando" && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      )}

      {estado.fase === "incompleto" && (
        <div className="py-2">
          <h4 className="text-sm font-bold text-slate-900">Faltam alguns dados de faturamento</h4>
          <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
            Para atualizar o cartão ainda falta:{" "}
            <strong>{estado.faltam.length ? estado.faltam.join(", ") : "completar o cadastro"}</strong>.
          </p>
          <Link href="/configuracoes/empresa"
            className="mt-4 inline-flex items-center justify-center h-10 px-4 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold transition-colors">
            Completar cadastro
          </Link>
        </div>
      )}

      {estado.fase === "pronto" && (
        <CardForm
          modo="trocar"
          titular={estado.titular}
          planoNome={planoNome}
          valorCents={valorCents}
          proximaCobranca={proximaCobranca}
          cartaoAtual={cartaoAtual}
          onPendingChange={setPendente}
          onSucesso={({ bandeira, ultimos4 }) => setEstado({ fase: "sucesso", bandeira, ultimos4 })}
        />
      )}

      {estado.fase === "sucesso" && (
        // ⚠️ Ecoa o cartão que passou a valer — sem o eco, "pronto" é uma palavra que a
        //    pessoa tem que aceitar no escuro, na tela em que ela mais quer certeza.
        <div className="py-4 text-center">
          <CheckCircle2 className="size-8 text-emerald-600 mx-auto" />
          <h4 className="mt-3 text-base font-bold text-slate-900">Cartão atualizado</h4>
          {estado.ultimos4 && (
            <p className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <BandeiraLogo marca={estado.bandeira} size={22} />
              <span className="text-sm font-semibold text-slate-900 tabular-nums">···· {estado.ultimos4}</span>
            </p>
          )}
          <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
            Nada foi cobrado agora.{" "}
            {proximaCobranca
              ? <>Ele passa a valer na cobrança de <strong>{proximaCobranca}</strong>.</>
              : <>Ele passa a valer na próxima cobrança.</>}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
