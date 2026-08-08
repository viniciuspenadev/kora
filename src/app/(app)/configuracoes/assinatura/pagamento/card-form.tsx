"use client"

import Link from "next/link"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react"
import { AlertCircle, ArrowRight, Loader2, MessageCircle, ShieldCheck } from "lucide-react"
import { maskCpfCnpj, maskPhone } from "@/lib/masks"
import { linkSuporte } from "@/lib/support"
import { ativarAssinatura, trocarCartaoDaAssinatura, type TitularPreenchido } from "@/lib/actions/subscription"
import { BandeiraLogo } from "@/components/billing/bandeira-logo"
import {
  BANDEIRAS_ACEITAS, BANDEIRA_LABEL, MAX_DIGITOS_CARTAO, agruparNumero, detectarBandeira,
  digitosDoCvv, digitosDoNumero, placeholderDoNumero, type Bandeira,
} from "@/lib/billing/card-brand"

// ═══════════════════════════════════════════════════════════════
// Captura de cartão — contratar OU trocar
// ═══════════════════════════════════════════════════════════════
// 🔴 DECISÕES DE UX QUE SÃO, NA VERDADE, DECISÕES DE CONFIANÇA:
//
// 1. **O preço e a DATA ficam GRUDADOS no topo** (`sticky`). Ninguém digita cartão sem
//    saber quanto e quando — e um herói que rola pra fora enquanto a pessoa digita 16
//    dígitos deixa de ser herói exatamente quando ela mais precisa dele.
// 2. **O que a Kora faz com o cartão é dito em português**, não em selo. Uma fileira de
//    cadeados coloridos comunica menos que uma frase que explica que a gente não guarda
//    o número. E é verificável: `lib/asaas/subscriptions.ts` guarda só o token.
// 3. **Validação enquanto digita, erro só depois de sair do campo.** Acusar erro no
//    segundo caractere do número do cartão é hostilizar quem está tentando pagar.
// 4. **Nenhum dado do cartão sai deste componente** a não ser na chamada da action.
//    Sem draft em localStorage, sem analytics, sem log.
//
// 🔴 É UM `<form>` DE VERDADE (07/08) — antes era uma `<div>` com `type="button"`. A
//    diferença não é semântica: sem `<form>`, o autofill de cartão do navegador não
//    dispara, o "Scan Credit Card" do iOS não aparece, o Enter não envia e o rótulo não
//    foca o campo. Quatro atalhos que existem justamente pra reduzir a digitação de 16
//    dígitos no celular, todos perdidos por uma tag errada.
//
// 🔴 A ORDEM DOS CAMPOS É NUMÉRICA-PRIMEIRO. Era Número → Nome → Validade/CVV, e no
//    celular isso troca o teclado duas vezes no meio do preenchimento. Agora os três
//    campos numéricos são uma corrida só, encadeada por avanço automático, e o nome
//    (que é conferência, não corrida) fica por último.

type Comum = {
  titular: TitularPreenchido
  /** Volta pro passo de cadastro (contexto do modal). Ausente ⇒ link pra /configuracoes/empresa. */
  onEditarCadastro?: () => void
  /**
   * O que fazer quando o cartão passa. **Obrigatório.**
   *
   * 🔑 Este componente NÃO tem mais tela de sucesso própria. Ela existia, servia a um
   *    único chamador e carregava ramos que nunca renderizavam — e "sucesso" significa
   *    coisas diferentes nos dois hosts: contratar espera a CONFIRMAÇÃO do webhook (a
   *    trilha do paywall), trocar cartão termina no ato. Quem sabe disso é o host.
   *
   * ⚠️ Recebe o RÓTULO do cartão que passou (bandeira + 4 últimos) pro host poder ecoar
   *    "Mastercard ···· 4242" sem esperar o servidor. É o mesmo dado que já vai pro banco
   *    e que o cliente lê no extrato dele — não é dado sensível.
   */
  onSucesso: (cartao: { bandeira: Bandeira | null; ultimos4: string | null }) => void
  /**
   * Avisa o host que a validação com o banco começou/terminou.
   *
   * 🔴 O host usa isso pra TRANCAR a saída do modal. Fechar no meio da tokenização deixa
   *    a pessoa sem saber se foi cobrada — e o palpite dela vai ser "não fui", o que
   *    produz uma segunda tentativa em cima de um pagamento que passou.
   */
  onPendingChange?: (pendente: boolean) => void
}

/**
 * 🔑 UNIÃO DISCRIMINADA, e não props opcionais. Antes o modo `trocar` era obrigado a
 *    passar `planoId=""`, `emTrial={false}` e um `planoNome` de fachada — três valores
 *    que não significavam nada ali. Contrato que aceita lixo obrigatório ensina quem lê
 *    a preencher qualquer coisa, e um dia esse "qualquer coisa" viaja pro servidor.
 */
