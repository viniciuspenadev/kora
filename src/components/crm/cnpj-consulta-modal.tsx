"use client"

import { useState, useEffect } from "react"
import { X, Loader2, Building2, Users } from "lucide-react"
import type { CnpjConsulta } from "@/app/api/cnpj/[cnpj]/consulta/route"
import { maskCpfCnpj } from "@/lib/masks"
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone-utils"

// Modal VIEW-ONLY: consulta o CNPJ na Receita (BrasilAPI) e mostra o cartão da empresa
// em SEÇÕES (mesma estrutura da Proposta Comercial). Nada é gravado. `onUse` (opcional)
// leva os dados pro formulário do cadastro. Campos vazios aparecem como "Não informado".

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : null)
const brl = (n: number | null) => (n == null ? null : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))
const fmtPhone = (p: string | null) => {
  if (!p) return null
  const n = normalizePhone(p, "BR")
  return n ? formatPhoneDisplay(n) : p
}
const regimeOf = (d: CnpjConsulta) => (d.mei ? "MEI" : d.simples ? "Simples Nacional" : d.simples === false ? "Regime normal" : null)
const fmtCnae = (c: string) => { const d = c.replace(/\D/g, ""); return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}` : c }

export function CnpjConsultaModal({ cnpj, onClose, onUse }: { cnpj: string; onClose: () => void; onUse?: (d: CnpjConsulta) => void }) {
  const [data, setData] = useState<CnpjConsulta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/cnpj/${cnpj.replace(/\D/g, "")}/consulta`)
        if (!alive) return
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { error?: string }
          setError(e.error || "Não foi possível consultar.")
        } else {
          setData((await r.json()) as CnpjConsulta)
        }
      } catch {
        if (alive) setError("Serviço de consulta indisponível.")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [cnpj])

  const ativa = data?.situacao === "ATIVA"

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-12" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-2xl max-h-[86vh] flex flex-col bg-white rounded-2xl shadow-2xl shadow-slate-900/25 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Building2 className="size-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">Consulta CNPJ</p>
            <p className="text-[11px] text-slate-400">{maskCpfCnpj(cnpj)} · dados da Receita Federal</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="ml-auto size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="size-4" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="py-12 text-center text-sm text-slate-400"><Loader2 className="size-5 animate-spin inline mr-2" /> consultando a Receita…</div>}
          {!loading && error && <div className="py-12 text-center text-sm text-rose-500">{error}</div>}
          {!loading && data && (
            <div className="space-y-6">
              {/* Identidade */}
              <div className="flex items-start gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 leading-tight">{data.nome_fantasia}</h3>
                  {data.razao_social && data.razao_social !== data.nome_fantasia && <p className="text-xs text-slate-500 mt-0.5">{data.razao_social}</p>}
                  {!ativa && data.motivo && <p className="text-[11px] text-rose-500 mt-1">Motivo: {data.motivo}</p>}
                </div>
                <span className={`shrink-0 ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${ativa ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>{data.situacao || "—"}</span>
              </div>

              {/* Dados cadastrais */}
              <Section title="Dados cadastrais">
                <Grid>
                  <Cell label="Natureza jurídica" value={data.natureza} />
                  <Cell label="Porte"             value={data.porte} />
                  <Cell label="Regime tributário" value={regimeOf(data)} />
                  <Cell label="Estabelecimento"   value={data.matriz_filial} />
                  <Cell label="Abertura"          value={fmtDate(data.abertura)} />
                  <Cell label="Situação desde"    value={fmtDate(data.situacao_desde)} />
                  <Cell label="Capital social"    value={brl(data.capital_social)} />
                  <Cell label="CNPJ"              value={maskCpfCnpj(data.cnpj)} />
                </Grid>
              </Section>

              {/* Contato */}
              <Section title="Contato">
                <Grid>
                  <Cell label="Telefone"          value={fmtPhone(data.telefone)} />
                  <Cell label="Telefone 2"        value={fmtPhone(data.telefone2)} />
                  <Cell label="E-mail"            value={data.email} />
                </Grid>
              </Section>

              {/* Endereço */}
              <Section title="Endereço">
                <p className="text-xs text-slate-700">{data.endereco || <span className="text-slate-400">Não informado</span>}</p>
              </Section>

              {/* Atividade */}
              <Section title="Atividade econômica">
                {data.cnae_principal ? (
                  <p className="text-sm text-slate-800 font-medium">
                    <span className="text-[11px] font-semibold text-primary-600 tabular-nums mr-1.5">{fmtCnae(data.cnae_principal.codigo)}</span>
                    {data.cnae_principal.descricao}
                  </p>
                ) : <p className="text-sm text-slate-400">Não informada</p>}
                {data.cnaes_secundarios.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {data.cnaes_secundarios.map((c) => (
                      <span key={c.codigo} className="text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                        <span className="font-semibold text-slate-400 tabular-nums mr-1">{fmtCnae(c.codigo)}</span>{c.descricao}
                      </span>
                    ))}
                  </div>
                )}
              </Section>

              {/* Quadro societário — CPF já mascarado pela Receita, view-only */}
              <Section title="Quadro societário" icon={Users}>
                {data.socios.length === 0
                  ? <p className="text-xs text-slate-400">Não informado</p>
                  : (
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                      {data.socios.map((s, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-slate-700 truncate">{s.nome}</p>
                            {(s.qualificacao || s.representante) && <p className="text-[11px] text-slate-400 truncate">{s.qualificacao}{s.representante ? ` · rep.: ${s.representante}` : ""}</p>}
                          </div>
                          <div className="ml-auto shrink-0 text-right">
                            {s.faixa_etaria && <p className="text-[11px] text-slate-400">{s.faixa_etaria}</p>}
                            {s.entrada && <p className="text-[10px] text-slate-300">desde {fmtDate(s.entrada)}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </Section>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && data && (
          <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-100 shrink-0">
            <p className="text-[11px] text-slate-400">Consulta transitória — nada é gravado.</p>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onClose} className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100">Fechar</button>
              {onUse && (
                <button type="button" onClick={() => { onUse(data); onClose() }}
                  className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors">Usar no cadastro</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Seção com rótulo — mesmo padrão da Proposta Comercial. */
function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Users; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5" />} {title}
      </p>
      {children}
    </section>
  )
}

/** Grade de células com linhas finas (gap-px sobre fundo). */
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-200">{children}</div>
    </div>
  )
}

/** Célula label/valor — mostra "Não informado" quando vazio (nada some da vista). */
function Cell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-white px-3.5 py-2.5">
      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
      {value ? <p className="text-xs font-medium text-slate-700 mt-0.5 break-words">{value}</p> : <p className="text-xs text-slate-300 mt-0.5">Não informado</p>}
    </div>
  )
}
