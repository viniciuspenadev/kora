"use client"

import { useState, useRef, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import {
  Building2, User, MapPin, Compass, Sparkles, Loader2, ArrowRight, ArrowLeft,
  Check, AlertCircle, PartyPopper,
} from "lucide-react"
import { maskCpfCnpj, maskCep, maskPhone, isValidCpf, isValidCnpj } from "@/lib/masks"
import { lookupCnpj } from "@/lib/cnpj"
import { lookupCep } from "@/lib/cep"
import { saveMyCompanyProfile, type PerfilEmpresa } from "@/lib/actions/company-profile"
import { saveOnboardingSurvey, finishOnboarding, skipOnboarding } from "@/lib/actions/onboarding-profile"
import { ORIGENS, SEGMENTOS, TAMANHOS, FERRAMENTAS, type Opcao } from "@/lib/onboarding-options"

// ═══════════════════════════════════════════════════════════════
// O wizard
// ═══════════════════════════════════════════════════════════════
// ⚠️ SALVA A CADA PASSO, não só no fim. Wizard que guarda tudo pra o botão final é wizard
//    que perde o trabalho da pessoa quando a aba fecha — e ela não recomeça.
// ⚠️ A parte fiscal reusa `saveMyCompanyProfile`: mesma allow-list, mesma checagem de
//    documento duplicado, mesmo espelho no Asaas da tela de Configurações. Uma segunda
//    porta de escrita no cadastro fiscal seria uma segunda régua do que é válido.

const INP =
  "w-full h-11 px-3.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-shadow disabled:bg-slate-50"

type Passo = 0 | 1 | 2 | 3 | 4
const TITULOS = ["Sua empresa", "Endereço", "Como nos conheceu", "Seu momento"]

interface Pesquisa {
  acquisition_source: string
  acquisition_detail: string
  business_segment:   string
  team_size:          string
  current_tool:       string
}

type Campos = Omit<PerfilEmpresa, "documento_travado" | "completo">

export function BemVindoWizard({
  primeiroNome, nomeTenant, perfil, pesquisa: pesquisaInicial, reeditando,
}: {
  primeiroNome: string
  nomeTenant:   string
  perfil:       PerfilEmpresa
  pesquisa:     Pesquisa
  reeditando:   boolean
}) {
  const router = useRouter()
  const [pending, startT] = useTransition()

  const { documento_travado: docTravado, completo: _c, ...camposIniciais } = perfil
  const [f, setF] = useState<Campos>(() => ({ ...camposIniciais }))
  const [p, setP] = useState<Pesquisa>(() => ({ ...pesquisaInicial }))

  const [passo, setPasso] = useState<Passo>(0)
  const [erro, setErro]   = useState("")

  const [buscandoDoc, setBuscandoDoc] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [notaDoc, setNotaDoc]         = useState("")

  const numeroRef = useRef<HTMLInputElement | null>(null)
  const ultimoDoc = useRef("")
  const ultimoCep = useRef("")

  const ehPF = f.person_type === "pf"
  const set  = useCallback((k: keyof Campos, v: string) => {
    setF((x) => ({ ...x, [k]: v })); setErro("")
  }, [])

  // ── Autofills — os mesmos motores da tela de Configurações ────────────────
  async function consultarCnpj(valor: string) {
    const d = valor.replace(/\D/g, "")
    if (d.length !== 14 || !isValidCnpj(d) || d === ultimoDoc.current) return
    ultimoDoc.current = d
    setBuscandoDoc(true); setNotaDoc("")
    const r = await lookupCnpj(d)
    setBuscandoDoc(false)
    if (!r) { setNotaDoc("Não encontramos este CNPJ agora — pode preencher à mão."); return }
    setF((x) => ({
      ...x,
      legal_name:    r.razao_social  || x.legal_name,
      trade_name:    r.nome_fantasia || x.trade_name,
      billing_email: x.billing_email || r.email || "",
      phone:         x.phone         || (r.telefone ? maskPhone(r.telefone) : ""),
      zip:           r.address?.cep  ? maskCep(r.address.cep) : x.zip,
      street:        r.address?.street     || x.street,
      number:        r.address?.number     || x.number,
      complement:    r.address?.complement || x.complement,
      district:      r.address?.district   || x.district,
      city:          r.address?.city       || x.city,
      state:         r.address?.state      || x.state,
    }))
    if (r.address?.cep) ultimoCep.current = r.address.cep.replace(/\D/g, "")
    setNotaDoc("Pronto — preenchemos com os dados da Receita Federal.")
  }

  async function consultarCep(valor: string) {
    const d = valor.replace(/\D/g, "")
    if (d.length !== 8 || d === ultimoCep.current) return
    ultimoCep.current = d
    setBuscandoCep(true)
    const r = await lookupCep(d)
    setBuscandoCep(false)
    if (!r) return
    setF((x) => ({
      ...x,
      street: r.street || x.street, district: r.district || x.district,
      city:   r.city   || x.city,   state:    r.state    || x.state,
    }))
    setTimeout(() => numeroRef.current?.focus(), 60)
  }

  // ── Navegação ─────────────────────────────────────────────────────────────
  function validarPassoAtual(): string | null {
    if (passo === 0) {
      const doc = f.tax_id.replace(/\D/g, "")
      if (!doc) return ehPF ? "Informe o CPF." : "Informe o CNPJ."
      if (ehPF && !isValidCpf(doc))   return "CPF inválido. Confira os números."
      if (!ehPF && !isValidCnpj(doc)) return "CNPJ inválido. Confira os números."
      if (f.legal_name.trim().length < 2) return ehPF ? "Informe seu nome completo." : "Informe a razão social."
    }
    if (passo === 1) {
      if (f.zip.replace(/\D/g, "").length !== 8) return "Informe um CEP válido."
      if (!f.number.trim()) return "Informe o número (use S/N se não houver)."
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.billing_email.trim())) return "Informe um e-mail de faturamento válido."
    }
    return null
  }

  /** Grava o cadastro fiscal. Chamado ao sair do passo 1 (empresa + endereço completos). */
  async function salvarFiscal(): Promise<boolean> {
    const r = await saveMyCompanyProfile({
      person_type: f.person_type, legal_name: f.legal_name, trade_name: f.trade_name,
      tax_id: f.tax_id, state_registration: f.state_registration,
      municipal_registration: f.municipal_registration, billing_email: f.billing_email,
      phone: f.phone, responsible_name: f.responsible_name, zip: f.zip, street: f.street,
      number: f.number, complement: f.complement, district: f.district, city: f.city, state: f.state,
    })
    if (r.error) { setErro(r.error); return false }
    return true
  }

  function avancar() {
    const problema = validarPassoAtual()
    if (problema) { setErro(problema); return }
    setErro("")

    startT(async () => {
      // Passo 1 fecha o bloco fiscal → grava antes de seguir.
      if (passo === 1 && !(await salvarFiscal())) return
      // Passo 3 é o último → grava a pesquisa e conclui.
      if (passo === 3) {
        const s = await saveOnboardingSurvey(p)
        if (s.error) { setErro(s.error); return }
        const fim = await finishOnboarding()
        if (fim.error) { setErro(fim.error); return }
        setPasso(4)
        return
      }
      setPasso((x) => (x + 1) as Passo)
    })
  }

  function pular() {
    startT(async () => {
      // ⚠️ Salva o que já foi preenchido antes de sair. "Depois" não pode significar
      //    "joga fora o que eu digitei" — se a pessoa preencheu 2 passos e desistiu no 3º,
      //    aqueles 2 passos valem.
      if (passo >= 1) await salvarFiscal()
      if (passo >= 2) await saveOnboardingSurvey(p)
      await skipOnboarding()
      router.push("/inbox")
    })
  }

  const ultimo = passo === 3

  // ── Tela final ────────────────────────────────────────────────────────────
  if (passo === 4) {
    return (
      <Casca>
        <div className="text-center py-10">
          <div className="mx-auto size-16 rounded-full bg-emerald-50 ring-1 ring-emerald-200 flex items-center justify-center">
            <PartyPopper className="size-8 text-emerald-600" />
          </div>
          <h1 className="mt-6 text-2xl font-bold text-slate-900 tracking-tight">Cadastro completo!</h1>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
            Tudo certo pra quando você quiser assinar — não vamos pedir nada de novo.
            Agora é conectar seu WhatsApp e começar a atender.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-2.5 justify-center">
            <button type="button" onClick={() => router.push("/integracoes")}
              className="h-11 px-5 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors">
              Conectar meu WhatsApp <ArrowRight className="size-4" />
            </button>
            <button type="button" onClick={() => router.push("/inbox")}
              className="h-11 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors">
              Ir para a plataforma
            </button>
          </div>
        </div>
      </Casca>
    )
  }

  return (
    <Casca>
      {/* Trilha de progresso */}
      <div className="flex items-center gap-1.5 mb-8">
        {TITULOS.map((t, i) => (
          <div key={t} className="flex-1">
            <div className={`h-1 rounded-full transition-colors ${i <= passo ? "bg-primary" : "bg-slate-200"}`} />
            <p className={`mt-2 text-[10px] font-semibold uppercase tracking-wide transition-colors hidden sm:block ${
              i === passo ? "text-primary-700" : i < passo ? "text-slate-400" : "text-slate-300"
            }`}>{t}</p>
          </div>
        ))}
      </div>

      {/* ── 0 · Empresa ────────────────────────────────────────────────────── */}
      {passo === 0 && (
        <Bloco
          titulo={primeiroNome ? `Prazer, ${primeiroNome}!` : "Vamos começar"}
          subtitulo={`Só confirmando quem é o titular${nomeTenant ? ` da ${nomeTenant}` : ""} — é o que usamos na nota e na cobrança.`}>

          <div className="grid grid-cols-2 gap-2.5">
            {([
              { v: "pj", icone: Building2, t: "É uma empresa", s: "Tenho CNPJ" },
              { v: "pf", icone: User,      t: "Sou eu mesmo",  s: "Uso meu CPF" },
            ] as const).map(({ v, icone: Icone, t, s }) => {
              const ativo = f.person_type === v
              return (
                <button key={v} type="button" disabled={docTravado}
                  onClick={() => {
                    if (f.person_type === v) return
                    setF((x) => ({ ...x, person_type: v, tax_id: "" }))
                    setErro(""); setNotaDoc(""); ultimoDoc.current = ""
                  }}
                  className={`text-left rounded-xl border p-4 transition-colors disabled:opacity-60 ${
                    ativo ? "border-primary bg-primary-50" : "border-slate-300 bg-white hover:bg-slate-50"
                  }`}>
                  <Icone className={`size-5 ${ativo ? "text-primary-700" : "text-slate-400"}`} />
                  <p className={`mt-2.5 text-sm font-semibold ${ativo ? "text-primary-800" : "text-slate-800"}`}>{t}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s}</p>
                </button>
              )
            })}
          </div>

          <Campo rotulo={ehPF ? "CPF" : "CNPJ"}>
            <div className="relative">
              <input className={`${INP} pr-10`} value={f.tax_id} disabled={docTravado} inputMode="numeric"
                autoFocus placeholder={ehPF ? "000.000.000-00" : "00.000.000/0000-00"}
                onChange={(e) => { const v = maskCpfCnpj(e.target.value); set("tax_id", v); if (!ehPF) void consultarCnpj(v) }}
                onBlur={(e) => { if (!ehPF) void consultarCnpj(e.target.value) }} />
              {buscandoDoc && <Loader2 className="size-4 animate-spin text-primary absolute right-3.5 top-1/2 -translate-y-1/2" />}
            </div>
            {!ehPF && !notaDoc && (
              <Dica><Sparkles className="size-3 inline mr-1 -mt-0.5" />Digite o CNPJ e a gente busca o resto na Receita.</Dica>
            )}
            {notaDoc && <Dica destaque>{notaDoc}</Dica>}
          </Campo>

          <Campo rotulo={ehPF ? "Nome completo" : "Razão social"}>
            <input className={INP} value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)}
              placeholder={ehPF ? "Como está no documento" : "Como está no cartão CNPJ"} />
          </Campo>

          {!ehPF && (
            <Campo rotulo="Nome fantasia" opcional>
              <input className={INP} value={f.trade_name} onChange={(e) => set("trade_name", e.target.value)}
                placeholder="O nome que seus clientes conhecem" />
            </Campo>
          )}
        </Bloco>
      )}

      {/* ── 1 · Endereço + contato ─────────────────────────────────────────── */}
      {passo === 1 && (
        <Bloco titulo="Onde a gente te encontra"
               subtitulo="O banco confere este endereço quando você for assinar — por isso pedimos agora.">
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="CEP">
              <div className="relative">
                <input className={`${INP} pr-9`} value={f.zip} inputMode="numeric" autoFocus placeholder="00000-000"
                  onChange={(e) => { const v = maskCep(e.target.value); set("zip", v); void consultarCep(v) }}
                  onBlur={(e) => void consultarCep(e.target.value)} />
                {buscandoCep
                  ? <Loader2 className="size-4 animate-spin text-primary absolute right-3 top-1/2 -translate-y-1/2" />
                  : <MapPin className="size-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />}
              </div>
            </Campo>
            <div className="col-span-2">
              <Campo rotulo="Logradouro">
                <input className={INP} value={f.street} onChange={(e) => set("street", e.target.value)} />
              </Campo>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Número">
              <input ref={numeroRef} className={INP} value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="123 ou S/N" />
            </Campo>
            <Campo rotulo="Complemento" opcional>
              <input className={INP} value={f.complement} onChange={(e) => set("complement", e.target.value)} placeholder="Sala 4" />
            </Campo>
            <Campo rotulo="Bairro">
              <input className={INP} value={f.district} onChange={(e) => set("district", e.target.value)} />
            </Campo>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Campo rotulo="Cidade">
                <input className={INP} value={f.city} onChange={(e) => set("city", e.target.value)} />
              </Campo>
            </div>
            <Campo rotulo="UF">
              <input className={INP} value={f.state} maxLength={2} placeholder="SP"
                onChange={(e) => set("state", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
            </Campo>
          </div>

          <div className="pt-1 border-t border-slate-100" />

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="E-mail de faturamento">
              <input className={INP} type="email" value={f.billing_email}
                onChange={(e) => set("billing_email", e.target.value)} placeholder="financeiro@empresa.com" />
            </Campo>
            <Campo rotulo="Telefone" opcional>
              <input className={INP} value={f.phone} inputMode="tel"
                onChange={(e) => set("phone", maskPhone(e.target.value))} placeholder="(11) 99999-9999" />
            </Campo>
          </div>
        </Bloco>
      )}

      {/* ── 2 · Origem ─────────────────────────────────────────────────────── */}
      {passo === 2 && (
        <Bloco titulo="Como você chegou até a Kora?"
               subtitulo="Ajuda a gente a saber onde vale a pena estar. Uma resposta só.">
          <Opcoes lista={ORIGENS} valor={p.acquisition_source}
            onEscolher={(v) => setP((x) => ({ ...x, acquisition_source: v, acquisition_detail: "" }))} />
          {(() => {
            const escolhida = ORIGENS.find((o) => o.value === p.acquisition_source)
            if (!escolhida?.detalhe) return null
            return (
              <Campo rotulo={escolhida.detalhe} opcional>
                <input className={INP} value={p.acquisition_detail} maxLength={120} autoFocus
                  onChange={(e) => setP((x) => ({ ...x, acquisition_detail: e.target.value }))} />
              </Campo>
            )
          })()}
        </Bloco>
      )}

      {/* ── 3 · Perfil do negócio ──────────────────────────────────────────── */}
      {passo === 3 && (
        <Bloco titulo="Conta um pouco do seu negócio"
               subtitulo="Com isso a gente sugere o que faz sentido pra você — em vez de te entregar tudo de uma vez.">
          <Grupo rotulo="Seu segmento">
            <Opcoes lista={SEGMENTOS} valor={p.business_segment} compacto
              onEscolher={(v) => setP((x) => ({ ...x, business_segment: v }))} />
          </Grupo>
          <Grupo rotulo="Quantas pessoas vão atender">
            <Opcoes lista={TAMANHOS} valor={p.team_size} compacto
              onEscolher={(v) => setP((x) => ({ ...x, team_size: v }))} />
          </Grupo>
          <Grupo rotulo="O que você usa hoje">
            <Opcoes lista={FERRAMENTAS} valor={p.current_tool} compacto
              onEscolher={(v) => setP((x) => ({ ...x, current_tool: v }))} />
          </Grupo>
        </Bloco>
      )}

      {erro && (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      {/* Rodapé */}
      <div className="mt-8 flex items-center gap-3">
        {passo > 0 ? (
          <button type="button" onClick={() => { setPasso((x) => (x - 1) as Passo); setErro("") }} disabled={pending}
            className="h-11 px-4 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors">
            <ArrowLeft className="size-4" /> Voltar
          </button>
        ) : <div />}

        <div className="flex-1" />

        {!reeditando && (
          // ⚠️ "Depois" sempre visível, nunca escondido num canto. O dono decidiu que o
          //    cadastro pode ser pulado — esconder a saída seria contrariar isso na prática
          //    enquanto se diz o contrário na tela.
          <button type="button" onClick={pular} disabled={pending}
            className="h-11 px-4 rounded-lg text-slate-500 text-sm font-medium hover:text-slate-700 disabled:opacity-50 transition-colors">
            Deixar pra depois
          </button>
        )}

        <button type="button" onClick={avancar} disabled={pending}
          className="h-11 px-6 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 transition-colors">
          {pending
            ? <><Loader2 className="size-4 animate-spin" /> Salvando…</>
            : ultimo ? <><Check className="size-4" /> Concluir</> : <>Continuar <ArrowRight className="size-4" /></>}
        </button>
      </div>
    </Casca>
  )
}

// ── Peças ───────────────────────────────────────────────────────────────────

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center px-5 py-10 md:py-16">
      <Image src="/logo_kora.png" alt="Kora" width={140} height={48} priority className="h-9 w-auto mb-8" />
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-card p-6 sm:p-9">
        {children}
      </div>
    </div>
  )
}

function Bloco({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">{titulo}</h1>
        <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{subtitulo}</p>
      </div>
      {children}
    </div>
  )
}

function Grupo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5">{rotulo}</p>
      {children}
    </div>
  )
}

