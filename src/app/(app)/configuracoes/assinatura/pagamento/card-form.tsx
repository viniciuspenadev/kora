"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Lock, CheckCircle2 } from "lucide-react"
import { maskCpfCnpj, maskPhone } from "@/lib/masks"
import { ativarAssinatura, trocarCartaoDaAssinatura, type TitularPreenchido } from "@/lib/actions/subscription"

// ═══════════════════════════════════════════════════════════════
// Ativar assinatura — captura de cartão
// ═══════════════════════════════════════════════════════════════
// 🔴 DECISÕES DE UX QUE SÃO, NA VERDADE, DECISÕES DE CONFIANÇA:
//
// 1. **O preço e a DATA aparecem antes do formulário.** Ninguém digita cartão sem saber
//    quanto e quando. Esconder isso até o fim é o padrão de quem quer que a pessoa se
//    comprometa antes de somar — e é o que gera contestação depois.
// 2. **O que a Kora faz com o cartão é dito em português**, não em selo. Uma fileira de
//    cadeados coloridos comunica menos que uma frase que explica que a gente não guarda
//    o número. E é verificável: `lib/asaas/subscriptions.ts` guarda só o token.
// 3. **Validação enquanto digita, erro só depois de sair do campo.** Acusar erro no
//    segundo caractere do número do cartão é hostilizar quem está tentando pagar.
// 4. **Nenhum dado do cartão sai deste componente** a não ser na chamada da action.
//    Sem draft em localStorage, sem analytics, sem log.