export type CardFormProps = Comum & (
  | {
      modo: "assinar"
      /** Id do plano a contratar. Viaja com o cartão e é **revalidado no servidor**. */
      planoId:    string
      planoNome:  string
      valorCents: number
      primeiraCobranca: string | null
      emTrial:    boolean
    }
  | {
      modo: "trocar"
      planoNome:  string
      valorCents: number
      proximaCobranca: string | null
      /** O cartão que está sendo substituído. `null` = tenant anterior ao registro do rótulo. */
      cartaoAtual: { bandeira: Bandeira | null; ultimos4: string } | null
    }
)

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

/**
 * A frase do estado que ninguém gosta de escrever: **não sabemos se cobrou**.
 *
 * 🔴 Ela NÃO pode dizer "nada foi cobrado". Se a resposta se perdeu depois de o servidor
 *    falar com o gateway, o débito pode ter acontecido — e mandar a pessoa "tentar de
 *    novo" nesse instante é pedir a segunda cobrança. O texto manda CONFERIR antes.
 */
const INCERTO = "Não recebemos a resposta do banco. Aguarde um minuto e recarregue esta tela antes de tentar de novo — se a cobrança tiver passado, ela aparece na sua assinatura."

/** Luhn — pega dígito trocado e ordem invertida antes de gastar uma chamada ao gateway. */
function luhnOk(num: string): boolean {
  const d = num.replace(/\D/g, "")
  if (d.length < 13) return false
  let soma = 0, alt = false
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i])
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    soma += n; alt = !alt
  }
  return soma % 10 === 0
}

/**
 * Onde fica o cursor depois do n-ésimo dígito da string já mascarada.
 *
 * 🔴 Sem isto, editar o MEIO do número joga o cursor pro fim a cada tecla (defeito da
 *    versão anterior): a pessoa corrige o 3º dígito e os próximos vão parar no fim.
 *    Campo mascarado sem preservação de cursor é campo que só aceita ser digitado do
 *    começo ao fim, sem erro nenhum no caminho.
 */
function posDoDigito(mascarado: string, n: number): number {
  if (n <= 0) return 0
  let visto = 0
  for (let i = 0; i < mascarado.length; i++) {
    if (mascarado[i] >= "0" && mascarado[i] <= "9") {
      visto++
      if (visto === n) return i + 1
    }
  }
  return mascarado.length
}

