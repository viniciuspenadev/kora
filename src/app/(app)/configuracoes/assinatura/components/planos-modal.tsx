"use client"

import Link from "next/link"
import { useState, useTransition, useRef, useEffect } from "react"
import { Check, X, Loader2, AlertCircle, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react"
import { escolherPlano, getMyBillingStanding } from "@/lib/actions/subscription"
import type { PlanoVitrine } from "@/lib/billing/plans-view"
import { CATEGORIA_LABEL } from "@/lib/modules-shared"
import { CadastroRapido } from "./cadastro-rapido"
import { CardForm } from "../pagamento/card-form"
import type { PerfilEmpresa } from "@/lib/actions/company-profile"
import type { TitularPreenchido } from "@/lib/actions/subscription"
import { SourceLogo } from "@/components/chat/source-logo"

// ═══════════════════════════════════════════════════════════════
// Modal de planos — PERSISTENTE quando o teste acabou
// ═══════════════════════════════════════════════════════════════
// 🔴 SEM BOTÃO DE FECHAR, sem clique-fora, sem ESC — e isso é decisão, não descuido
//    (dono, 2026-08-05). Nos outros modais do produto o escape é obrigatório: a pessoa
//    está no meio do trabalho dela. Aqui não há trabalho pra voltar — o produto está
//    parado, e um "X" no canto ofereceria uma saída que não existe. Fechar levaria a
//    uma tela que também diz "seu teste acabou": duas telas dizendo o mesmo, uma delas
//    fingindo que há para onde ir.
//
// ⚠️ O catálogo vem do GOD MODE (`plans`, ativo e com preço). Zero preço hardcoded aqui —
//    foi exatamente assim que o modal anterior acabou anunciando um "Enterprise R$ 599,00"
//    que não existia na base.

type Passo = "planos" | "cadastro" | "pagamento" | "pronto"

export function PlanosModal({
  planos, podeAssinar, perfil, titular, primeiraCobranca, bloqueante = true,
}: {
  planos: PlanoVitrine[]
  /** Cadastro fiscal completo? Sem ele a tokenização do cartão falha. */
  podeAssinar: boolean
  /** Estado atual do cadastro — alimenta o passo de cadastro rápido. */
  perfil: PerfilEmpresa
  /** Titular pra pré-preencher o cartão. `null` = cadastro incompleto. */
  titular: TitularPreenchido | null
  /** Data da 1ª cobrança, já formatada. */
  primeiraCobranca: string | null
  /**
   * `true` = o teste ACABOU e esta é a única tela (sem saída, por decisão do dono).
   * `false` = a pessoa veio escolher um plano por vontade própria, ainda dentro do teste —
   * e prender quem ainda tem produto pra usar seria transformar uma visita ao catálogo em
   * sequestro. Muda o texto e devolve a saída.
   */
  bloqueante?: boolean
}) {
  const [pending, startT] = useTransition()
  const [erro, setErro] = useState("")
  const [escolhido, setEscolhido] = useState<string | null>(null)

  // ── A trilha ──────────────────────────────────────────────────────────────
  // 🔑 TUDO NO MODAL (dono, 2026-08-05). Antes, escolher um plano NAVEGAVA para outra
  //    página — e a pessoa perdia o contexto da compra no meio dela. Pior: mandava para o
  //    cadastro mesmo quem já o tinha completo (bug do `podeAssinar`, corrigido no
  //    `standing`). Aqui a compra começa e termina no mesmo lugar.
  // ⚠️ O passo de cadastro só existe quando falta cadastro. Quem já tem vai direto ao
  //    cartão — um passo a mais numa compra é uma chance a mais de desistir.
  const [passo, setPasso] = useState<Passo>("planos")
  // `null` = ainda confirmando com o gateway. Ver o efeito logo abaixo.
  const [liberado, setLiberado] = useState<boolean | null>(null)
  const [planoEscolhido, setPlanoEscolhido] = useState<PlanoVitrine | null>(null)
  const [cadastroOk, setCadastroOk] = useState(podeAssinar)

  // ── Trilho horizontal ────────────────────────────────────────────────────
  // O índice visível sai da POSIÇÃO DE ROLAGEM, não de um estado que a bolinha escreve:
  // assim arrastar com o dedo e clicar na bolinha contam a mesma história. Estado próprio
  // dessincronizaria no primeiro swipe.
  const trilho = useRef<HTMLDivElement | null>(null)
  const [visivel, setVisivel] = useState(0)
  // 🔴 MEDIDO, NÃO PRESUMIDO. A 1ª versão mostrava a navegação só com `planos.length > 3`,
  //    presumindo que 3 sempre cabem. Não cabem: depende da largura do modal e da tela.
  //    Com 3 planos o trilho estourava e **não havia como chegar no terceiro**.
  //    Agora quem decide é o próprio DOM: sobra conteúdo ⇒ tem navegação.
  const [temOverflow, setTemOverflow] = useState(false)
  const [noFim, setNoFim] = useState(false)

  useEffect(() => {
    const el = trilho.current
    if (!el) return
    const medir = () => {
      const sobra = el.scrollWidth - el.clientWidth
      setTemOverflow(sobra > 8)   // 8px de folga: arredondamento de layout não é overflow
      setNoFim(el.scrollLeft >= sobra - 8)
    }
    medir()
    // Redimensionar a janela muda quantos cabem — a navegação tem que aparecer/sumir junto.
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [planos.length])

  function aoRolar() {
    const el = trilho.current
    if (!el) return
    const card = el.firstElementChild as HTMLElement | null
    if (!card) return
    // +gap: a largura de um passo do snap é o card MAIS o respiro entre eles.
    const passo = card.offsetWidth + 16
    setVisivel(Math.round(el.scrollLeft / passo))
    setNoFim(el.scrollLeft >= el.scrollWidth - el.clientWidth - 8)
  }

  /** Rola um card por vez. Setas são o gesto de desktop; bolinha é leitura, não comando. */
  function passar(dir: -1 | 1) {
    const el = trilho.current
    if (!el) return
    const card = el.firstElementChild as HTMLElement | null
    if (!card) return
    el.scrollBy({ left: dir * (card.offsetWidth + 16), behavior: "smooth" })
  }

  function irPara(i: number) {
    const el = trilho.current
    if (!el) return
    const card = el.firstElementChild as HTMLElement | null
    if (!card) return
    el.scrollTo({ left: i * (card.offsetWidth + 16), behavior: "smooth" })
  }

  // ── Esperar a CONFIRMAÇÃO do pagamento, não só o envio do cartão ────────────────
  //
  // 🔴 Antes, esta tela dizia "Assinatura ativada" no instante em que o cartão era
  //    aceito — e mandava a pessoa pro /inbox. Mas criar assinatura ≠ pagamento
  //    confirmado: quem libera o produto é o webhook do gateway (`liberar()`), que chega
  //    segundos depois. No intervalo, o gate do servidor ainda vê `trial_ended` e
  //    devolve a pessoa pro paywall — ou seja, ela pagava, era parabenizada, clicava em
  //    "voltar a usar" e caía de novo na tela de pagar. Com o dinheiro já debitado.
  // 🔑 Agora a tela PERGUNTA até o servidor confirmar, e o botão só aparece quando o
  //    acesso é real. É a mesma fonte que o layout usa pra decidir — se ela diz liberado,
  //    o /inbox abre.
  // ⚠️ Teto de ~60s. Se o webhook atrasar mais que isso a tela para de girar e explica —
  //    girar pra sempre faria a pessoa achar que o pagamento falhou e pagar de novo.
  useEffect(() => {
    if (passo !== "pronto" || liberado) return
    let vivo = true
    let tentativas = 0
    const t = setInterval(async () => {
      tentativas++
      const st = await getMyBillingStanding()
      if (!vivo) return
      if (st && st.degrau !== "trial_ended") { setLiberado(true); clearInterval(t); return }
      if (tentativas >= 20) { setLiberado(false); clearInterval(t) }
    }, 3000)
    return () => { vivo = false; clearInterval(t) }
  }, [passo, liberado])

  function escolher(planoId: string) {
    setErro(""); setEscolhido(planoId)
    startT(async () => {
      const r = await escolherPlano(planoId)
      if (r.error) { setErro(r.error); setEscolhido(null); return }
      setPlanoEscolhido(planos.find((p) => p.id === planoId) ?? null)
      // ⚠️ Sem cadastro fiscal a tokenização falharia com o cartão já digitado. O desvio
      //    para o cadastro acontece AQUI dentro, não em outra página.
      setPasso(cadastroOk ? "pagamento" : "cadastro")
    })
  }

  return (
    // ⚠️ SEM rolagem de página (correção do dono, 2026-08-05). O modal cresceu com o
    //    conteúdo e empurrou o CTA pra fora da tela — numa tela cujo único objetivo é
    //    fazer a pessoa clicar em "Assinar". Agora ele se ancora na ALTURA DA JANELA e
    //    quem rola é o miolo de cada card, com cabeçalho e botão fixos.
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm">
      <div className="h-full flex items-center justify-center p-4">
        {/* max-w-6xl: 3 cards de 20rem + gaps = 992px; com o padding do modal isso exige
            ~1056px. Em `max-w-4xl` (896px) três planos JÁ estouravam — e a navegação
            estava gateada em `> 3`, então não havia nem seta nem bolinha pra alcançar
            o terceiro. Cabiam dois; o resto era inalcançável. */}
        <div className="relative w-full max-w-6xl max-h-full flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">

          <header className="shrink-0 px-6 sm:px-8 pt-6 pb-4 border-b border-slate-100">
            {/* ⚠️ A saída existe SÓ no modo não-bloqueante, e some depois que o cartão passa
                (`pronto`): fechar em cima do sucesso deixaria a pessoa sem saber se pagou. */}
            {!bloqueante && passo !== "pronto" && (
              <Link href="/configuracoes/assinatura" aria-label="Fechar"
                className="absolute right-4 top-4 size-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 inline-flex items-center justify-center transition-colors">
                <X className="size-4" />
              </Link>
            )}
            <div className="flex items-start gap-3">
              {/* Voltar existe a partir do 2º passo — e SÓ até o pagamento passar.
                  Depois de cobrado o cartão não há "voltar": o dinheiro já saiu. */}
              {(passo === "cadastro" || passo === "pagamento") && (
                <button type="button"
                  onClick={() => setPasso(passo === "pagamento" && !cadastroOk ? "cadastro" : "planos")}
                  className="mt-0.5 size-7 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 inline-flex items-center justify-center transition-colors"
                  aria-label="Voltar">
                  <ChevronLeft className="size-4" />
                </button>
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                  {passo === "planos"    ? (bloqueante ? "Seu teste terminou" : "Escolha seu plano")
                   : passo === "cadastro" ? "Falta só o cadastro"
                   : passo === "pagamento" ? `Assinar ${planoEscolhido?.nome ?? ""}`.trim()
                   : "Tudo certo!"}
                </h1>
                <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
                  {passo === "planos"    ? (bloqueante
                       ? "Escolha um plano para voltar a usar o Kora. Suas conversas, contatos e configurações estão intactos — nada precisa ser refeito."
                       : "Seu teste continua até a data do resumo. Ao assinar, a cobrança só começa quando ele terminar.")
                   : passo === "cadastro" ? "São os dados que a nota fiscal e o cartão exigem."
                   : passo === "pagamento" ? "O pagamento é processado com criptografia. Não guardamos o número do seu cartão."
                   : "Sua assinatura está ativa e o Kora voltou a funcionar."}
                </p>
              </div>
            </div>
          </header>

          <div className="flex-1 min-h-0 flex flex-col px-6 sm:px-8 py-5">
            {passo !== "planos" ? (
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
                <div className="max-w-lg mx-auto">
                  {passo === "cadastro" && (
                    <CadastroRapido
                      inicial={perfil}
                      onPronto={() => {
                        // ⚠️ Marca aqui em vez de recarregar a página: o `podeAssinar` que
                        //    chegou por prop é de ANTES do salvamento, e recarregar
                        //    desmontaria o modal no meio da compra.
                        setCadastroOk(true)
                        setPasso("pagamento")
                      }}
                    />
                  )}

                  {passo === "pagamento" && planoEscolhido && (
                    titular ? (
                      <CardForm
                        titular={titular}
                        planoId={planoEscolhido.id}
                        planoNome={planoEscolhido.nome}
                        valorCents={planoEscolhido.precoCents}
                        primeiraCobranca={primeiraCobranca}
                        emTrial={false}
                        compacto
                        onSucesso={() => setPasso("pronto")}
                      />
                    ) : (
                      // 🔴 Chegou no cartão sem titular: só acontece se o cadastro foi salvo
                      //    nesta sessão (a prop veio nula). Recarregar traz o titular —
                      //    e é honesto dizer isso em vez de mostrar um formulário quebrado.
                      <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                        <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-900">
                          Cadastro salvo. Recarregue a página para continuar com o pagamento.
                        </p>
                      </div>
                    )
                  )}

                  {passo === "pronto" && (
                    <div className="text-center py-6">
                      <div className="mx-auto size-14 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center">
                        <Check className="size-7 text-emerald-600" />
                      </div>
                      <h2 className="mt-4 text-lg font-bold text-slate-900">
                        {liberado === true ? "Assinatura ativada" : "Recebemos seu pagamento"}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
                        {liberado === true
                          ? (primeiraCobranca
                              ? <>A primeira cobrança acontece em <strong className="text-slate-700">{primeiraCobranca}</strong>.</>
                              : <>A cobrança passa a ser mensal e automática.</>)
                          : liberado === false
                          ? <>A confirmação do banco está demorando mais que o normal. Seu pagamento foi enviado e nada será cobrado duas vezes — recarregue em alguns minutos ou fale com a gente.</>
                          : <>Estamos confirmando com o banco. Leva alguns segundos.</>}
                      </p>

                      {/* 🔑 Recarrega DE VERDADE em vez de fechar o modal: o desvio de
                          `trial_ended` mora no layout do servidor, e só um recarregamento
                          faz o app voltar a abrir. Fechar deixaria a pessoa numa tela
                          travada com a assinatura já paga.
                          ⚠️ E só aparece com o acesso JÁ liberado — oferecer "voltar a usar"
                          antes disso manda a pessoa direto de volta pro paywall. */}
                      {liberado === true ? (
                        <button type="button" onClick={() => window.location.assign("/inbox")}
                          className="mt-5 h-10 px-5 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors">
                          Voltar a usar o Kora <ArrowRight className="size-4" />
                        </button>
                      ) : liberado === false ? (
                        <button type="button" onClick={() => window.location.reload()}
                          className="mt-5 h-10 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors">
                          Verificar de novo
                        </button>
                      ) : (
                        <p className="mt-5 inline-flex items-center gap-2 text-sm text-slate-400">
                          <Loader2 className="size-4 animate-spin" /> Confirmando…
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : planos.length === 0 ? (
              // 🔴 Catálogo vazio é FALHA NOSSA, não do cliente — e a tela não pode fingir
              //    que ele tem escolha. Diz o que é e dá o caminho humano.
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">
                  Não conseguimos carregar os planos agora. Fale com a gente pelo WhatsApp que
                  ativamos sua conta na hora.
                </p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Trilho horizontal — 3 cards visíveis, o resto rola pra direita.
                    ⚠️ Alinhado À ESQUERDA sempre, mesmo com 1 plano (decisão do dono):
                       card centralizado sozinho parece "é só isso"; encostado na esquerda
                       parece "começa aqui", e é pra onde o olho vai de qualquer forma.
                    ⚠️ `scroll-snap` por card, não por página: com 4 planos o 4º encosta na
                       borda sem sobrar buraco, coisa que snap por página faria. */}
                <div
                  ref={trilho}
                  onScroll={aoRolar}
                  className="flex-1 min-h-0 flex items-stretch gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-none -mx-1 px-1"
                >
                  {planos.map((p) => (
                    <article key={p.id}
                      className="snap-start shrink-0 w-[min(20rem,85vw)] flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden hover:border-primary/40 transition-colors">

                      {/* ── ZONA 1 · FIXA: identidade e preço ────────────────────────
                          Nunca rola. É o que a pessoa precisa ter à vista enquanto
                          percorre a lista — sem isso ela rola 20 linhas e esquece de
                          qual plano está lendo. */}
                      <div className="p-5 pb-3 border-b border-slate-100">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="text-base font-bold text-slate-900">{p.nome}</h2>
                          <div className="flex items-center -space-x-1.5 shrink-0">
                            {p.canais.includes("whatsapp") && (
                              <SourceLogo source="whatsapp_inbound" size={22} className="rounded-full ring-2 ring-white" />
                            )}
                            {p.canais.includes("instagram") && (
                              <SourceLogo source="instagram" size={22} className="rounded-full ring-2 ring-white" />
                            )}
                          </div>
                        </div>
                        {p.atual && (
                          <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Selecionado</span>
                        )}
                        {p.descricao && <p className="mt-1 text-xs text-slate-500 leading-relaxed line-clamp-2">{p.descricao}</p>}

                        <p className="mt-3 flex items-baseline gap-1">
                          <span className="text-2xl font-bold text-slate-900 tabular-nums">
                            {(p.precoCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </span>
                          <span className="text-xs text-slate-400">/mês</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {p.usuariosInclusos} {p.usuariosInclusos === 1 ? "usuário incluso" : "usuários inclusos"}
                          {p.extraUsuarioCents > 0 && (
                            <> · adicional {(p.extraUsuarioCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</>
                          )}
                        </p>
                      </div>

                      {/* ── ZONA 2 · ROLA: a lista ────────────────────────────────────
                          `min-h-0` é obrigatório: sem ele o filho flex recusa encolher e
                          o card volta a crescer, empurrando o CTA pra fora da tela. */}
                      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none px-5 py-3 space-y-3">
                        {agrupar(p.itens).map(([categoria, itens]) => (
                          <div key={categoria}>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-900 mb-1.5">
                              {CATEGORIA_LABEL[categoria] ?? categoria}
                            </p>
                            <ul className="space-y-1.5">
                              {itens.map((item) => (
                                <li key={item.label}
                                  className={`flex items-start gap-2 text-xs ${item.incluso ? "text-slate-600" : "text-slate-300"}`}>
                                  {item.incluso
                                    ? <Check className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                    : <X className="size-3.5 text-slate-300 shrink-0 mt-0.5" />}
                                  <span className={`min-w-0 flex-1 ${item.incluso ? "" : "line-through decoration-slate-200"}`}>
                                    {item.label}
                                    {item.canal && (
                                      <SourceLogo
                                        source={item.canal === "whatsapp" ? "whatsapp_inbound" : "instagram"}
                                        size={13}
                                        className={`inline-block align-text-bottom ml-1 rounded-full ${item.incluso ? "" : "opacity-40"}`}
                                      />
                                    )}
                                    {item.pro && (
                                      <span className="ml-1.5 inline-flex items-center rounded px-1 py-px bg-violet-100 text-violet-700 text-[9px] font-bold align-middle">
                                        PRO
                                      </span>
                                    )}
                                  </span>
                                  {/* A QUANTIDADE no fim da linha — "se tem" e "quanto tem"
                                      chegam na mesma leitura. Só em item incluído. */}
                                  {item.quantidade && (
                                    <span className="shrink-0 text-[11px] font-semibold text-slate-900 tabular-nums">
                                      {item.quantidade}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}

                        {/* Cotas da conta inteira — rodapé discreto, sem módulo dono. */}
                        {p.limitesGerais.length > 0 && (
                          <div className="pt-2 border-t border-slate-100 space-y-1">
                            {p.limitesGerais.map((l) => (
                              <div key={l.label} className="flex items-baseline justify-between gap-3">
                                <span className="text-[11px] text-slate-400">{l.label}</span>
                                <span className="text-[11px] font-semibold text-slate-700 tabular-nums shrink-0">{l.valor}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* ── ZONA 3 · FIXA: o CTA ──────────────────────────────────────
                          Colado no rodapé, sempre visível. O botão de comprar não pode
                          depender de a pessoa rolar até o fim de uma lista de 15 itens. */}
                      <div className="p-4 pt-3 border-t border-slate-100 bg-slate-50/60">
                        <button type="button" onClick={() => escolher(p.id)} disabled={pending}
                          className="h-10 w-full rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
                          {pending && escolhido === p.id
                            ? <><Loader2 className="size-4 animate-spin" /> Aguarde…</>
                            : <>{podeAssinar ? "Assinar" : "Escolher"} <ArrowRight className="size-4" /></>}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                {/* Navegação — só quando SOBRA conteúdo (medido no DOM). Setas + bolinhas:
                    a seta é o gesto de desktop (clique curto, previsível) e a bolinha diz
                    ONDE se está. Uma sem a outra deixa metade da pergunta sem resposta. */}
                {temOverflow && (
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button type="button" onClick={() => passar(-1)} disabled={visivel === 0}
                      aria-label="Ver planos anteriores"
                      className="size-8 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent inline-flex items-center justify-center transition-colors">
                      <ChevronLeft className="size-4" />
                    </button>
                    <div className="flex items-center gap-2">
                    {planos.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => irPara(i)}
                        aria-label={`Ver plano ${p.nome}`}
                        className={`size-2 rounded-full transition-colors ${
                          i === visivel ? "bg-primary" : "bg-slate-300 hover:bg-slate-400"
                        }`}
                      />
                    ))}
                    </div>
                    <button type="button" onClick={() => passar(1)} disabled={noFim}
                      aria-label="Ver mais planos"
                      className="size-8 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent inline-flex items-center justify-center transition-colors">
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {erro && (
              <div className="mt-5 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{erro}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Agrupa preservando a ORDEM em que os itens chegaram — ela já vem ordenada por
 * categoria e `position` do god mode (`plans-view.ts`). Reordenar aqui seria a tela
 * discordando do catálogo.
 */
function agrupar(
  itens: PlanoVitrine["itens"],
): [string, PlanoVitrine["itens"]][] {
  const mapa = new Map<string, PlanoVitrine["itens"]>()
  for (const i of itens) {
    const atual = mapa.get(i.categoria)
    if (atual) atual.push(i)
    else mapa.set(i.categoria, [i])
  }
  return [...mapa.entries()]
}

