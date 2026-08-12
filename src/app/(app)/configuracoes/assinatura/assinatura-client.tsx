"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, CalendarClock, Check, CreditCard, Download, Loader2, MessageCircle, Pause, Receipt, XCircle } from "lucide-react"
import { retomarAssinatura } from "@/lib/actions/subscription"
import { SectionCard } from "@/components/ui/section-card"
import { linkSuporte } from "@/lib/support"
import { brl, dataCurta, dataLonga, num } from "./format"
import type { AssinaturaMock } from "./mock"
import { StandingHero } from "./components/standing-hero"
import { PagarModal } from "./components/pagar-modal"
import { CancelarModal } from "./components/cancelar-modal"
import { CaberNoPlanoModal } from "./components/caber-no-plano-modal"
import { BloqueioTotal } from "./components/bloqueio-total"
import { CartaoModal } from "./components/cartao-modal"
import { BandeiraLogo } from "@/components/billing/bandeira-logo"

// ═══════════════════════════════════════════════════════════════
// B1 · Minha assinatura
// ═══════════════════════════════════════════════════════════════
// DECISÃO DE UX (o porquê, não o quê):
//
// • O TOPO É UMA FRASE E UMA DATA. Ver `standing-hero.tsx` — a regra inteira
//   mora lá. Aqui o compromisso é: nada acima dela, nada do lado dela que
//   compita. O que veio depois é tudo subordinado.
//
// • "O QUE ESTÁ INCLUSO" EM LINGUAGEM DE RESULTADO. O cliente contratou
//   "Campanhas" e "Agenda", não `broadcasts` e `agenda_reminders`. Nome interno
//   de módulo numa tela de assinatura tem dois efeitos ruins: ele não reconhece
//   o que está pagando, e quando algo é pausado ele não sabe o que perdeu. A
//   lista vem do contrato (`continues`/`paused`) justamente pra a tradução
//   acontecer ANTES de chegar aqui.
//
// • O QUE CONTINUA VEM ANTES DO QUE PAROU. Em qualquer degrau. O pânico de quem
//   está atrasado é "perdi meu histórico" — responder isso primeiro é o que
//   mantém a conversa sobre pagamento, e não sobre cancelamento.
//
// • A CONTA DO MÊS É UMA LINHA, NÃO UM DEMONSTRATIVO. Plano + o que variou +
//   total, ancorados à direita. Quem quer auditar clica em Consumo ou na
//   fatura; quem só quer saber "vai dar quanto?" já sabe aqui.
//
// • O RAIL DIREITO É UM PAINEL CONTÍNUO com divisórias, não três cartões
//   flutuando. Cara de extrato, que é o que ele é.

