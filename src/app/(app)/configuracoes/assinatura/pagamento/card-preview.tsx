"use client"

import { useEffect, useState } from "react"
import { BandeiraLogo } from "@/components/billing/bandeira-logo"
import { agruparNumero, digitosDoNumero, type Bandeira } from "@/lib/billing/card-brand"

// ═══════════════════════════════════════════════════════════════
// Prévia do cartão — espelho, nunca fonte
// ═══════════════════════════════════════════════════════════════
//
// 🔒 A REGRA QUE GOVERNA ESTE ARQUIVO: **nenhum dado entra e volta.** O componente recebe o
//    que já está na tela e devolve pixels. Não tem `onChange`, não tem `useEffect` que
//    reporte pra fora, não persiste nada, não loga nada. Se um dia alguém quiser "só um
//    callbackzinho" pra saber o que foi digitado, a resposta é não — foi assim que PAN
//    vazou pra draft/analytics em outros produtos. O formulário já é o dono do estado; a
//    prévia é um espelho pendurado ao lado dele.
//
// 🔴 `aria-hidden` NO CONJUNTO INTEIRO, de propósito. Isto é duplicação visual dos campos
//    que estão logo abaixo — um leitor de tela lendo os 16 dígitos duas vezes não ajuda
//    ninguém. Quem navega por áudio já tem o campo, com rótulo e erro.
//
// 🔑 O DESTAQUE DA ZONA ATIVA É UM `ring` NO PRÓPRIO ELEMENTO, e não uma caixa absoluta
//    posicionada em pixels. A versão de referência usava `top: 92px; left: 18px; width:
//    346px` — números que só batem numa largura exata de cartão; em qualquer outra o
//    destaque cai em cima da coisa errada. Ring no elemento acerta em qualquer tamanho.
//
// 🔑 AMEX NÃO VIRA. O código da Amex fica na FRENTE, com 4 dígitos. Virar o cartão pra
//    "ensinar onde fica o código" ensinaria o lugar errado justamente pra quem mais
//    precisa da dica. Em Amex o destaque acende na frente e o cartão fica onde está.

/** Qual campo está com o cursor. `null` = nenhum (sem destaque). */
export type ZonaAtiva = "numero" | "validade" | "cvv" | "nome" | null

type Props = {
  /** Só dígitos, como o formulário guarda. */
  numero: string
  /** "MM/AA" parcial ou completo. */
  validade: string
  cvv: string
  nome: string
  marca: Bandeira | null
  zona: ZonaAtiva
}

/**
 * Onde ficam os espaços do agrupamento desta bandeira (4-4-4-4, 4-6-5 na Amex…).
 *
 * 🔑 Deriva de `agruparNumero` em vez de reimplementar a tabela. Bandeira nova entra em
 *    `card-brand.ts` e a prévia acompanha sozinha — que é o ponto de ter fonte única.
 */
function fatiasDaBandeira(marca: Bandeira | null): number[] {
  const total = digitosDoNumero(marca)
  const modelo = agruparNumero("0".repeat(total), marca)
  return modelo.split(" ").map((g) => g.length)
}

/**
 * Um dígito que ROLA do placeholder pro valor.
 *
 * As duas linhas vivem empilhadas dentro de uma janela de uma linha só; preencher desloca
 * a pilha. É o movimento que dá a sensação de "entrou no cartão" — sem ele a prévia é um
 * texto que muda, e texto que muda não confirma nada.
 */
function Digito({ valor }: { valor: string | null }) {
  return (
    // ⚠️ SEM largura fixa. Tinha `w-[0.62em]` aqui e a fonte já é monoespaçada — o resultado
    //    era espaçamento duplo: cada dígito ganhava uma folga além da que a própria fonte
    //    reserva, e os grupos saíam frouxos, com cara de placeholder mal alinhado.
    <span className="inline-block h-6 overflow-hidden align-top">
      <span
        className="flex flex-col transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: valor ? "translateY(-1.5rem)" : "none" }}
      >
        {/* O ponto vazio precisa ser LEGÍVEL — em `white/25` ele sumia e o cartão parecia
            estar carregando em vez de esperando o número. */}
        <span className="h-6 leading-6 text-white/45">•</span>
        <span className="h-6 leading-6">{valor}</span>
      </span>
    </span>
  )
}