function Campo({ rotulo, opcional, children }: { rotulo: string; opcional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {rotulo}
        {opcional && <span className="ml-1.5 font-normal text-slate-400">opcional</span>}
      </label>
      {children}
    </div>
  )
}

function Dica({ children, destaque }: { children: React.ReactNode; destaque?: boolean }) {
  return <p className={`mt-1.5 text-xs ${destaque ? "text-primary-700 font-medium" : "text-slate-500"}`}>{children}</p>
}

/** Grade de escolha única. `compacto` = chips (listas longas); senão, cards. */
function Opcoes({ lista, valor, onEscolher, compacto }: {
  lista: Opcao[]; valor: string; onEscolher: (v: string) => void; compacto?: boolean
}) {
  if (compacto) {
    return (
      <div className="flex flex-wrap gap-2">
        {lista.map((o) => {
          const ativo = valor === o.value
          return (
            <button key={o.value} type="button" onClick={() => onEscolher(ativo ? "" : o.value)}
              className={`h-9 px-3.5 rounded-lg border text-sm font-medium transition-colors ${
                ativo ? "border-primary bg-primary-50 text-primary-800" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              {o.label}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {lista.map((o) => {
        const ativo = valor === o.value
        return (
          <button key={o.value} type="button" onClick={() => onEscolher(ativo ? "" : o.value)}
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3.5 text-left transition-colors ${
              ativo ? "border-primary bg-primary-50" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}>
            <Compass className={`size-4 shrink-0 ${ativo ? "text-primary-700" : "text-slate-300"}`} />
            <span className={`text-sm font-medium ${ativo ? "text-primary-800" : "text-slate-700"}`}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
