"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react"
import { getTitularParaCobranca, getCobrancaEmAberto, type TitularPreenchido } from "@/lib/actions/subscription"
import { BandeiraLogo } from "@/components/billing/bandeira-logo"
import type { Bandeira } from "@/lib/billing/card-brand"
import { brl } from "../format"
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

/** O que o cliente deve agora — vem do GATEWAY na abertura, nunca da tela. */
interface CobrancaAberta { valorCents: number; vencimento: string | null; outras: number }

type Estado =
  | { fase: "carregando" }
  | { fase: "pronto";     titular: TitularPreenchido; cobranca: CobrancaAberta | null }
  | { fase: "incompleto"; faltam: string[] }
  | {
      fase: "sucesso"
      bandeira: Bandeira | null
      ultimos4: string | null
      /** Presente só quando houve regularização. Carrega os três desfechos. */
      regularizacao?: { pagoCents: number; cartaoTrocado: boolean; outras: number }
    }

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

  // 🔑 O MODO É DECIDIDO PELA REALIDADE, não por quem abriu o modal. Se existe cobrança em
  //    aberto no gateway, a tela vira "regularizar" — cobra agora e só então troca. Foi o
  //    dono que achou o problema (08/08): quem tinha fatura vencida caía no modo "trocar" e
  //    lia "Nada é cobrado agora", que é o oposto do que ele quer.
  // ⚠️ As duas consultas em paralelo, na ABERTURA. Fazer isso no render da tela de
  //    assinatura custaria uma chamada ao gateway em toda visita, pra um modal que quase
  //    nunca abre.
  useEffect(() => {
    let vivo = true
    Promise.all([getTitularParaCobranca(), getCobrancaEmAberto().catch(() => null)])
      .then(([t, c]) => {
        if (!vivo) return
        // ⚠️ O gateway EXIGE o titular completo pra tokenizar. Sem isso a pessoa digitaria
        //    o cartão inteiro pra receber um erro que a gente já sabia antes de ela começar.
        if (t?.completo) setEstado({ fase: "pronto", titular: t, cobranca: c ?? null })
        else setEstado({ fase: "incompleto", faltam: t?.faltam ?? [] })
      })
      .catch(() => { if (vivo) setEstado({ fase: "incompleto", faltam: [] }) })
    return () => { vivo = false }
  }, [])

  // O cabeçalho tem que contar a MESMA história do botão. Enquanto carrega, ninguém sabe
  // ainda se há cobrança — e a resposta honesta nesse instante é não afirmar nada.
  const temCobranca = estado.fase === "pronto" && !!estado.cobranca

  const fechar = () => {
    // Só recarrega o servidor se algo mudou de fato — o rail da direita passa a mostrar o
    // cartão novo, e essa é a confirmação que fica depois que o modal some.
    if (estado.fase === "sucesso") router.refresh()
    onClose()
  }

  return (
    <ModalShell
      icon={CreditCard}
      // 🔴 O CABEÇALHO MENTIA (M-04.2 do pentest de 08/08). O modo passou a ser decidido
      //    pela realidade e o botão passou a dizer "Pagar R$ X" — mas o título seguiu
      //    "Trocar cartão · Nada é cobrado agora", INCONDICIONAL, contradizendo o botão
      //    logo abaixo. Ou seja: eu corrigi a mentira que o dono apontou e deixei a mesma
      //    frase no topo, 29 linhas abaixo do comentário que celebra a correção.
      title={temCobranca ? "Regularizar pagamento" : "Trocar cartão"}
      desc={estado.fase === "sucesso"
        ? undefined
        : temCobranca ? "Cobramos agora neste cartão" : "Nada é cobrado agora"}
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
        estado.cobranca ? (
          <CardForm
            modo="regularizar"
            titular={estado.titular}
            planoNome={planoNome}
            valorCents={estado.cobranca.valorCents}
            vencimento={estado.cobranca.vencimento}
            outras={estado.cobranca.outras}
            cartaoAtual={cartaoAtual}
            onPendingChange={setPendente}
            onSucesso={({ bandeira, ultimos4, regularizacao }) => setEstado({ fase: "sucesso", bandeira, ultimos4, regularizacao })}
          />
        ) : (
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
        )
      )}

      {estado.fase === "sucesso" && (
        // ⚠️ Ecoa o cartão que passou a valer — sem o eco, "pronto" é uma palavra que a
        //    pessoa tem que aceitar no escuro, na tela em que ela mais quer certeza.
        <div className="py-4 text-center">
          <CheckCircle2 className="size-8 text-emerald-600 mx-auto" />
          <h4 className="mt-3 text-base font-bold text-slate-900">
            {estado.regularizacao ? "Pagamento confirmado" : "Cartão atualizado"}
          </h4>
          {estado.ultimos4 && (
            <p className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
              <BandeiraLogo marca={estado.bandeira} size={22} />
              <span className="text-sm font-semibold text-slate-900 tabular-nums">···· {estado.ultimos4}</span>
            </p>
          )}

          {/* 🔴 TRÊS DESFECHOS, TRÊS FRASES. Colapsar em "pronto" esconderia justamente o
              caso que precisa de ação: pagou, mas a assinatura seguiu no cartão velho. */}
          {estado.regularizacao ? (
            <div className="mt-2.5 space-y-2 text-sm text-slate-600 leading-relaxed">
              <p>
                Cobramos <strong>{brl(estado.regularizacao.pagoCents)}</strong> neste cartão.
                {estado.regularizacao.cartaoTrocado
                  ? <> Ele passa a valer também nas próximas cobranças.</>
                  : null}
              </p>

              {!estado.regularizacao.cartaoTrocado && (
                <p className="text-amber-900 bg-warning-bg border border-amber-200 rounded-lg px-3 py-2 text-xs">
                  <strong>O pagamento entrou</strong>, mas não conseguimos deixar este cartão
                  como o da assinatura — as próximas cobranças ainda vão no anterior. Tente a
                  troca de novo daqui a pouco ou fale com a gente.
                </p>
              )}

              {estado.regularizacao.outras > 0 && (
                <p className="text-xs text-slate-500">
                  Ainda {estado.regularizacao.outras === 1 ? "resta" : "restam"}{" "}
                  <strong>{estado.regularizacao.outras}</strong>{" "}
                  {estado.regularizacao.outras === 1 ? "cobrança em aberto" : "cobranças em aberto"} — abra esta tela de novo para quitar.
                </p>
              )}

              {/* ⚠️ "Liberado" quem diz é o webhook, que chega segundos depois. Afirmar aqui
                  seria prometer um estado que o servidor ainda não tem. */}
              <p className="text-[11px] text-slate-400">A liberação do produto leva alguns segundos.</p>
            </div>
          ) : (
            <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
              Nada foi cobrado agora.{" "}
              {proximaCobranca
                ? <>Ele passa a valer na cobrança de <strong>{proximaCobranca}</strong>.</>
                : <>Ele passa a valer na próxima cobrança.</>}
            </p>
          )}
        </div>
      )}
    </ModalShell>
  )
}