interface Props {
  titular:    TitularPreenchido
  /** Id do plano a contratar. Viaja com o cartão e é revalidado no servidor. */
  planoId:    string
  planoNome:  string
  valorCents: number
  primeiraCobranca: string | null
  emTrial:    boolean
  /** Volta pro passo de cadastro (contexto do modal). Ausente ⇒ link pra /configuracoes/empresa. */
  onEditarCadastro?: () => void
  /**
   * O que fazer quando o pagamento passa. Ausente ⇒ mostra a tela de sucesso própria
   * (uso na página `/pagamento`).
   *
   * ⚠️ Existe pro modal de planos hospedar ESTE formulário em vez de ganhar um segundo.
   *    Duas telas de cartão seriam duas superfícies PCI pra auditar, duas validações de
   *    Luhn e duas chances de uma delas esquecer de limpar o campo na saída.
   */
  onSucesso?: () => void
  /**
   * O que este formulário faz com o cartão.
   *
   * 🔑 UM formulário, dois usos — e a diferença é de PROMESSA, não de layout: em
   *    `assinar` o clique cobra; em `trocar` não sai um centavo, só a próxima cobrança
   *    passa a usar o cartão novo. Dois componentes seriam duas superfícies PCI pra
   *    auditar, duas validações de Luhn e duas chances de uma esquecer de limpar o campo.
   */
  modo?: "assinar" | "trocar"
  // ⚠️ `compacto` SAIU no redesenho de 07/08. Ele existia pra empilhar o resumo lateral
  //    dentro do modal — e o resumo lateral deixou de existir (era repetição do herói).
  //    Prop que não faz nada é contrato mentindo: quem lê acha que tem duas variantes
  //    pra manter, e uma delas envelhece sem ninguém notar.
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

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

/** Bandeira pelo prefixo — só pra dar retorno visual; quem valida de verdade é o gateway. */
function bandeira(num: string): string | null {
  const d = num.replace(/\D/g, "")
  if (/^4/.test(d)) return "Visa"
  if (/^(5[1-5]|2[2-7])/.test(d)) return "Mastercard"
  if (/^3[47]/.test(d)) return "Amex"
  if (/^(38|60|6[45])/.test(d)) return "Elo"
  if (/^(606282|3841)/.test(d)) return "Hipercard"
  return null
}

const grupos = (d: string) => d.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim()

export function CardForm({ titular, planoId, planoNome, valorCents, primeiraCobranca, emTrial, onSucesso, onEditarCadastro, modo = "assinar" }: Props) {
  const trocando = modo === "trocar"
  const router = useRouter()
  const [numero, setNumero]   = useState("")
  const [nome, setNome]       = useState(titular.nome.toUpperCase())
  const [validade, setValidade] = useState("")
  const [cvv, setCvv]         = useState("")
  const [tocado, setTocado]   = useState<Record<string, boolean>>({})
  const [erro, setErro]       = useState<string | null>(null)
  const [pronto, setPronto]   = useState(false)
  const [pending, start]      = useTransition()

  const marca = bandeira(numero)
  const digitos = numero.replace(/\D/g, "")
  const [mm, aa] = validade.split("/")

  const erros = useMemo(() => {
    const e: Record<string, string> = {}
    if (digitos.length > 0 && !luhnOk(digitos)) e.numero = "Confira o número do cartão."
    if (nome.trim().length > 0 && nome.trim().length < 3) e.nome = "Nome muito curto."
    if (validade.length >= 5) {
      const m = Number(mm), a = 2000 + Number(aa)
      const fim = new Date(a, m, 0, 23, 59, 59)
      if (!(m >= 1 && m <= 12)) e.validade = "Mês inválido."
      else if (fim < new Date()) e.validade = "Cartão vencido."
    }
    if (cvv.length > 0 && cvv.length < 3) e.cvv = "3 ou 4 dígitos."
    return e
  }, [digitos, nome, validade, mm, aa, cvv])

  const completo = luhnOk(digitos) && nome.trim().length >= 3 && validade.length === 5 && cvv.length >= 3
  const podeEnviar = completo && Object.keys(erros).length === 0 && !pending

  function enviar() {
    setErro(null)
    start(async () => {
      const dados = {
        holderName:  nome,
        number:      digitos,
        expiryMonth: mm ?? "",
        expiryYear:  `20${aa ?? ""}`,
        ccv:         cvv,
      }
      const r = trocando
        ? await trocarCartaoDaAssinatura(dados)
        : await ativarAssinatura({ planoId, ...dados })
      // ⚠️ Em QUALQUER saída, o cartão sai da memória do componente. Não fica "pro caso de
      //    tentar de novo" — a pessoa redigita, que é barato, e nada sensível sobrevive na
      //    aba aberta.
      setNumero(""); setCvv(""); setValidade("")
      if ("error" in r) { setErro(r.error); return }
      // Host decide o que vem depois (modal segue pro passo final; página mostra a
      // tela de sucesso daqui). Em ambos o cartão já foi limpo antes.
      if (onSucesso) { onSucesso(); return }
      setPronto(true)
      router.refresh()
    })
  }

  if (pronto) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 text-center">
        <CheckCircle2 className="size-8 text-emerald-600 mx-auto" />
        {/* ⚠️ "Recebemos", não "ativada": cartão aceito ≠ pagamento confirmado. Quem libera
            o produto é o webhook do gateway, que chega segundos depois. Afirmar ativação
            aqui é a tela prometer um estado que o servidor ainda não tem — e no caminho do
            teste encerrado isso mandava a pessoa de volta pro paywall logo após pagar. */}
        <h2 className="mt-3 text-base font-bold text-slate-900">
          {trocando ? "Cartão atualizado" : "Recebemos seu pagamento"}
        </h2>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
          {trocando
            // ⚠️ Trocar cartão NÃO cobra — e dizer isso explicitamente evita o susto de
            //    quem espera um débito que não vem, e a ligação pro suporte junto.
            ? <>Nada foi cobrado agora. A partir da próxima cobrança{primeiraCobranca ? <> — <strong>{primeiraCobranca}</strong></> : null}, usamos este cartão.</>
            : primeiraCobranca
            ? <>Cobrança de <strong>{brl(valorCents)}</strong> feita em <strong>{primeiraCobranca}</strong>. A partir daqui ela é mensal e automática.</>
            : <>A cobrança de <strong>{brl(valorCents)}</strong> passa a ser mensal.</>}
          {trocando ? null : <>{" "}A confirmação do banco leva alguns segundos.</>}
        </p>
        <button onClick={() => router.push("/configuracoes/assinatura")}
          className="mt-4 h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
          Ver minha assinatura
        </button>
      </div>
    )
  }

  return (
    // ⚠️ UM layout só pra modal e página (antes o `compacto` bifurcava em grid de 2
    //    colunas). Checkout é tela de FOCO — largura estreita ajuda em qualquer lugar, e
    //    duas variantes eram duas chances de uma envelhecer.
    <div className="space-y-4 max-w-lg">
      {/* ── O HERÓI: o que vai ser cobrado ───────────────────────────────────────
          🔴 REDESENHO (dono, 07/08: "muito mal feita e nem um pouco intuitiva").
             O valor — única coisa que a pessoa precisa confirmar antes de digitar o
             cartão — aparecia em `text-sm` dentro do botão e numa linha de resumo, com o
             mesmo peso do rótulo. Pelo §0.5 do design system isso é o sintoma exato de
             "cara de IA": nenhum ponto de foco. Agora ele é âncora — `text-2xl`, bold,
             `tabular-nums`, à direita.
          ⚠️ Painel com divisória, não dois cards: o titular entra como segunda faixa do
             MESMO bloco (§0.6.2). Antes ele era um card à parte E se repetia no resumo
             lateral — a mesma informação, duas vezes, na mesma tela. */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Plano</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900 truncate">{planoNome}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{brl(valorCents)}</p>
            {/* ⚠️ A legenda muda com o MODO, porque a promessa muda: contratar cobra hoje;
                trocar cartão não cobra nada — dizer "cobrado hoje" ali seria prometer um
                débito que não vai acontecer. */}
            <p className="mt-1 text-[11px] text-slate-400">
              {trocando
                ? (primeiraCobranca ? `por mês · próxima em ${primeiraCobranca}` : "por mês")
                : `por mês${primeiraCobranca ? ` · cobrado hoje, ${primeiraCobranca}` : ""}`}
            </p>
          </div>
        </div>

        {/* Titular — linha densa e conferível. É a única chance de a pessoa ver um dado
            errado ANTES de pagar (foi um telefone inválido que derrubou uma cobrança). */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cobrança em nome de</p>
            <p className="mt-0.5 text-sm font-medium text-slate-800 truncate">{titular.nome}</p>
            <p className="text-xs text-slate-500 truncate">
              {[maskCpfCnpj(titular.cpfCnpj), titular.telefone && maskPhone(titular.telefone)].filter(Boolean).join(" · ")}
            </p>
          </div>
          {onEditarCadastro ? (
            <button type="button" onClick={onEditarCadastro}
              className="shrink-0 text-xs font-semibold text-primary hover:underline">
              Editar
            </button>
          ) : (
            <Link href="/configuracoes/empresa" className="shrink-0 text-xs font-semibold text-primary hover:underline">
              Editar
            </Link>
          )}
        </div>
      </div>

      {/* ── Os campos, sem nada entre a decisão e a ação ───────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="p-5 space-y-3.5">
          <Campo label="Número do cartão" erro={tocado.numero ? erros.numero : undefined}>
            {/* 🔑 A bandeira virou chip DENTRO do campo, onde ela significa algo — antes
                era um cartão desenhado de ~120px que só repetia o que a pessoa acabou de
                digitar. Num modal de altura travada, aquilo empurrava o botão pra fora da
                vista, e o custo de rolar num checkout é desistência. */}
            <div className="relative">
              <input
                value={grupos(numero)} inputMode="numeric" autoComplete="cc-number"
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, "").slice(0, 19))}
                onBlur={() => setTocado((t) => ({ ...t, numero: true }))}
                placeholder="0000 0000 0000 0000"
                className="w-full h-10 rounded-lg border border-slate-200 pl-3 pr-20 text-sm font-mono tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
              />
              {marca && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                  {marca}
                </span>
              )}
            </div>
          </Campo>

          <Campo label="Nome impresso no cartão" erro={tocado.nome ? erros.nome : undefined}>
            <input
              value={nome} autoComplete="cc-name"
              onChange={(e) => setNome(e.target.value.toUpperCase())}
              onBlur={() => setTocado((t) => ({ ...t, nome: true }))}
              placeholder="COMO ESTÁ NO CARTÃO"
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm uppercase outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo label="Validade" erro={tocado.validade ? erros.validade : undefined}>
              <input
                value={validade} inputMode="numeric" autoComplete="cc-exp"
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 4)
                  setValidade(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d)
                }}
                onBlur={() => setTocado((t) => ({ ...t, validade: true }))}
                placeholder="MM/AA"
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
              />
            </Campo>
            <Campo label="CVV" erro={tocado.cvv ? erros.cvv : undefined} hint="3 dígitos no verso">
              <input
                value={cvv} inputMode="numeric" autoComplete="cc-csc"
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onBlur={() => setTocado((t) => ({ ...t, cvv: true }))}
                placeholder="000"
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-shadow"
              />
            </Campo>
          </div>

          {erro && (
            <p className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}

          <button
            type="button" onClick={enviar} disabled={!podeEnviar}
            className="w-full h-11 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Lock className="size-4" />
            {pending
              ? "Validando com o banco…"
              : trocando ? "Salvar novo cartão" : `Ativar assinatura de ${brl(valorCents)}/mês`}
          </button>

          {/* 🔒 A SEGURANÇA CONTINUA DITA EM PORTUGUÊS (pedido do dono) — mas em UMA linha,
              com o detalhe atrás de um "saiba mais". Antes eram quatro linhas de texto
              miúdo entre os campos e o botão: informação boa, no lugar errado. Quem quer
              ler, abre; quem quer pagar, paga. Nenhuma frase promete mais do que o código
              faz — cada uma é verificável em `asaas/subscriptions.ts`. */}
          <details className="group rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <summary className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer list-none">
              <ShieldCheck className="size-3.5 text-emerald-600 shrink-0" />
              <span><strong className="font-semibold text-slate-700">Não guardamos seu cartão.</strong> Processado pelo Asaas.</span>
              <span className="ml-auto text-primary font-semibold group-open:hidden">saiba mais</span>
            </summary>
            <ul className="mt-2 space-y-1.5 text-[11px] text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
              <li>· A conexão é criptografada de ponta a ponta.</li>
              <li>· O pagamento é processado pelo <strong>Asaas</strong>, instituição autorizada pelo Banco Central.</li>
              <li>· Guardamos apenas um código de autorização, que serve só para cobrar esta assinatura e não permite compras em nenhum outro lugar.</li>
              <li>· Você pode cancelar quando quiser — e <strong>o acesso continua até o fim do período já pago</strong>.</li>
            </ul>
          </details>
        </div>
      </div>

      {/* 🔴 O "Resumo" LATERAL SAIU (07/08). Ele repetia plano, valor, data e titular —
          tudo que o herói acima já mostra, e com MENOS presença. Duas superfícies
          dizendo o mesmo na mesma tela não é reforço: é ruído que empurra o botão pra
          baixo da dobra e cria duas versões pra manter (uma envelhece).
          A única frase que ele tinha de próprio — o que acontece ao cobrar — virou a
          legenda abaixo, junto do botão, que é onde ela é lida. */}
      <p className="text-[11px] text-slate-400 leading-relaxed">
        {trocando
          ? "Nada é cobrado agora. O cartão novo passa a valer a partir da próxima cobrança — e também nas cobranças em aberto, se houver alguma."
          : emTrial
          ? "A cobrança acontece agora e o plano libera em seguida. Você abre mão dos dias restantes de teste — em troca, passa a usar o plano completo hoje."
          : "A cobrança é mensal e automática, sempre no mesmo dia."}
      </p>
    </div>
  )
}

function Campo({ label, erro, hint, children }: {
  label: string; erro?: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
      {/* ⚠️ Erro tem precedência sobre a dica: mostrar os dois empilha ruído embaixo de um
          campo estreito e a pessoa lê o menos importante primeiro. */}
      {erro
        ? <p className="mt-1 text-[11px] font-medium text-red-600">{erro}</p>
        : hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  )
}
