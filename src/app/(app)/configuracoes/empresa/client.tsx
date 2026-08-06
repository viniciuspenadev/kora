"use client"

import { useState, useRef, useTransition, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Building2, User, Loader2, Check, AlertCircle, Sparkles, MapPin, Lock,
} from "lucide-react"
import { maskCpfCnpj, maskCep, maskPhone, isValidCpf, isValidCnpj, isValidPhoneBR } from "@/lib/masks"
import { lookupCnpj } from "@/lib/cnpj"
import { lookupCep } from "@/lib/cep"
import { saveMyCompanyProfile, type PerfilEmpresa } from "@/lib/actions/company-profile"

// ═══════════════════════════════════════════════════════════════
// Formulário do cadastro fiscal (cliente)
// ═══════════════════════════════════════════════════════════════
// ⚠️ Este formulário NÃO reimplementa consulta nenhuma. CNPJ vem de `lookupCnpj`
//    (/api/cnpj) e CEP de `lookupCep` (/api/cep) — os mesmos motores usados no CRM e na
//    proposta. Proxy paralelo aqui viraria uma segunda fonte de verdade com outro
//    comportamento de erro, outro timeout e outro formato de endereço.
//
// ⚠️ A validação daqui é CONFORTO, não defesa. Quem decide é `normalizarPerfilFiscal` no
//    servidor — este arquivo só evita que a pessoa descubra o erro depois de salvar.

const INP =
  "w-full h-10 px-3 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-shadow disabled:bg-slate-50 disabled:text-slate-500"

type Campos = Omit<PerfilEmpresa, "documento_travado" | "completo">

