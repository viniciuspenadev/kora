"use client"

import { Users } from "lucide-react"
import type { CnpjData } from "@/lib/cnpj"
import { maskCpfCnpj } from "@/lib/masks"
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone-utils"

// Exibição ÚNICA do perfil de CNPJ (BrasilAPI) — reusada em TODO "Consultar": a modal
// CnpjConsultaModal (view completa) e o form de empresa (embedded, sem repetir contato/
// endereço que o form já edita). View-only; nada é gravado. Campos vazios = "Não informado".

const fmtDate  = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : null)
const brl      = (n: number | null) => (n == null ? null : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))
const fmtPhone = (p: string | null) => { if (!p) return null; const n = normalizePhone(p, "BR"); return n ? formatPhoneDisplay(n) : p }
const fmtCnae  = (c: string) => { const d = c.replace(/\D/g, ""); return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5, 7)}` : c }

/** Situação cadastral → cor de risco (herói do dossiê embutido). */
function sitMeta(raw: string): { label: string; dot: string; strip: string } {
  const s = raw.trim().toUpperCase()
  const cap = s ? s.charAt(0) + s.slice(1).toLowerCase() : "—"
  if (s === "ATIVA")    return { label: "Ativa",    dot: "bg-emerald-500", strip: "bg-emerald-50/60 border-emerald-100" }
  if (s === "SUSPENSA") return { label: "Suspensa", dot: "bg-amber-500",   strip: "bg-amber-50/60 border-amber-100" }
  if (["BAIXADA", "INAPTA", "NULA"].includes(s)) return { label: cap, dot: "bg-red-500", strip: "bg-red-50/60 border-red-100" }
  return { label: cap, dot: "bg-slate-400", strip: "bg-slate-50 border-slate-200" }
}

export function CnpjDossier({ data, embedded = false }: { data: CnpjData; embedded?: boolean }) {
  const ativa = data.situacao === "ATIVA"
  const sm = sitMeta(data.situacao)
  // Defensivo: resposta malformada/em-cache-velho não pode derrubar a tela.
  const secs   = data.cnaes_secundarios ?? []
  const socios = data.socios ?? []
  const endereco = [
    [data.address.street, data.address.number].filter(Boolean).join(", "),
    data.address.complement,
    data.address.district,
    [data.address.city, data.address.state].filter(Boolean).join("/"),
    data.address.cep ? `CEP ${data.address.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : "",
  ].filter(Boolean).join(" · ")

  return (
    <div className="space-y-6">
      {embedded ? (
        // Herói — situação cadastral com faixa tinta pela cor de risco (form embutido).
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${sm.strip}`}>
          <span className={`size-2.5 rounded-full shrink-0 ${sm.dot}`} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Situação cadastral</p>
            <p className="text-sm font-bold text-slate-900 leading-tight">{sm.label}{!ativa && data.motivo ? <span className="ml-1.5 text-[11px] font-normal text-rose-500">· {data.motivo}</span> : null}</p>
          </div>
          {data.abertura && (
            <div className="ml-auto text-right shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Abertura</p>
              <p className="text-xs font-semibold text-slate-700 tabular-nums">{fmtDate(data.abertura)}</p>
            </div>
          )}
        </div>
      ) : (
        // Identidade (modal view completa)
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 leading-tight">{data.nome_fantasia}</h3>
            {data.razao_social && data.razao_social !== data.nome_fantasia && <p className="text-xs text-slate-500 mt-0.5">{data.razao_social}</p>}
            {!ativa && data.motivo && <p className="text-[11px] text-rose-500 mt-1">Motivo: {data.motivo}</p>}
          </div>
          <span className={`shrink-0 ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${ativa ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>{data.situacao || "—"}</span>
        </div>
      )}

      {/* Dados cadastrais */}
      <Section title="Dados cadastrais">
        <Grid>
          <Cell label="Natureza jurídica" value={data.natureza} />
          <Cell label="Porte"             value={data.porte} />
          <Cell label="Regime tributário" value={data.regime} />
          <Cell label="Estabelecimento"   value={data.matriz_filial} />
          <Cell label="Abertura"          value={fmtDate(data.abertura)} />
          <Cell label="Situação desde"    value={fmtDate(data.situacao_desde)} />
          <Cell label="Capital social"    value={brl(data.capital_social)} />
          <Cell label="CNPJ"              value={maskCpfCnpj(data.cnpj)} />
        </Grid>
      </Section>

      {/* Contato + Endereço — só na view completa (o form já edita esses campos) */}
      {!embedded && (
        <>
          <Section title="Contato">
            <Grid>
              <Cell label="Telefone"   value={fmtPhone(data.telefone)} />
              <Cell label="Telefone 2" value={fmtPhone(data.telefone2)} />
              <Cell label="E-mail"     value={data.email} />
            </Grid>
          </Section>
          <Section title="Endereço">
            <p className="text-xs text-slate-700">{endereco || <span className="text-slate-400">Não informado</span>}</p>
          </Section>
        </>
      )}

      {/* Atividade econômica */}
      <Section title="Atividade econômica">
        {data.cnae_principal ? (
          <p className="text-sm text-slate-800 font-medium">
            <span className="text-[11px] font-semibold text-primary-600 tabular-nums mr-1.5">{fmtCnae(data.cnae_principal.codigo)}</span>
            {data.cnae_principal.descricao}
          </p>
        ) : <p className="text-sm text-slate-400">Não informada</p>}
        {secs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {secs.map((c) => (
              <span key={c.codigo} className="text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                <span className="font-semibold text-slate-400 tabular-nums mr-1">{fmtCnae(c.codigo)}</span>{c.descricao}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Quadro societário — CPF já mascarado pela Receita, view-only, NUNCA persistido */}
      <Section title="Quadro societário" icon={Users}>
        {socios.length === 0
          ? <p className="text-xs text-slate-400">Não informado</p>
          : (
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {socios.map((s, i) => (
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
  )
}

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

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-200">{children}</div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-white px-3.5 py-2.5">
      <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
      {value ? <p className="text-xs font-medium text-slate-700 mt-0.5 break-words">{value}</p> : <p className="text-xs text-slate-300 mt-0.5">Não informado</p>}
    </div>
  )
}