export function CardPreview({ numero, validade, cvv, nome, marca, zona }: Props) {
  const fatias = fatiasDaBandeira(marca)
  const total = fatias.reduce((s, n) => s + n, 0)
  const [mm, aa] = validade.split("/")

  // 🔴 O CÓDIGO DA AMEX É NA FRENTE — ver o cabeçalho. Só as demais viram.
  const deveVirar = zona === "cvv" && marca !== "amex"

  // ⚠️ `prefers-reduced-motion` desliga a virada. Um cartão girando em 3D a cada foco no
  //    CVV é exatamente o tipo de movimento que dispara enjoo em quem pediu pra não ter.
  const [semMovimento, setSemMovimento] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const ler = () => setSemMovimento(mq.matches)
    ler()
    mq.addEventListener("change", ler)
    return () => mq.removeEventListener("change", ler)
  }, [])

  const virado = deveVirar && !semMovimento

  // 🔴 SEM DESTAQUE DE ZONA (dono, 09/08). A prévia acendia uma borda branca em volta do
  //    número/nome/validade conforme o cursor andava pelos campos. Foi retirado: o cartão
  //    já responde ao foco pelo conteúdo — o dígito entra, o nome aparece, o cartão vira no
  //    CVV — e a borda por cima disso era mais um elemento piscando numa tela que pede
  //    calma. `zona` continua governando a VIRADA, que é o único gesto que sobrou.

  let lido = 0

  return (
    // ⚠️ Escondida abaixo de `sm` DE PROPÓSITO. No celular ela empurraria pra fora da tela o
    //    herói com o preço e a data — e a regra deste checkout é que ninguém digita cartão
    //    sem ver quanto e quando. Prévia é conforto; o preço é informação.
    <div aria-hidden className="hidden sm:block [perspective:1200px]">
      <div
        className="relative w-full max-w-[320px] mx-auto aspect-[1.586] transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none"
        style={{ transform: virado ? "rotateY(180deg)" : "none" }}
      >
        {/* ── FRENTE ────────────────────────────────────────────────────────────
            🔑 A DISTRIBUIÇÃO VERTICAL É EXPLÍCITA, não sobra de `mt-auto`. Na primeira
               versão o `mt-auto` estava no NÚMERO: ele grudava no rodapé e abria um vão
               morto de uns 60px entre o chip e ele. O cartão lia como um cartão quebrado.
               Agora o `mt-auto` está no RODAPÉ (que é o que deve encostar embaixo) e o
               miolo respira com medida própria. */}
        <div className="absolute inset-0 [backface-visibility:hidden] overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 shadow-[0_18px_36px_-18px_rgba(15,23,42,0.7)] px-4 py-3.5 flex flex-col">
          {/* Brilho de marca — o accent da Kora, não um degradê aleatório. */}
          <div className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-primary/40 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 bottom-[-70px] size-52 rounded-full bg-indigo-500/25 blur-3xl" />

          <div className="relative flex items-start justify-between">
            <span className="text-[13px] font-semibold tracking-tight text-white/90">Kora</span>
            {/* 🔴 A BANDEIRA É A DE VERDADE, detectada do número. A versão de referência
                desenhava a Mastercard fixa: num cartão Visa a tela exibiria a bandeira
                errada bem na hora de digitar — numa tela de pagamento isso não é um
                detalhe estético, é o cliente parando pra perguntar se o site é sério. */}
            <BandeiraLogo marca={marca} size={26} />
          </div>

          {/* Chip — menor e com as trilhas, senão lê como um retângulo amarelo solto. */}
          <div className="relative mt-2.5 h-6 w-8 rounded bg-gradient-to-br from-amber-200 to-amber-400/80 shadow-inner">
            <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-amber-700/30" />
            <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-amber-700/30" />
          </div>

          <div className="relative mt-2.5 font-mono text-[15px] tabular-nums text-white">
            <div className="flex items-center gap-2.5 px-1 py-0.5">
              {fatias.map((tamanho, g) => (
                <span key={g} className="flex">
                  {Array.from({ length: tamanho }, () => {
                    const i = lido++
                    return (
                      // ⚠️ O número aparece INTEIRO, sem mascarar o meio. O campo logo abaixo
                      //    já mostra tudo — mascarar aqui não esconderia nada de ninguém e
                      //    tiraria a única função da prévia, que é conferir o que foi
                      //    digitado. Duas grafias diferentes do mesmo número na mesma tela
                      //    confundem mais do que protegem.
                      <Digito key={i} valor={numero[i] ?? null} />
                    )
                  })}
                </span>
              ))}
              {/* Cartão mais longo que o previsto pela bandeira (Maestro e afins): o excedente
                  entra em vez de sumir. Prévia que engole dígito digitado mente. */}
              {numero.length > total &&
                numero.slice(total).split("").map((d, i) => <Digito key={`x${i}`} valor={d} />)}
            </div>
          </div>

          <div className="relative mt-auto pt-2.5 flex items-end justify-between gap-3">
            <div className="min-w-0 px-1 py-0.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45">Nome no cartão</p>
              <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-wide text-white/90">
                {nome || "SEU NOME AQUI"}
              </p>
            </div>
            <div className="shrink-0 px-1 py-0.5 text-right">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45">Validade</p>
              <p className="mt-0.5 text-[11px] font-medium tabular-nums text-white/90">
                {mm || "MM"}/{aa || "AA"}
              </p>
            </div>
          </div>

          {/* Amex: o código mora na FRENTE, então ele aparece aqui em vez de o cartão virar.
              ⚠️ Bloco preenchido, não borda — é como o código é impresso no cartão de
                 verdade, e mantém a tela sem o contorno que o dono pediu pra tirar. */}
          {zona === "cvv" && marca === "amex" && (
            <div className="absolute right-4 top-14 rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
              {cvv || "••••"}
            </div>
          )}
        </div>

        {/* ── VERSO ───────────────────────────────────────────────────────────── */}
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 shadow-[0_18px_36px_-18px_rgba(15,23,42,0.7)]">
          <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary/30 blur-3xl" />
          <div className="relative mt-5 h-10 w-full bg-slate-950/80" />
          <div className="relative mt-5 px-5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45">Código de segurança</p>
            <div className="mt-1 flex h-8 items-center justify-end rounded-md bg-white/90 px-2.5 font-mono text-sm tabular-nums text-slate-900">
              {cvv || <span className="text-slate-400">•••</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