export function EmpresaClient({ inicial }: { inicial: PerfilEmpresa }) {
  const router = useRouter()
  const [pending, startT] = useTransition()

  const { documento_travado: docTravado, ...camposIniciais } = inicial
  const [f, setF]       = useState<Campos>(() => ({ ...camposIniciais }))
  const [sujo, setSujo] = useState(false)
  const [msg, setMsg]   = useState<{ tipo: "ok" | "erro" | "aviso"; texto: string } | null>(null)

  // Estado das consultas externas — cada uma com seu próprio "carregando" e sua nota.
  const [buscandoDoc, setBuscandoDoc] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [notaDoc, setNotaDoc]         = useState("")
  const [notaCep, setNotaCep]         = useState("")

  const numeroRef = useRef<HTMLInputElement | null>(null)
  // Guarda o último documento consultado: sem isso, cada re-render com o mesmo CNPJ
  // dispararia a consulta de novo e sobrescreveria o que a pessoa acabou de corrigir.
  const ultimoDocConsultado = useRef<string>("")
  const ultimoCepConsultado = useRef<string>("")

  const ehPF = f.person_type === "pf"
  const set  = useCallback((k: keyof Campos, v: string) => {
    setF((p) => ({ ...p, [k]: v })); setSujo(true); setMsg(null)
  }, [])

  // ── O que ainda falta pra conseguir cobrar ────────────────────────────────
  // Mesma régua do servidor (`normalizarPerfilFiscal` §7) e do gate de pagamento
  // (`getTitularParaCobranca`). As três precisam concordar — se esta lista disser "tudo
  // certo" e o gate barrar, a pessoa fica sem entender o que fazer.
  const pendencias = useMemo(() => {
    const doc = f.tax_id.replace(/\D/g, "")
    const docOk = doc.length > 0 && (ehPF ? isValidCpf(doc) : isValidCnpj(doc))
    return [
      { ok: f.legal_name.trim().length >= 2, label: ehPF ? "Nome completo" : "Razão social" },
      { ok: docOk,                            label: ehPF ? "CPF" : "CNPJ" },
      { ok: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.billing_email.trim()), label: "E-mail de faturamento" },
      { ok: f.zip.replace(/\D/g, "").length === 8, label: "CEP" },
      { ok: f.number.trim().length > 0,            label: "Número do endereço" },
      // 🔴 O TELEFONE FALTAVA AQUI (05/08) — e esta lista é a que pinta o selo verde
      //    "Cadastro completo — pronto para faturamento". O gate de pagamento exige
      //    telefone VÁLIDO desde hoje; esta tela não exigia nenhum. Resultado medido:
      //    selo verde aqui, recusa no checkout, e a pessoa mandada de volta pra cá pelo
      //    hero — laço de contradição entre duas telas do mesmo produto.
      //    O comentário logo acima já dizia que as três réguas precisam concordar; ele
      //    não impediu a divergência porque comentário nunca impede — função impede.
      { ok: isValidPhoneBR(f.phone),               label: "Telefone com DDD" },
    ]
  }, [f, ehPF])

  const faltam    = pendencias.filter((p) => !p.ok)
  const tudoPronto = faltam.length === 0

  // ── Consulta de CNPJ ──────────────────────────────────────────────────────
  // Só PJ: não existe base pública de CPF pra consultar, e fingir que existe seria pior
  // que não ter o recurso. Pra PF a pessoa digita o nome — dois campos, e acabou.
  async function consultarCnpj(valor: string) {
    const d = valor.replace(/\D/g, "")
    if (d.length !== 14 || !isValidCnpj(d) || d === ultimoDocConsultado.current) return
    ultimoDocConsultado.current = d
    setBuscandoDoc(true); setNotaDoc("")
    const r = await lookupCnpj(d)
    setBuscandoDoc(false)
    if (!r) { setNotaDoc("Não encontramos este CNPJ agora — pode preencher à mão."); return }

    setF((p) => ({
      ...p,
      legal_name:    r.razao_social  || p.legal_name,
      trade_name:    r.nome_fantasia || p.trade_name,
      billing_email: p.billing_email || r.email || "",
      phone:         p.phone         || (r.telefone ? maskPhone(r.telefone) : ""),
      zip:           r.address?.cep     ? maskCep(r.address.cep) : p.zip,
      street:        r.address?.street  || p.street,
      number:        r.address?.number  || p.number,
      complement:    r.address?.complement || p.complement,
      district:      r.address?.district   || p.district,
      city:          r.address?.city       || p.city,
      state:         r.address?.state      || p.state,
    }))
    setSujo(true)
    // ⚠️ O CEP acabou de ser preenchido pela Receita: marca como já consultado pra a
    //    busca de CEP não disparar em seguida e sobrescrever o endereço da Receita
    //    (que costuma ser mais específico, com número e complemento).
    if (r.address?.cep) ultimoCepConsultado.current = r.address.cep.replace(/\D/g, "")
    setNotaDoc("Preenchemos com os dados da Receita Federal. Confira antes de salvar.")
  }

  // ── Consulta de CEP ───────────────────────────────────────────────────────
  async function consultarCep(valor: string) {
    const d = valor.replace(/\D/g, "")
    if (d.length !== 8 || d === ultimoCepConsultado.current) return
    ultimoCepConsultado.current = d
    setBuscandoCep(true); setNotaCep("")
    const r = await lookupCep(d)
    setBuscandoCep(false)
    if (!r) { setNotaCep("CEP não encontrado — preencha o endereço à mão."); return }

    setF((p) => ({
      ...p,
      street:   r.street   || p.street,
      district: r.district || p.district,
      city:     r.city     || p.city,
      state:    r.state    || p.state,
    }))
    setSujo(true)
    setNotaCep("")
    // O número é o único campo que o CEP nunca traz — levar o cursor até ele evita o
    // clássico "preencheu tudo e esqueceu o número", que é justamente o que barra a cobrança.
    setTimeout(() => numeroRef.current?.focus(), 60)
  }

  function salvar() {
    setMsg(null)
    startT(async () => {
      const r = await saveMyCompanyProfile({
        person_type:            f.person_type,
        legal_name:             f.legal_name,
        trade_name:             f.trade_name,
        tax_id:                 f.tax_id,
        state_registration:     f.state_registration,
        municipal_registration: f.municipal_registration,
        billing_email:          f.billing_email,
        phone:                  f.phone,
        responsible_name:       f.responsible_name,
        zip:                    f.zip,
        street:                 f.street,
        number:                 f.number,
        complement:             f.complement,
        district:               f.district,
        city:                   f.city,
        state:                  f.state,
      })
      if (r.error)      { setMsg({ tipo: "erro",  texto: r.error }); return }
      if (r.aviso)      { setMsg({ tipo: "aviso", texto: r.aviso }) }
      else              { setMsg({ tipo: "ok",    texto: "Cadastro salvo." }) }
      setSujo(false)
      router.refresh()
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5 pb-24">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Dados da empresa</h1>
        <p className="mt-1 text-sm text-slate-500">
          É o cadastro que usamos para emitir suas cobranças e notas.
        </p>
      </div>

      {/* Faixa de pendência — some sozinha quando tudo está preenchido. */}
      {!tudoPronto && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Falta{faltam.length > 1 ? "m" : ""} {faltam.length} {faltam.length > 1 ? "itens" : "item"} para ativar a cobrança
              </p>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                {faltam.map((p) => p.label).join(" · ")}
              </p>
            </div>
          </div>
        </div>
      )}
      {tudoPronto && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 flex items-center gap-2.5">
          <Check className="size-4 text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-900">Cadastro completo — pronto para faturamento.</p>
        </div>
      )}

      {/* ── Tipo de pessoa ───────────────────────────────────────────────── */}
      <Card titulo="Quem contrata">
        <div className="grid grid-cols-2 gap-2.5">
          {([
            { v: "pj", icone: Building2, titulo: "Empresa",  sub: "Tenho CNPJ" },
            { v: "pf", icone: User,      titulo: "Pessoa",   sub: "Uso meu CPF" },
          ] as const).map(({ v, icone: Icone, titulo, sub }) => {
            const ativo = f.person_type === v
            return (
              <button key={v} type="button" disabled={docTravado}
                // ⚠️ Só limpa o documento se o tipo REALMENTE mudou. Sem esta guarda,
                //    clicar no card que já está ativo apagaria o CNPJ recém-digitado.
                onClick={() => {
                  if (f.person_type === v) return
                  setF((p) => ({ ...p, person_type: v, tax_id: "" }))
                  setSujo(true); setMsg(null); setNotaDoc("")
                  ultimoDocConsultado.current = ""
                }}
                className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  ativo ? "border-primary bg-primary-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}>
                <Icone className={`size-4 ${ativo ? "text-primary-700" : "text-slate-400"}`} />
                <p className={`mt-2 text-sm font-semibold ${ativo ? "text-primary-800" : "text-slate-700"}`}>{titulo}</p>
                <p className="text-xs text-slate-500">{sub}</p>
              </button>
            )
          })}
        </div>

        <div className="mt-4">
          <Rotulo>{ehPF ? "CPF" : "CNPJ"}</Rotulo>
          <div className="relative">
            <input
              className={`${INP} pr-10`}
              value={f.tax_id}
              disabled={docTravado}
              inputMode="numeric"
              placeholder={ehPF ? "000.000.000-00" : "00.000.000/0000-00"}
              onChange={(e) => {
                const v = maskCpfCnpj(e.target.value)
                set("tax_id", v)
                if (!ehPF) void consultarCnpj(v)
              }}
              onBlur={(e) => { if (!ehPF) void consultarCnpj(e.target.value) }}
            />
            {buscandoDoc && (
              <Loader2 className="size-4 animate-spin text-primary absolute right-3 top-1/2 -translate-y-1/2" />
            )}
            {docTravado && (
              <Lock className="size-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>

          {docTravado && (
            // 🔴 Não é limitação técnica: as cobranças já emitidas carregam o documento
            //    atual, então trocar aqui criaria divergência fiscal com o que já foi
            //    cobrado. Dizer o motivo evita a leitura de "o sistema não deixa".
            <Nota>Sua assinatura está ativa — o documento só muda com a nossa equipe, porque as cobranças já emitidas usam o atual.</Nota>
          )}
          {!docTravado && !ehPF && !notaDoc && (
            <Nota><Sparkles className="size-3 inline mr-1 -mt-0.5" />Digite o CNPJ e a gente busca o resto na Receita Federal.</Nota>
          )}
          {notaDoc && <Nota destaque>{notaDoc}</Nota>}
        </div>
      </Card>

      {/* ── Identidade ───────────────────────────────────────────────────── */}
      <Card titulo={ehPF ? "Seus dados" : "Identificação"}>
        <Campo rotulo={ehPF ? "Nome completo" : "Razão social"}>
          <input className={INP} value={f.legal_name} onChange={(e) => set("legal_name", e.target.value)}
            placeholder={ehPF ? "Como está no documento" : "Como está no cartão CNPJ"} />
        </Campo>
        {!ehPF && (
          <Campo rotulo="Nome fantasia" opcional>
            <input className={INP} value={f.trade_name} onChange={(e) => set("trade_name", e.target.value)} />
          </Campo>
        )}
        <div className="grid grid-cols-2 gap-3">
          {!ehPF && (
            <>
              <Campo rotulo="Inscrição estadual" opcional>
                <input className={INP} value={f.state_registration} onChange={(e) => set("state_registration", e.target.value)} placeholder="ou ISENTO" />
              </Campo>
              <Campo rotulo="Inscrição municipal" opcional>
                <input className={INP} value={f.municipal_registration} onChange={(e) => set("municipal_registration", e.target.value)} />
              </Campo>
            </>
          )}
        </div>
      </Card>

      {/* ── Contato de cobrança ──────────────────────────────────────────── */}
      <Card titulo="Contato de cobrança"
            descricao="Para onde mandamos recibo, aviso de vencimento e a nota.">
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="E-mail de faturamento">
            <input className={INP} type="email" value={f.billing_email}
              onChange={(e) => set("billing_email", e.target.value)} placeholder="financeiro@empresa.com" />
          </Campo>
          {/* ⚠️ Deixou de ser "opcional": o gateway EXIGE telefone do titular pra tokenizar
              o cartão. Marcar como opcional aqui e barrar no checkout era a divergência que
              derrubou uma cobrança em 05/08.
              ⚠️ Placeholder com dígito NÃO repetido de propósito: o exemplo era
              `(11) 99999-9999` — exatamente o formato que o gateway recusa. A tela estava
              ensinando o número que a cobrança ia rejeitar. */}
          <Campo rotulo="Telefone">
            <input className={INP} value={f.phone} inputMode="tel"
              onChange={(e) => set("phone", maskPhone(e.target.value))} placeholder="(11) 98888-7777" />
          </Campo>
        </div>
        <Campo rotulo="Responsável" opcional>
          <input className={INP} value={f.responsible_name} onChange={(e) => set("responsible_name", e.target.value)}
            placeholder="Quem cuida do financeiro" />
        </Campo>
      </Card>

      {/* ── Endereço ─────────────────────────────────────────────────────── */}
      <Card titulo="Endereço de cobrança"
            descricao="O banco confere este endereço na hora de aprovar o cartão.">
        <div className="grid grid-cols-3 gap-3">
          <Campo rotulo="CEP">
            <div className="relative">
              <input className={`${INP} pr-9`} value={f.zip} inputMode="numeric" placeholder="00000-000"
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
        {notaCep && <Nota>{notaCep}</Nota>}

        <div className="grid grid-cols-3 gap-3">
          <Campo rotulo="Número">
            <input ref={numeroRef} className={INP} value={f.number}
              onChange={(e) => set("number", e.target.value)} placeholder="123 ou S/N" />
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
      </Card>

      {/* ── Barra de salvar — fixa, aparece só quando há o que salvar ────── */}
      {(sujo || msg) && (
        <div className="fixed bottom-0 inset-x-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="max-w-3xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {msg && (
                <p className={`text-xs font-medium truncate ${
                  msg.tipo === "erro" ? "text-red-700" : msg.tipo === "aviso" ? "text-amber-700" : "text-emerald-700"
                }`}>
                  {msg.texto}
                </p>
              )}
              {!msg && sujo && <p className="text-xs text-slate-500">Você tem alterações não salvas.</p>}
            </div>
            <button type="button" onClick={salvar} disabled={pending || !sujo}
              className="h-10 px-5 rounded-lg bg-primary hover:bg-primary-700 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {pending ? <><Loader2 className="size-4 animate-spin" /> Salvando…</> : <><Check className="size-4" /> Salvar</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Peças ───────────────────────────────────────────────────────────────────

function Card({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-card overflow-hidden">
      <header className="px-5 pt-4 pb-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-900">{titulo}</h2>
        {descricao && <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>}
      </header>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  )
}

function Rotulo({ children, opcional }: { children: React.ReactNode; opcional?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
      {children}
      {opcional && <span className="ml-1.5 font-normal text-slate-400">opcional</span>}
    </label>
  )
}

function Campo({ rotulo, opcional, children }: { rotulo: string; opcional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Rotulo opcional={opcional}>{rotulo}</Rotulo>
      {children}
    </div>
  )
}

function Nota({ children, destaque }: { children: React.ReactNode; destaque?: boolean }) {
  return (
    <p className={`mt-1.5 text-xs leading-relaxed ${destaque ? "text-primary-700 font-medium" : "text-slate-500"}`}>
      {children}
    </p>
  )
}