export function CardForm(props: CardFormProps) {
  const { titular, onEditarCadastro, onSucesso, onPendingChange } = props
  const trocando = props.modo === "trocar"

  const [numero, setNumero]     = useState("")     // só dígitos
  const [validade, setValidade] = useState("")     // "MM/AA"
  const [cvv, setCvv]           = useState("")
  // 🔴 PRÉ-PREENCHER O NOME SÓ EM CPF (07/08). Antes vinha sempre da razão social — e em
  //    CNPJ o cartão é quase sempre do sócio, não da empresa. O campo chegava preenchido
  //    com um nome que não está em relevo em cartão nenhum, e ninguém relê um campo que
  //    já tem conteúdo: a pessoa enviava e o gateway recusava.
  const [nome, setNome] = useState(
    titular.cpfCnpj.replace(/\D/g, "").length === 11 ? titular.nome.toUpperCase() : "",
  )
  const [tocado, setTocado]   = useState<Record<string, boolean>>({})
  const [erro, setErro]       = useState<string | null>(null)
  const [recusas, setRecusas] = useState(0)
  const [pending, start]      = useTransition()

  const refNumero   = useRef<HTMLInputElement | null>(null)
  const refValidade = useRef<HTMLInputElement | null>(null)
  const refCvv      = useRef<HTMLInputElement | null>(null)
  const refNome     = useRef<HTMLInputElement | null>(null)
  /** Cursor a restaurar depois do render do campo mascarado. `null` = deixa onde está. */
  const caret = useRef<number | null>(null)
  // 🔴 CONTADOR, e não o texto mascarado, como gatilho da restauração do cursor. Apagar um
  //    ESPAÇO ("4242 |4242" + Backspace) produz exatamente os mesmos dígitos — o React faz
  //    bail-out, o texto não muda, e um efeito que dependesse dele NÃO rodaria: o valor
  //    controlado voltava ao DOM e levava o cursor pro fim. Cada tecla incrementa isto, com
  //    ou sem mudança de texto.
  const [rev, setRev] = useState(0)

  const marca      = detectarBandeira(numero)
  const esperado   = digitosDoNumero(marca)
  const tamCvv     = digitosDoCvv(marca)
  const mascarado  = agruparNumero(numero, marca)
  const [mm, aa]   = validade.split("/")

  // 🔴 A LIMPEZA NÃO É DETALHE. No sucesso o host troca de tela e ESTE componente desmonta
  //    antes de `pending` voltar a `false` — sem o `return`, o host ficaria travado em
  //    "cobrança em andamento" pra sempre: sem X, sem ESC, sem clique-fora, na tela que
  //    diz que deu tudo certo.
  useEffect(() => {
    onPendingChange?.(pending)
    return () => onPendingChange?.(false)
  }, [pending, onPendingChange])

  // Restaura o cursor DEPOIS que a máscara redesenhou o valor.
  // ⚠️ `useLayoutEffect`: com `useEffect` o cursor aparece uma frame na posição errada e
  //    pisca — num campo de 16 dígitos isso é visível a cada tecla.
  useLayoutEffect(() => {
    if (caret.current === null) return
    const pos = caret.current
    caret.current = null
    const el = refNumero.current
    if (el) el.setSelectionRange(pos, pos)
  }, [rev])

  // ⚠️ Foco automático SÓ no desktop. No celular ele abre o teclado por cima do herói
  //    antes de a pessoa ler quanto vai ser cobrado — abrir um checkout escondendo o
  //    preço é o oposto do que este formulário inteiro tenta fazer.
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) refNumero.current?.focus()
  }, [])

  const erros = useMemo(() => {
    const e: Record<string, string> = {}

    // 🔴 O COMPRIMENTO DA BANDEIRA NÃO É MAIS GATE (achado da revisão, 07/08). Ele só
    //    escolhe a MENSAGEM. Quem reprova é o Luhn — que não depende da nossa tabela de
    //    prefixos estar em dia. Amex é a única exceção dura, porque `34`/`37` significa 15
    //    dígitos no mundo inteiro e não há família longa.
    if (numero.length === 0) e.numero = "Digite o número do cartão."
    else if (marca === "amex" && numero.length !== 15) e.numero = "Cartão American Express tem 15 dígitos."
    else if (!luhnOk(numero)) {
      e.numero = numero.length < esperado
        ? "Faltam dígitos no número do cartão."
        : "Esse número não confere. Confira os dígitos."
    }

    if (validade.length < 5) e.validade = "Informe mês e ano (MM/AA)."
    else {
      const m = Number(mm), a = 2000 + Number(aa)
      if (!(m >= 1 && m <= 12)) e.validade = "Mês inválido — use de 01 a 12."
      // Fim do MÊS, não o dia 1º: cartão que vence em 08/26 vale até 31/08/2026.
      else if (new Date(a, m, 0, 23, 59, 59) < new Date()) e.validade = "Este cartão já venceu."
      else if (a > new Date().getFullYear() + 20) e.validade = "Confira o ano de validade."
    }

    if (cvv.length < tamCvv) {
      e.cvv = marca === "amex"
        ? "O código são 4 dígitos, na frente do cartão."
        : "O código são 3 dígitos, no verso do cartão."
    }

    if (nome.trim().length === 0) e.nome = "Digite o nome como está impresso no cartão."
    else if (nome.trim().length < 3) e.nome = "Use o nome completo, como está impresso no cartão."

    return e
  }, [numero, esperado, marca, validade, mm, aa, cvv, tamCvv, nome])

  // ── Tipo do erro do servidor governa a COR e a saída ──────────────────────
  // ⚠️ Vermelho pra recusa; ÂMBAR pra teto de tentativas e falha de rede. Pintar "muitas
  //    tentativas" de vermelho diria "seu cartão foi recusado" — e o cartão nem chegou a
  //    ser testado. A cor é a primeira coisa que se lê; ela não pode mentir.
  // 🔴 O RAMO ÂMBAR ERA CÓDIGO MORTO (achado da revisão, 07/08). Ele testava uma frase que
  //    NENHUM caminho do servidor produzia — enquanto o timeout real ("O gateway demorou
  //    demais…") caía no vermelho, contava como recusa e limpava o cartão. Ou seja: o único
  //    cenário em que a pessoa pode ter sido cobrada era o único pintado de "recusado,
  //    tente de novo". As duas frases reais estão listadas agora, e a de incerteza é
  //    produzida aqui do lado do cliente.
  const bloqueado = !!erro && erro.startsWith("Muitas tentativas")
  const semSessao = !!erro && erro.startsWith("Sessão expirada")
  const incerto   = !!erro && (erro === INCERTO || erro.startsWith("O gateway demorou"))
  const ambar     = bloqueado || incerto

  function foco(campo: string) {
    const alvo = campo === "numero" ? refNumero : campo === "validade" ? refValidade
               : campo === "cvv" ? refCvv : refNome
    alvo.current?.focus()
    alvo.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }

  function aoDigitarNumero(e: React.ChangeEvent<HTMLInputElement>) {
    const bruto  = e.target.value
    const antes  = bruto.slice(0, e.target.selectionStart ?? bruto.length).replace(/\D/g, "").length
    const novaMarca = detectarBandeira(bruto)
    // 🔴 TETO ABSOLUTO, NUNCA O DA BANDEIRA. Truncar em `digitosDoNumero` fazia o campo
    //    parar de aceitar tecla no meio de um cartão real (Hipercard `38…` de 19 dígitos
    //    cai no nosso ramo de Diners, de 14) — e a tela ainda acusava o número de errado.
    const d = bruto.replace(/\D/g, "").slice(0, MAX_DIGITOS_CARTAO)

    caret.current = posDoDigito(agruparNumero(d, novaMarca), antes)
    setRev((r) => r + 1)
    setNumero(d)

    // A bandeira manda no tamanho do CVV. Sair de Amex com 4 dígitos digitados deixaria um
    // código de 4 num campo que agora aceita 3 — e o gateway recusaria sem dizer por quê.
    const novoTamCvv = digitosDoCvv(novaMarca)
    if (cvv.length > novoTamCvv) setCvv(cvv.slice(0, novoTamCvv))

    // ⚠️ Só avança QUANDO DÍGITO FOI ACRESCENTADO, e com o Luhn OK. Sem a checagem de
    //    crescimento, apagar um espaço no meio de um número já completo roubava o foco pro
    //    campo seguinte — a pessoa tentava corrigir um dígito e era expulsa do campo.
    if (d.length > numero.length && d.length === digitosDoNumero(novaMarca) && luhnOk(d)) {
      refValidade.current?.focus()
    }
  }

  /** `Backspace` em campo vazio volta ao anterior — o gesto que todo checkout bom tem. */
  function voltarNoVazio(e: React.KeyboardEvent<HTMLInputElement>, vazio: boolean, anterior: React.RefObject<HTMLInputElement | null>) {
    if (e.key !== "Backspace" || !vazio) return
    const el = anterior.current
    if (!el) return
    e.preventDefault()
    el.focus()
    const fim = el.value.length
    el.setSelectionRange(fim, fim)
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return

    // 🔴 O BOTÃO NÃO É DESABILITADO POR CAMPO INCOMPLETO (07/08). `disabled:opacity-40`
    //    sem dizer o que falta é a definição de "nem um pouco intuitivo" — a pessoa clica,
    //    nada acontece, e ela não tem como descobrir qual campo é o culpado. Agora o clique
    //    ENSINA: marca tudo como tocado, revela os erros e pula pro primeiro inválido.
    const faltando = Object.keys(erros)
    if (faltando.length > 0) {
      setTocado({ numero: true, validade: true, cvv: true, nome: true })
      setErro("Confira os campos destacados.")
      foco(["numero", "validade", "cvv", "nome"].find((c) => erros[c]) ?? "numero")
      return
    }

    setErro(null)
    start(async () => {
      const dados = {
        holderName:  nome,
        number:      numero,
        expiryMonth: mm ?? "",
        expiryYear:  `20${aa ?? ""}`,
        ccv:         cvv,
      }

      // 🔴 A CHAMADA PRECISA DE `try` (achado da revisão, 07/08). Sem ele, a conexão caindo
      //    DEPOIS de o servidor ter falado com o gateway rejeitava a promise: o ramo de erro
      //    nunca rodava, nada aparecia na tela, o cartão continuava preenchido e o botão
      //    voltava a funcionar — convite direto ao segundo envio em cima de um pagamento
      //    que passou. É o único cenário em que a pessoa PODE ter pagado, e era justamente
      //    o que a tela não contava.
      let r: { ok?: true; id?: string } | { error: string }
      try {
        r = props.modo === "trocar"
          ? await trocarCartaoDaAssinatura(dados)
          : await ativarAssinatura({ planoId: props.planoId, ...dados })
      } catch {
        setNumero(""); setCvv("")
        setErro(INCERTO)
        return
      }

      if ("error" in r) {
        // ⚠️ Em QUALQUER falha o NÚMERO e o CVV saem da memória do componente — não ficam
        //    "pro caso de tentar de novo". Validade e nome ficam: eles quase nunca são a
        //    causa da recusa, e redigitar tudo depois de um "não autorizado" é o que faz a
        //    pessoa desistir. Nada sensível sobrevive na aba de qualquer forma.
        setNumero(""); setCvv("")
        // ⚠️ Timeout do gateway NÃO é recusa e não entra na conta: contá-lo faria a tela
        //    oferecer "fale com o suporte porque seu cartão foi negado" pra quem talvez
        //    tenha pagado. O contador governa só o convite ao suporte.
        if (!r.error.startsWith("O gateway demorou")) setRecusas((n) => n + 1)
        setErro(r.error)
        refNumero.current?.focus()
        return
      }
      // Sucesso: o RÓTULO é capturado antes, e o cartão sai da memória ANTES de o host
      // trocar de tela. O host recebe bandeira + 4 últimos; o número não sobrevive a esta
      // linha em lugar nenhum.
      const rotulo = { bandeira: marca, ultimos4: numero.slice(-4) || null }
      setNumero(""); setCvv(""); setValidade("")
      onSucesso(rotulo)
    })
  }

  const cta = trocando ? "Salvar cartão" : `Pagar ${brl(props.valorCents)}`

  return (
    // 🔒 `method="post"` num formulário que NUNCA envia nativamente. Parece supérfluo e não
    //    é: sem `method`, um submit nativo (hidratação incompleta, JS quebrado, extensão do
    //    navegador) vira GET — e o campo do número tem `name="cardnumber"`, então o PAN
    //    completo iria pra QUERY STRING: log de acesso, histórico do navegador, `Referer`.
    //    É o achado que um auditor PCI marca sozinho, e o custo de fechar é uma palavra.
    <form onSubmit={enviar} method="post" noValidate autoComplete="on" aria-busy={pending} className="flex flex-col">

      {/* ── HERÓI GRUDADO NO TOPO ───────────────────────────────────────────────
          🔑 `sticky`, e não um bloco comum: é a única informação que precisa continuar
             visível enquanto a pessoa digita. Em `assinar` o herói é o VALOR (o que ela
             confirma antes de pagar); em `trocar` é o CARTÃO ATUAL — porque ali a pergunta
             não é "quanto" (nada é cobrado), é "é esse mesmo que eu quero substituir?".
          ⚠️ Pôr R$ 349,00 em 24px numa tela que não cobra nada seria a tela prometendo um
             débito que não vai acontecer. */}
      <div className="sticky top-0 z-10 px-5 pt-5 pb-3 bg-white border-b border-slate-100">
        {props.modo === "assinar" ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">Assinar {props.planoNome}</p>
              <p className="mt-0.5 text-[11px] text-slate-400 leading-relaxed">
                {props.emTrial
                  ? "Cobrança hoje · você troca os dias restantes de teste pelo plano completo"
                  : props.primeiraCobranca
                  ? `Cobrança hoje, ${props.primeiraCobranca} · depois todo mês no mesmo dia`
                  : "Cobrança hoje · depois todo mês no mesmo dia"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{brl(props.valorCents)}</p>
              <p className="mt-1 text-[11px] text-slate-400">/mês</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Trocar cartão</p>
              <p className="mt-0.5 text-[11px] text-slate-400">Nada é cobrado agora</p>
            </div>
            {/* A transição responde "o que vai acontecer" sem uma linha de texto: o cartão
                que sai desbota, o que entra aparece assim que a bandeira é reconhecida.
                ⚠️ Sem `cartaoAtual` (tenant anterior ao registro do rótulo) o certo é dizer
                   que não sabemos — inventar "···· ••••" seria exibir um identificador que
                   não identifica nada. */}
            <div className="flex items-center gap-2 shrink-0">
              <div className={`flex items-center gap-1.5 transition-opacity ${marca ? "opacity-50" : ""}`}>
                <BandeiraLogo marca={props.cartaoAtual?.bandeira ?? null} size={22} />
                <span className="text-sm font-semibold text-slate-900 tabular-nums">
                  {props.cartaoAtual ? `···· ${props.cartaoAtual.ultimos4}` : "atual"}
                </span>
              </div>
              {marca && (
                <>
                  <ArrowRight className="size-3.5 text-slate-300 shrink-0" />
                  <BandeiraLogo marca={marca} size={22} />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 🔑 O PADDING HORIZONTAL É DAS ZONAS, não do host. Assim as barras grudadas (herói
          e rodapé) encostam nas bordas — que é o que faz elas lerem como cabeçalho e
          rodapé fixos, e não como blocos flutuando. E o componente cai igual nos dois
          hosts sem cada um recalcular respiro. */}
      <div className="px-5 pt-4 space-y-3.5">
        {/* Tira de contexto do modo `trocar`: o valor existe, só não é herói aqui. */}
        {trocando && (
          <p className="text-xs text-slate-500">
            {props.planoNome} · <span className="tabular-nums">{brl(props.valorCents)}</span>/mês
            {props.proximaCobranca ? <> · próxima cobrança em <span className="tabular-nums">{props.proximaCobranca}</span></> : null}
          </p>
        )}

        {/* ── Número ─────────────────────────────────────────────────────────── */}
        <Campo
          id="cc-numero" label="Número do cartão"
          erro={tocado.numero ? erros.numero : undefined}
          dica={numero.length >= esperado && !marca ? "Não identificamos a bandeira — pode continuar, quem confirma é o seu banco." : undefined}
          /* ⚠️ A fileira só acompanha o rótulo a partir de `sm`. Em 320px ela (5 chips
             `shrink-0` = ~160px) mais o rótulo estouravam a linha — e como o container do
             modal rola no eixo Y, o excesso viraria BARRA DE ROLAGEM HORIZONTAL num
             checkout. Abaixo de `sm` ela desce pra linha própria, embaixo do campo. */
          extra={<Aceitas marca={marca} className="hidden sm:flex" comRotulo />}
        >
          <div className="relative">
            <input
              ref={refNumero} id="cc-numero" name="cardnumber"
              value={mascarado} onChange={aoDigitarNumero}
              onBlur={() => setTocado((t) => ({ ...t, numero: true }))}
              inputMode="numeric" pattern="[0-9\s]*" enterKeyHint="next" autoComplete="cc-number"
              aria-invalid={tocado.numero && !!erros.numero}
              placeholder={placeholderDoNumero(marca)}
              className={`${INPUT} pr-14 font-mono tabular-nums tracking-[0.04em] ${tocado.numero && erros.numero ? INPUT_ERRO : ""}`}
            />
            {/* ⚠️ `pr-14` SEMPRE, e o chip neutro no lugar desde o campo vazio: assim a
                bandeira TROCA em vez de aparecer do nada, e o texto não pula. */}
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <BandeiraLogo marca={marca} size={22} />
            </span>
            <span className="sr-only" aria-live="polite">
              {marca ? `Bandeira ${BANDEIRA_LABEL[marca]} identificada` : ""}
            </span>
          </div>
          <Aceitas marca={marca} className="sm:hidden mt-2" />
        </Campo>

        {/* ── Validade + CVV ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Campo id="cc-validade" label="Validade" erro={tocado.validade ? erros.validade : undefined}>
            <input
              ref={refValidade} id="cc-validade"
              value={validade}
              onChange={(e) => {
                // 🔴 ACEITA 6 DÍGITOS E FICA COM OS 2 ÚLTIMOS DO ANO. O Chrome preenche
                //    `cc-exp` como `MM/YYYY` — cortando em 4, "12/2026" virava "12/20" e a
                //    tela dizia "Este cartão já venceu" sobre um cartão válido que o
                //    PRÓPRIO navegador preencheu. O formulário foi reescrito justamente
                //    pra o autofill funcionar; ele não pode ser a armadilha.
                const d  = e.target.value.replace(/\D/g, "").slice(0, 6)
                const ano = d.length > 4 ? d.slice(-2) : d.slice(2)
                setValidade(d.length > 2 ? `${d.slice(0, 2)}/${ano}` : d)
                if (d.length >= 4 && validade.length < 5) refCvv.current?.focus()
              }}
              onKeyDown={(e) => voltarNoVazio(e, validade.length === 0, refNumero)}
              onBlur={() => setTocado((t) => ({ ...t, validade: true }))}
              // ⚠️ SEM `maxLength` de propósito. Ele parece o reforço óbvio e é a armadilha:
              //    o navegador clamparia o `MM/YYYY` do autofill em 5 caracteres ANTES do
              //    handler ver o ano inteiro — reintroduzindo o mesmo "cartão vencido".
              inputMode="numeric" enterKeyHint="next" autoComplete="cc-exp"
              aria-invalid={tocado.validade && !!erros.validade}
              placeholder="MM/AA"
              className={`${INPUT} tabular-nums ${tocado.validade && erros.validade ? INPUT_ERRO : ""}`}
            />
          </Campo>

          <Campo
            id="cc-cvv" label="Código de segurança"
            erro={tocado.cvv ? erros.cvv : undefined}
            /* A dica muda com a bandeira porque a INSTRUÇÃO muda — em Amex o código tem 4
               dígitos e fica na FRENTE. Dica fixa "3 dígitos no verso" manda a pessoa
               procurar no lugar errado do próprio cartão. */
            dica={marca === "amex" ? "4 dígitos na frente do cartão" : "3 dígitos no verso do cartão"}
          >
            <input
              ref={refCvv} id="cc-cvv"
              value={cvv}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "").slice(0, tamCvv)
                setCvv(d)
                // Mesma regra do número: só avança quando CRESCE. Reeditar um CVV completo
                // não pode expulsar a pessoa do campo.
                if (d.length === tamCvv && d.length > cvv.length) refNome.current?.focus()
              }}
              onKeyDown={(e) => voltarNoVazio(e, cvv.length === 0, refValidade)}
              onBlur={() => setTocado((t) => ({ ...t, cvv: true }))}
              inputMode="numeric" enterKeyHint="next" autoComplete="cc-csc"
              aria-invalid={tocado.cvv && !!erros.cvv}
              placeholder={"0".repeat(tamCvv)}
              className={`${INPUT} tabular-nums ${tocado.cvv && erros.cvv ? INPUT_ERRO : ""}`}
            />
          </Campo>
        </div>

        {/* ── Nome ───────────────────────────────────────────────────────────── */}
        <Campo id="cc-nome" label="Nome impresso no cartão" erro={tocado.nome ? erros.nome : undefined}>
          <input
            ref={refNome} id="cc-nome"
            value={nome}
            // Dígito não existe em relevo de cartão — filtrar aqui evita o erro do gateway.
            onChange={(e) => setNome(e.target.value.replace(/[^\p{L}\s'-]/gu, "").toUpperCase().slice(0, 26))}
            onBlur={() => setTocado((t) => ({ ...t, nome: true }))}
            enterKeyHint="done" autoCapitalize="characters" autoComplete="cc-name"
            aria-invalid={tocado.nome && !!erros.nome}
            placeholder="COMO ESTÁ NO CARTÃO"
            className={`${INPUT} uppercase ${tocado.nome && erros.nome ? INPUT_ERRO : ""}`}
          />
        </Campo>

        {/* ── Titular ────────────────────────────────────────────────────────────
            Conferência, não entrada — por isso vem DEPOIS dos campos, ao lado do botão de
            confirmar. É a única chance de a pessoa ver um dado errado ANTES de pagar (foi
            um telefone inválido que derrubou uma cobrança de verdade). */}
        <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cobrança em nome de</p>
            <p className="mt-0.5 text-sm font-medium text-slate-800 truncate">{titular.nome}</p>
            <p className="text-xs text-slate-500 truncate">
              {[maskCpfCnpj(titular.cpfCnpj), titular.telefone && maskPhone(titular.telefone)].filter(Boolean).join(" · ")}
            </p>
          </div>
          {/* 🔴 NAVEGAR PRA FORA PERDE O CARTÃO DIGITADO. Onde o host oferece edição
              embutida (`onEditarCadastro`), é ela que vale; o link é o último recurso de
              quem não tem passo de cadastro. */}
          {onEditarCadastro ? (
            <button type="button" onClick={onEditarCadastro}
              className="shrink-0 -m-2 p-2 text-xs font-semibold text-primary hover:underline">
              Editar
            </button>
          ) : (
            <Link href="/configuracoes/empresa" className="shrink-0 -m-2 p-2 text-xs font-semibold text-primary hover:underline">
              Editar
            </Link>
          )}
        </div>

        {/* 🔒 A SEGURANÇA CONTINUA DITA EM PORTUGUÊS (pedido do dono), mas o DETALHE mora
            aqui embaixo, longe do botão: um `<details>` colado no CTA empurra o botão pra
            baixo no exato instante em que a pessoa vai clicar. Nenhuma frase promete mais
            do que o código faz — cada uma é verificável em `asaas/subscriptions.ts`. */}
        <details className="group rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
          <summary className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer list-none min-h-11 sm:min-h-0">
            <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
            <span><strong className="font-semibold text-slate-700">Como protegemos seus dados</strong></span>
            <span className="ml-auto text-primary font-semibold group-open:hidden">ver</span>
          </summary>
          {/* 🔴 DUAS FRASES SAÍRAM DAQUI (pentest 08/08) — as duas eram minhas, e as duas
              prometiam mais do que o produto faz. O comentário logo acima diz que "nenhuma
              frase promete mais do que o código faz"; era essa a régua, e ela estava sendo
              furada pela própria lista que a enuncia.

              1. "criptografada de ponta a ponta" — não é. É TLS em trânsito, e o servidor
                 da Kora vê o número em memória pra tokenizar (decisão de arquitetura do
                 dono, documentada em `docs/asaas-billing-design.md §7`). Ponta a ponta
                 significa que o intermediário NÃO vê — dizer isso aqui é falso, e numa
                 tela de cartão é o tipo de falso que vira dano de reputação.
              2. "Você pode cancelar quando quiser" — o cliente não tem botão nenhum de
                 cancelar. A REGRA do dono (08/08) é essa mesma: cancela, não há estorno,
                 e usa até o último dia pago. Só que hoje quem executa isso é o suporte.
              ⚠️ Volta a ser "quando quiser" no dia em que o botão existir — não antes. */}
          <ul className="mt-2 space-y-1.5 text-[11px] text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
            <li>· A conexão com nossos servidores e com o Asaas é criptografada (TLS).</li>
            <li>· O pagamento é processado pelo <strong>Asaas</strong>, instituição autorizada pelo Banco Central.</li>
            {/* ⚠️ "apenas" e "só para cobrar esta assinatura" eram duas imprecisões:
                guardamos também a bandeira e os 4 últimos (pra você reconhecer o cartão), e
                o código de autorização vale para cobranças suas na nossa conta — não fica
                amarrado a uma assinatura específica. Fora da Kora ele não serve pra nada,
                que é o ponto que importa e continua verdadeiro. */}
            <li>· Do cartão guardamos só a bandeira e os 4 últimos dígitos, mais um código de autorização que não funciona fora da Kora. O número completo fica com o Asaas.</li>
            <li>· Para cancelar, fale com a gente — <strong>o acesso continua até o fim do período já pago</strong>, sem estorno proporcional.</li>
          </ul>
        </details>
      </div>

      {/* ── RODAPÉ GRUDADO: erro, CTA e a linha de segurança ───────────────────── */}
      <div className="sticky bottom-0 z-10 mt-4 px-5 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-white border-t border-slate-100">
        {erro && (
          <div role="alert"
            className={`mb-2.5 flex items-start gap-2 rounded-lg border px-3 py-2.5 ${
              ambar ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-100"
            }`}>
            <AlertCircle className={`size-4 shrink-0 mt-px ${ambar ? "text-amber-600" : "text-red-600"}`} />
            <div className="min-w-0">
              <p className={`text-xs ${ambar ? "text-amber-900" : "text-red-800"}`}>{erro}</p>
              {/* ⚠️ O link humano aparece a partir da SEGUNDA recusa — ou já na primeira se
                  o teto bateu. Oferecer suporte na primeira seria empurrar pra fila de
                  atendimento quem só errou um dígito; deixar de oferecer na terceira é
                  abandonar quem já não vai resolver sozinho (a próxima tentativa bate no
                  teto anti card-testing e vira um erro pior). */}
              {(recusas >= 2 || bloqueado) && (
                <a href={linkSuporte("Olá! Estou com problema no cartão para assinar o Kora.")}
                  target="_blank" rel="noopener noreferrer"
                  className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${ambar ? "text-amber-900" : "text-red-900"} hover:underline`}>
                  <MessageCircle className="size-3.5" /> Falar no WhatsApp
                </a>
              )}
              {semSessao && (
                <Link href="/auth/signin"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-900 hover:underline">
                  Entrar de novo
                </Link>
              )}
            </div>
          </div>
        )}

        {/* 🔴 O TETO NÃO DESABILITA O BOTÃO (achado da revisão, 07/08). Ele desabilitava —
            e a janela do teto é de UMA HORA, então a pessoa lia "aguarde alguns minutos",
            esperava, voltava e encontrava um botão morto sem nenhuma explicação, até
            recarregar a página. Deixar clicável não custa nada (o teto é verificado no
            servidor ANTES de qualquer chamada ao gateway) e devolve a resposta verdadeira
            do momento em vez de um botão apagado. */}
        <button type="submit" disabled={pending}
          className="w-full h-12 sm:h-11 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {pending ? <><Loader2 className="size-4 animate-spin" /> Validando com o banco…</> : cta}
        </button>

        {pending ? (
          <p className="mt-2 text-center text-[11px] font-medium text-amber-700">Não feche esta janela.</p>
        ) : (
          // ⚠️ Linha ESTÁTICA (não um `<details>`): expandir logo abaixo do CTA deslocaria
          //    o botão no instante do clique. Quem quiser detalhe abre o bloco do miolo.
          <p className="mt-2 hidden sm:flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
            Conexão criptografada · não guardamos o número do seu cartão · processado pelo Asaas
          </p>
        )}
      </div>
    </form>
  )
}

// ⚠️ `text-base` no celular é OBRIGATÓRIO: abaixo de 16px o iOS dá zoom automático ao
//    focar o campo e desalinha o modal inteiro — a pessoa perde o herói de vista e passa a
//    rolar lateralmente no meio do pagamento.
const INPUT = "w-full h-12 sm:h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-300 outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-2 focus:ring-primary/20"
const INPUT_ERRO = "border-red-300 focus:border-red-500 focus:ring-red-500/20"

/**
 * A fileira "Aceitamos".
 *
 * 🔑 Ela responde "o meu é aceito?" sozinha: reconhecida a bandeira, as outras desbotam e
 *    a dela ganha realce. Nenhuma frase faz isso com a mesma economia.
 * ⚠️ Bandeira fora da fileira (Diners) deixa TODAS acesas em vez de apagar as cinco: uma
 *    fileira inteiramente cinza leria como "o seu não serve", e serve.
 */
function Aceitas({ marca, className = "", comRotulo = false }: {
  marca: Bandeira | null; className?: string; comRotulo?: boolean
}) {
  const naFileira = !!marca && BANDEIRAS_ACEITAS.includes(marca)
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      {comRotulo && <span className="text-[11px] text-slate-400">Aceitamos</span>}
      {BANDEIRAS_ACEITAS.map((b) => (
        <span key={b}
          className={`rounded-md transition-[opacity,filter] duration-200 ${
            marca === b ? "ring-1 ring-primary-200" : naFileira ? "opacity-30 grayscale" : ""
          }`}>
          <BandeiraLogo marca={b} size={18} />
        </span>
      ))}
    </span>
  )
}

function Campo({ id, label, erro, dica, extra, children }: {
  id: string; label: string; erro?: string; dica?: string
  /** Conteúdo ancorado à direita do rótulo (a fileira de bandeiras aceitas). */
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={id} className="block text-xs font-semibold text-slate-700 min-w-0 truncate">{label}</label>
        {extra}
      </div>
      {children}
      {/* ⚠️ Erro tem precedência sobre a dica: mostrar os dois empilha ruído embaixo de um
          campo estreito e a pessoa lê o menos importante primeiro. */}
      {erro
        ? <p className="mt-1 text-[11px] font-medium text-red-600">{erro}</p>
        : dica ? <p className="mt-1 text-[11px] text-slate-400">{dica}</p> : null}
    </div>
  )
}