export function AssinaturaClient({ mock, abrirCartao = false, preview = false }: {
  mock: AssinaturaMock
  /** Chegou por `?cartao=1` (link do e-mail de cobrança recusada) — já abre o modal. */
  abrirCartao?: boolean
  /**
   * Modo `?degrau=` (platform admin revisando os 5 degraus com dados fictícios).
   *
   * 🔴 Aqui o modal de cartão NÃO abre. O mock diz "Mastercard ···· 4242", mas
   *    `trocarCartaoDaAssinatura` agiria sobre o cartão REAL do tenant da sessão do admin —
   *    dado fictício em cima de ação verdadeira, numa tela de dinheiro.
   */
  preview?: boolean
}) {
  const { standing, incluso, cobranca, temAssinatura, cartao, cancelamento, resumo, conta, medidas, faturaAberta } = mock
  const router = useRouter()
  const [retomando, iniciarRetomada] = useTransition()

  // ⚠️ `router.refresh()` e não estado local: retomar muda o cartão exibido, o botão de
  //    trocar cartão, a data da próxima cobrança e a faixa inteira. Espelhar isso à mão no
  //    cliente criaria uma segunda verdade que diverge da do servidor no primeiro detalhe
  //    esquecido — e a tela que ela desenharia é justamente a de dinheiro.
  function retomar() {
    iniciarRetomada(async () => {
      const r = await retomarAssinatura()
      if (r.error) { toast.error(r.error); return }
      toast.success("Assinatura retomada. Sua próxima cobrança volta na data de sempre.")
      router.refresh()
    })
  }
  // ⚠️ `temAssinatura` gateia a abertura automática: sem assinatura não há cartão pra
  //    trocar, e abrir o modal mesmo assim pediria o dado mais sensível do produto sem
  //    destino nenhum. Quem não tem, contrata.
  const [modal, setModal] = useState<null | "pagar" | "plano" | "cartao" | "cancelar">(
    abrirCartao && temAssinatura && !preview ? "cartao" : null,
  )
  const [bloqueio, setBloqueio] = useState(standing.degrau === "readonly")

  // 🔴 ISTO ERA UM `toast` COM `TODO` (M-04.5 do pentest de 08/08). O botão dizia
  //    *"estamos preparando seu arquivo — você recebe o link por e-mail"* e **nada era
  //    preparado, nenhum e-mail saía**. Não é feature faltando: é o produto afirmando um
  //    direito do Art. 18 II, na tela de quem está decidindo ir embora, e não cumprindo.
  //    Pior, a lista do que "continua funcionando" em TODOS os degraus inclui "Exportação
  //    dos seus dados" — a promessa aparecia até no paywall.
  //
  // 🔑 A exportação por tenant não existe (o `exportPersonalData` do `lgpd.ts` é por
  //    CONTATO — o consumidor final, outro titular). E o processo real já foi definido
  //    pelo dono: *"ele solicita isso ao suporte"*. Então a correção não é fingir um
  //    download: é abrir o canal que de fato atende, com o pedido pronto.
  // ⚠️ Quando a exportação automática existir, este handler troca de corpo e a tela não
  //    muda — o botão já está no lugar certo, dizendo a coisa certa.
  const exportar = () => {
    window.open(
      linkSuporte("Olá! Quero solicitar a exportação dos dados da minha conta na Kora (LGPD)."),
      "_blank", "noopener,noreferrer",
    )
  }

  return (
    <>
      <div className="space-y-4">
        <StandingHero
          standing={standing}
          conta={conta}
          cobranca={cobranca}
          cancelamento={cancelamento}
          planoNome={resumo.planoNome}
          formaPagamento={resumo.formaPagamento}
          cicloDia={resumo.cicloDia}
          onPagar={() => setModal("pagar")}
          onExportar={exportar}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
          {/* ── Coluna principal ── */}
          <div className="min-w-0 space-y-4">
            {/* 🔴 A LISTA VINHA DE `standing.continues` e o card ficava VAZIO em conta
                saudável (print do dono, 05/08). São perguntas diferentes: `continues` é
                "o que ainda funciona apesar do problema" — vazio quando nada foi cortado —,
                e o título promete "o que sua assinatura te deixa fazer". Cliente pagante
                via um título com nada embaixo, na tela que justifica a mensalidade.
                ⚠️ Em degrau degradado as duas listas convivem: `incluso` mostra o que ele
                tem, `paused` risca o que parou. */}
            {(incluso.length > 0 || standing.paused.length > 0) && (
            <SectionCard
              title="O que está incluso"
              description="O que sua assinatura te deixa fazer hoje"
            >
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {incluso.map((item) => (
                  <li key={item} className="flex items-center gap-2 py-0.5">
                    <Check className="size-4 text-emerald-600 shrink-0" strokeWidth={2.5} />
                    <span className="text-sm text-slate-700">{item}</span>
                  </li>
                ))}
                {standing.paused.map((item) => (
                  <li key={item} className="flex items-center gap-2 py-0.5">
                    <Pause className="size-4 text-red-500 shrink-0" strokeWidth={2.5} />
                    <span className="text-sm text-slate-400 line-through decoration-slate-300">{item}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-px">
                      pausado
                    </span>
                  </li>
                ))}
              </ul>

              {standing.paused.length > 0 && (
                <p className="text-xs text-slate-500 mt-4 pt-3.5 border-t border-slate-100 leading-relaxed">
                  Volta sozinho assim que o pagamento cair — nada precisa ser reconfigurado, e as
                  campanhas agendadas seguem na fila.
                </p>
              )}
            </SectionCard>
            )}

            {/* Prévia do consumo — glance, não relatório. A profundidade é a aba Consumo. */}
            <SectionCard
              title="Seu consumo até aqui"
              description={conta.fechaEm ? `Ciclo fecha em ${dataLonga(conta.fechaEm)}` : undefined}
              actions={
                <Link
                  href="/configuracoes/assinatura/consumo"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  Ver consumo <ArrowRight className="size-3.5" />
                </Link>
              }
              flush
            >
              <div className="divide-y divide-slate-100">
                {medidas.map((m) => {
                  const vira = m.excedenteCents > 0 || m.projecaoCents > 0
                  return (
                    <div key={m.key} className="px-5 py-3 flex items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800">{m.label}</p>
                        <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                          {num(m.usado)} de {m.cota == null ? "ilimitado" : num(m.cota)} {m.unidade}s incluídos
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${vira ? "text-slate-900" : "text-slate-400"}`}>
                          {brl(m.excedenteCents)}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {m.excedenteCents > 0 ? "de excedente" : m.projecaoCents > 0 ? `~${brl(m.projecaoCents)} no ritmo atual` : "sem excedente"}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          </div>

          {/* ── Rail direito: UM painel, seções por divisória ── */}
          <aside className="bg-white rounded-xl border border-slate-200 shadow-card divide-y divide-slate-100">
            {/* ── CANCELAMENTO EM ANDAMENTO (11/08) ────────────────────────
                🔴 A TELA NÃO DIZIA NADA. Depois de cancelar, recarregar mostrava a mesma
                   página de sempre — nenhuma menção ao pedido, nenhuma data. A única prova
                   era um toast que some. Numa tela de dinheiro, estado sem vestígio é o
                   que produz o "cancelei e continuaram cobrando" (mesmo sem cobrança).
                🔑 PRIMEIRA SEÇÃO DO RAIL, de propósito: é o fato mais consequente da conta
                   agora, e a pergunta que ele traz ("até quando eu tenho?") é respondida
                   pela data, que é o herói desta caixa.
                ⚠️ Âmbar, não vermelho: nada está quebrado nem atrasado — ele está em dia,
                   com tudo funcionando, até uma data. Vermelho aqui seria alarme falso. */}
            {cancelamento && !preview && (
              <div className="px-5 py-4 bg-amber-50/60">
                <div className="flex items-start gap-2.5">
                  <CalendarClock className="size-4 mt-0.5 shrink-0 text-amber-600" strokeWidth={2.25} />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900">Assinatura cancelada</h2>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Não haverá nova cobrança. Você continua com tudo até{" "}
                      <span className="font-semibold text-slate-900">
                        {dataLonga(cancelamento.ateQuando.slice(0, 10))}
                      </span>.
                    </p>
                  </div>
                </div>
                {/* 🔑 SAIR E VOLTAR CUSTAM O MESMO. O cartão dele continua guardado até a
                    data (é por isso que o `manterCartaoAteOFim` existe), então voltar atrás
                    é um clique — não digitar cartão de novo. E não cobra nada: a
                    recorrência volta pro dia em que cairia se ele nunca tivesse cancelado. */}
                {/* 🔴 O BOTÃO SÓ APARECE PRA QUEM PODE USÁ-LO (furo fechado em 12/08). Quando o
                    cancelamento foi decisão NOSSA (god mode), o motor recusa a retomada — e
                    até aqui a tela oferecia o botão mesmo assim. Botão que existe pra dar
                    erro é pior que botão ausente: promete uma saída e devolve uma parede.
                    ⚠️ A régua é a MESMA do motor (`subscription_ended_reason === 'pedido_do_cliente'`,
                       resolvida em `subscription-view`). Se as duas divergirem, uma delas
                       mente na cara do cliente. */}
                {cancelamento.podeRetomar ? (
                  <>
                    <button
                      type="button"
                      onClick={retomar}
                      disabled={retomando}
                      className="w-full mt-3 h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {retomando && <Loader2 className="size-3.5 animate-spin" />}
                      Retomar assinatura
                    </button>
                    <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                      {cartao
                        ? `Voltamos a cobrar no cartão ···· ${cartao.ultimos4}, só na próxima data do seu ciclo. Nada é cobrado agora.`
                        : "A cobrança volta só na próxima data do seu ciclo. Nada é cobrado agora."}
                    </p>
                  </>
                ) : (
                  /* ⚠️ Não diz "você não pode" — diz o caminho que existe. O cliente não tem
                     como saber (nem precisa) que a decisão partiu da nossa operação. */
                  <a
                    href={linkSuporte("Olá! Gostaria de reativar a assinatura da minha conta Kora.")}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full mt-3 h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                  >
                    <MessageCircle className="size-3.5" /> Falar sobre a reativação
                  </a>
                )}
              </div>
            )}

            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">
                {conta.fechaEm ? `Sua conta de ${dataLonga(conta.fechaEm).split(" de ")[1]}` : "Sua conta do mês"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {conta.fechaEm ? `Fecha em ${dataLonga(conta.fechaEm)} — ainda pode mudar até lá.` : "Parcial do ciclo corrente."}
              </p>

              <div className="mt-3.5 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-slate-600">{conta.planoLabel}</span>
                  <span className="text-xs font-semibold text-slate-700 tabular-nums">{brl(conta.planoCents)}</span>
                </div>
                {conta.extras.map((e) => (
                  <div key={e.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-slate-600">{e.label}</span>
                    <span className="text-xs font-semibold text-slate-700 tabular-nums">{brl(e.cents)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t border-slate-100">
                {/* ⚠️ ERA "Parcial", e a palavra ficou AMBÍGUA em 08/08: `partial` virou um
                    STATUS DE FATURA de verdade ("recebemos parte do que era devido"), e ele
                    aparece com esse mesmo rótulo nas telas de fatura. Aqui o sentido é
                    outro — é o total acumulado do ciclo, que ainda pode mudar. Dois
                    significados com o mesmo nome, na mesma área do produto, é confusão de
                    suporte esperando acontecer. */}
                <span className="text-xs font-semibold text-slate-500">Total até aqui</span>
                <span className="text-xl font-bold text-slate-900 tabular-nums">{brl(conta.totalCents)}</span>
              </div>

              <button
                type="button"
                onClick={() => setModal("plano")}
                className="w-full mt-3.5 h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors"
              >
                Quero caber no plano
              </button>
            </div>

            <div className="px-5 py-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pagamento</h2>
              <dl className="mt-2.5 space-y-2">
                {/* 🔑 A marca ao lado do rótulo responde "qual dos meus cartões é esse?"
                    numa olhada. `formaPagamento` já vem com bandeira + 4 dígitos de
                    `subscription-view`; aqui só se acrescenta o retrato. */}
                <Row termo="Forma" valor={resumo.formaPagamento}
                  icone={cartao ? <BandeiraLogo marca={cartao.bandeira} size={16} /> : null} />
                <Row termo="Cobrança" valor={resumo.cicloDia ? `todo dia ${resumo.cicloDia}` : "a definir"} />
                <Row termo="Nota e aviso" valor={resumo.emailCobranca} />
              </dl>
              <div className="mt-3 flex flex-col gap-2 items-start">
                <Link
                  href="/configuracoes/assinatura/faturas"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700"
                >
                  <Receipt className="size-3.5" /> Ver faturas e comprovantes
                </Link>
                {/* 🔑 A PORTA QUE NÃO EXISTIA (07/08). Sem ela, cliente com cartão vencido
                    não tinha onde agir: o gateway recusava a renovação, a escada cortava o
                    produto, e a saída era ligar pro suporte. Fica aqui, ao lado da forma
                    de pagamento — que é onde a pessoa vai procurar.
                    ⚠️ Só aparece com assinatura de verdade no gateway: pra quem é faturado
                    à mão ou ainda não contratou, não há cartão nosso pra trocar. */}
                {/* ⚠️ MODAL, não navegação (07/08). Sair da tela pra trocar 4 campos custa
                    o contexto inteiro — e o contexto aqui é a linha que acabou de dizer que
                    a cobrança falhou. A rota continua existindo pro link do e-mail. */}
                {temAssinatura && !preview && (
                  <button
                    type="button"
                    onClick={() => setModal("cartao")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700"
                  >
                    <CreditCard className="size-3.5" /> Trocar cartão
                  </button>
                )}
              </div>
            </div>

            {faturaAberta && (
              <div className="px-5 py-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Fatura em aberto</h2>
                <div className="flex items-baseline justify-between gap-3 mt-2.5">
                  <span className="text-xs text-slate-600">{faturaAberta.referencia}</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{brl(faturaAberta.totalCents)}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">venceu em {dataCurta(faturaAberta.vencimento)}</p>
                <Link
                  href={`/configuracoes/assinatura/faturas/${faturaAberta.id}`}
                  className="w-full mt-3 h-9 inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors"
                >
                  Abrir fatura
                </Link>
              </div>
            )}

            <div className="px-5 py-4">
              <button
                type="button"
                onClick={exportar}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                {/* ⚠️ "Solicitar", não "Baixar" — não existe download imediato. Eu corrigi
                    esse texto ontem no outro ponto da mesma tela e não varri este: mesma
                    classe de erro do dia (fechar onde se achou, não varrer os irmãos). */}
                <Download className="size-3.5" /> Solicitar meus dados
              </button>
              <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                Disponível sempre, em qualquer situação da conta — nossa equipe prepara e envia.
              </p>
              {/* Contato vem de `lib/support` — número em UM lugar só. WhatsApp, e não
                  e-mail, por coerência: a Kora vende atendimento por WhatsApp. */}
              <a
                href={linkSuporte("Olá! Tenho uma dúvida sobre a cobrança da minha conta Kora.")}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 mt-3"
              >
                <MessageCircle className="size-3.5" /> Falar sobre a cobrança
              </a>

              {/* ── A PORTA DE SAÍDA (11/08) ─────────────────────────────────
                  🔴 Ela não existia. Pra cancelar, a pessoa entrava no painel do gateway
                     ou ligava — e saída escondida não retém cliente, empurra pro
                     chargeback: ele perde tempo, nós perdemos o dinheiro E a taxa.
                  🔑 DISCRETA, MAS PRESENTE. Não é botão vermelho gritando (seria hostil
                     com quem só foi ver o cartão), nem link escondido (seria a armadilha
                     que gera a disputa). Mesmo peso de "Solicitar meus dados" — ação de
                     conta, ao lado das outras, achável por quem procura.
                  ⚠️ Só com assinatura de verdade: quem é faturado à mão fala com a gente. */}
              {temAssinatura && !preview && (
                <button
                  type="button"
                  onClick={() => setModal("cancelar")}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 mt-3 transition-colors"
                >
                  <XCircle className="size-3.5" /> Cancelar assinatura
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* ── Modais ── */}
      <CancelarModal
        open={modal === "cancelar"}
        onClose={() => setModal(null)}
        planoNome={conta.planoLabel}
        cicloFechaEm={conta.fechaEm}
        onCancelado={(ate) => {
          toast.success(
            ate
              ? `Assinatura cancelada. Seu acesso continua até ${dataLonga(ate.slice(0, 10))}.`
              : "Assinatura cancelada.",
          )
          // ⚠️ Sem isto o toast some e a tela fica IDÊNTICA à de antes do cancelamento —
          //    o mesmo buraco que a faixa do rail veio tapar. O refresh é o que faz a
          //    faixa (e o botão de retomar) aparecerem no mesmo segundo.
          router.refresh()
        }}
      />

      {modal === "pagar" && faturaAberta && (
        <PagarModal
          totalCents={faturaAberta.totalCents}
          vencimento={faturaAberta.vencimento}
          referencia={faturaAberta.referencia}
          pixCopiaECola={faturaAberta.pixCopiaECola}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "cartao" && (
        <CartaoModal
          planoNome={resumo.planoNome}
          // 🔑 Valor e data vêm do GATEWAY quando ele responde — é ele quem debita. O preço
          //    de tabela é o piso: se o plano mudou de preço sem `PUT` na assinatura, o
          //    cartão continua sendo cobrado pelo valor velho, e a tela tem que dizer o que
          //    vai acontecer de verdade, não o que o catálogo diz hoje.
          valorCents={cobranca?.valorCents ?? conta.planoCents}
          proximaCobranca={cobranca?.proximaEm ? dataLonga(cobranca.proximaEm) : null}
          cartaoAtual={cartao}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "plano" && (
        <CaberNoPlanoModal
          medidas={medidas}
          gastoAtualCents={conta.totalCents}
          planoAtualCents={conta.planoCents}
          onClose={() => setModal(null)}
        />
      )}

      {bloqueio && (
        <BloqueioTotal
          standing={standing}
          onPagar={() => { setBloqueio(false); setModal("pagar") }}
          onContinuar={() => setBloqueio(false)}
          onExportar={exportar}
        />
      )}
    </>
  )
}

function Row({ termo, valor, icone }: { termo: string; valor: string; icone?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-500 shrink-0">{termo}</dt>
      <dd className="text-xs font-medium text-slate-700 truncate flex items-center gap-1.5 min-w-0">
        {icone}<span className="truncate">{valor}</span>
      </dd>
    </div>
  )
}
