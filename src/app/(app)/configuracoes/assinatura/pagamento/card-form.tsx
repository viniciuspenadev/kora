"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Lock, CheckCircle2, CreditCard } from "lucide-react"
import { maskCpfCnpj, maskCep, maskPhone } from "@/lib/masks"
import { ativarAssinatura, type TitularPreenchido } from "@/lib/actions/subscription"

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
  /** Empilha o resumo em cima do formulário (coluna única) — pra caber dentro do modal. */
  compacto?: boolean
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

export function CardForm({ titular, planoId, planoNome, valorCents, primeiraCobranca, emTrial, onSucesso, onEditarCadastro, compacto = false }: Props) {
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
      const r = await ativarAssinatura({
        planoId,
        holderName:  nome,
        number:      digitos,
        expiryMonth: mm ?? "",
        expiryYear:  `20${aa ?? ""}`,
        ccv:         cvv,
      })
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
        <h2 className="mt-3 text-base font-bold text-slate-900">Recebemos seu pagamento</h2>
        <p className="mt-1 text-sm text-slate-600 leading-relaxed">
          {primeiraCobranca
            ? <>A primeira cobrança de <strong>{brl(valorCents)}</strong> acontece em <strong>{primeiraCobranca}</strong>.</>
            : <>A cobrança de <strong>{brl(valorCents)}</strong> passa a ser mensal.</>}
          {" "}A confirmação do banco leva alguns segundos.
        </p>
        <button onClick={() => router.push("/configuracoes/assinatura")}
          className="mt-4 h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90">
          Ver minha assinatura
        </button>
      </div>
    )
  }

  return (
    <div className={compacto ? "space-y-4" : "grid gap-5 lg:grid-cols-[1fr_320px] items-start"}>
      {/* ── Quem está sendo cobrado ────────────────────────────────────────────────
          🔑 IDEIA DO DONO (05/08), e ela conserta uma classe inteira de falha: todo
             checkout sério mostra os dados do titular antes de pedir o cartão. Não é
             burocracia — é a única chance da pessoa VER um dado errado antes de pagar.
             O caso que motivou: um telefone inválido guardado no cadastro derrubou a
             cobrança, e ele não aparecia em tela nenhuma do fluxo. Com este bloco, o
             erro fica visível ANTES do cartão, e não depois da recusa.
          ⚠️ Também protege contra contestação: o titular confirma que é ele quem paga. */}
      <div className={compacto ? "" : "lg:col-span-2"}>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cobrança em nome de</p>
              <p className="mt-1 text-sm font-semibold text-slate-900 truncate">{titular.nome}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {[maskCpfCnpj(titular.cpfCnpj), titular.email].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs text-slate-500">
                {[titular.cep && `CEP ${maskCep(titular.cep)}`, titular.numero && `nº ${titular.numero}`,
                  titular.telefone && maskPhone(titular.telefone)].filter(Boolean).join(" · ")}
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
      </div>

      {/* ── Formulário ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Dados do cartão</h2>
          {marca && (
            <span className="text-[11px] font-semibold text-slate-500 border border-slate-200 rounded-md px-2 py-0.5">
              {marca}
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Cartão que preenche ao vivo — o retorno visual que confirma "está indo bem". */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-white">
            <div className="flex items-center justify-between">
              <CreditCard className="size-5 text-slate-400" />
              <span className="text-[11px] text-slate-400">{marca ?? "—"}</span>
            </div>
            <p className="mt-5 font-mono text-lg tracking-[0.12em] tabular-nums">
              {grupos(digitos).padEnd(19, "•").slice(0, 23)}
            </p>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">Titular</p>
                <p className="text-xs font-medium truncate">{nome || "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">Validade</p>
                <p className="text-xs font-medium tabular-nums">{validade || "MM/AA"}</p>
              </div>
            </div>
          </div>

          <Campo label="Número do cartão" erro={tocado.numero ? erros.numero : undefined}>
            <input
              value={grupos(numero)} inputMode="numeric" autoComplete="cc-number"
              onChange={(e) => setNumero(e.target.value.replace(/\D/g, "").slice(0, 19))}
              onBlur={() => setTocado((t) => ({ ...t, numero: true }))}
              placeholder="0000 0000 0000 0000"
              className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm font-mono tabular-nums outline-none focus:border-primary"
            />
          </Campo>

          <Campo label="Nome impresso no cartão" erro={tocado.nome ? erros.nome : undefined}>
            <input
              value={nome} autoComplete="cc-name"
              onChange={(e) => setNome(e.target.value.toUpperCase())}
              onBlur={() => setTocado((t) => ({ ...t, nome: true }))}
              placeholder="COMO ESTÁ NO CARTÃO"
              className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm uppercase outline-none focus:border-primary"
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
                className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm tabular-nums outline-none focus:border-primary"
              />
            </Campo>
            <Campo label="CVV" erro={tocado.cvv ? erros.cvv : undefined}>
              <input
                value={cvv} inputMode="numeric" autoComplete="cc-csc"
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onBlur={() => setTocado((t) => ({ ...t, cvv: true }))}
                placeholder="000"
                className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm tabular-nums outline-none focus:border-primary"
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
            {pending ? "Validando com o banco…" : `Ativar assinatura de ${brl(valorCents)}/mês`}
          </button>

          {/* 🔒 A SEGURANÇA EXPLICADA EM PORTUGUÊS — pedido explícito do dono, e é o que
              de fato reduz abandono num formulário de cartão. Cada frase é verificável no
              código; nenhuma promete mais do que a implementação faz. */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <ShieldCheck className="size-3.5 text-slate-600" /> Como seus dados são tratados
            </p>
            <ul className="space-y-1.5 text-[11px] text-slate-600 leading-relaxed">
              <li>· A conexão é criptografada de ponta a ponta.</li>
              <li>· O pagamento é processado pelo <strong>Asaas</strong>, instituição autorizada pelo Banco Central.</li>
              <li>· <strong>A Kora não guarda o número do seu cartão.</strong> Guardamos apenas um código de autorização, que serve só para cobrar esta assinatura e não permite compras em nenhum outro lugar.</li>
              <li>· Você pode cancelar quando quiser — e <strong>o acesso continua até o fim do período já pago</strong>.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── O que está sendo contratado ────────────────────────── */}
      <aside className="rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden lg:sticky lg:top-4">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Resumo</h2>
        </div>
        <div className="p-5 space-y-3">
          <Linha termo="Plano" valor={planoNome} />
          <Linha termo="Cobrança" valor={`${brl(valorCents)} por mês`} />
          {primeiraCobranca && (
            <Linha termo={emTrial ? "1ª cobrança (fim do teste)" : "1ª cobrança"} valor={primeiraCobranca} />
          )}
          <div className="pt-3 border-t border-slate-100">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {emTrial
                ? "Seu teste segue normalmente até a data acima. A primeira cobrança acontece exatamente quando ele termina — nada é cobrado agora."
                : "A cobrança é mensal e automática, sempre no mesmo dia."}
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-700">Titular</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              {titular.nome}<br />{titular.cpfCnpj}
            </p>
            <p className="text-[10px] text-slate-400 mt-1.5">
              Dados do seu cadastro. Para alterar, ajuste em Configurações.
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Campo({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {children}
      {erro && <p className="mt-1 text-[11px] font-medium text-red-600">{erro}</p>}
    </div>
  )
}

function Linha({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-slate-500">{termo}</span>
      <span className="text-xs font-semibold text-slate-900 text-right">{valor}</span>
    </div>
  )
}
