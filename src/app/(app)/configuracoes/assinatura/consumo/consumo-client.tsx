"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BellRing, Check, ChevronDown, ChevronRight, Info, Pause, TrendingUp,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { brl, dataLonga, diasAte, num, plural } from "../format"
import type { AssinaturaMock } from "../mock"
import type { LinhaDiscreta, LinhaMedida } from "../types"
import { CaberNoPlanoModal } from "../components/caber-no-plano-modal"

// ═══════════════════════════════════════════════════════════════
// B2 · Consumo — a evolução da tela de Uso
// ═══════════════════════════════════════════════════════════════
// DECISÃO DE UX (o porquê): a tela antiga respondia "quanto sobrou da cota?".
// Essa é a pergunta da PLATAFORMA. A pergunta do CLIENTE é "isso vai virar
// dinheiro?" — e uma barra em 62% não responde. Quatro regras, na ordem em que
// mudam o comportamento:
//
// 1. SÓ GANHA DESTAQUE O QUE PODE VIRAR CONTA (usuários, disparos, IA). Antes
//    eram dez linhas com o mesmo peso; dez avisos iguais treinam o cliente a
//    ignorar todos, e aí o que importa passa batido. Contatos e armazenamento
//    viraram tira discreta lá embaixo — eles nunca geraram uma linha de fatura.
//
// 2. NUNCA PORCENTAGEM SOZINHA — SEMPRE O VALOR EM REAIS, e à direita, na
//    mesma coluna, pra o olho varrer de cima a baixo. "160% da cota" assusta e
//    não informa; "R$ 119,70 na fatura de 6/9" ACALMA, porque dá o tamanho
//    exato do problema. Coluna de dinheiro > frase com dinheiro no meio: o
//    cliente soma com o olho.
//
// 3. EXCEDENTE É SERVIÇO PRESTADO, NÃO MULTA. Excedente que rodou é neutro
//    (azul/ardósia). Vermelho fica reservado ao que PAROU. Pintar de vermelho
//    aquilo que a gente quer que ele consuma é ensinar o cliente a consumir
//    menos — a gente estaria pagando design pra reduzir a própria receita.
//
// 4. TODA LINHA DE EXCEDENTE TEM DUAS SAÍDAS: "aceito e pago" e "quero caber no
//    plano". Tela de consumo sem saída é tela de culpa. E "aceito" não é só
//    UX-teatro: ele silencia o aviso daquele recurso no ciclo, o que dá valor
//    real ao clique.
//
// Bônus que caiu das regras: a linha que AINDA não estourou mas vai (projeção)
// é a mais valiosa da tela — é a única chance de avisar antes de cobrar.

export function ConsumoClient({ mock }: { mock: AssinaturaMock }) {
  const { conta, medidas, discretas } = mock
  const [aceitos, setAceitos] = useState<Record<string, boolean>>({})
  const [avisos, setAvisos]   = useState<Record<string, boolean>>({})
  const [planoModal, setPlanoModal] = useState(false)

  const projetadoCents = conta.totalCents
    + medidas.reduce((s, m) => s + Math.max(0, m.projecaoCents - m.excedenteCents), 0)
  const dias = conta.fechaEm ? diasAte(conta.fechaEm) : null

  return (
    <>
      <div className="space-y-4">
        {/* ── Topo: a resposta, em dinheiro ── */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-card px-5 sm:px-6 py-5">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">
                Sua fatura de {conta.fechaEm ? dataLonga(conta.fechaEm).split(" de ")[1] : "este mês"}, até agora
              </p>
              <p className="text-4xl font-bold text-slate-900 tabular-nums leading-none mt-2">{brl(conta.totalCents)}</p>
              <p className="text-xs text-slate-500 mt-2">
                {brl(conta.planoCents)} do plano
                {conta.extras.map((e) => <span key={e.label}> + {brl(e.cents)} de {e.label.toLowerCase()}</span>)}
              </p>
            </div>

            <div className="text-left sm:text-right">
              {conta.fechaEm && (
                <p className="text-xs text-slate-500">
                  Fecha em <span className="font-semibold text-slate-700">{dataLonga(conta.fechaEm)}</span>
                  {dias != null && dias > 0 && <span className="text-slate-400"> · faltam {plural(dias, "dia")}</span>}
                </p>
              )}
              {projetadoCents > conta.totalCents && (
                <p className="text-xs text-slate-500 mt-1.5 inline-flex items-center gap-1.5">
                  <TrendingUp className="size-3.5 text-sky-500" />
                  No ritmo atual, deve fechar em <span className="font-semibold text-slate-700">{brl(projetadoCents)}</span>
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── O que pode virar conta ── */}
        <SectionCard
          title="O que pode virar conta"
          description="Os três recursos que passam da cota e viram linha na fatura"
          flush
        >
          <div className="divide-y divide-slate-100">
            {medidas.map((m) => (
              <LinhaMedidaRow
                key={m.key}
                linha={m}
                fechaEm={conta.fechaEm}
                aceito={!!aceitos[m.key]}
                avisando={!!avisos[m.key]}
                onAceitar={() => {
                  setAceitos((a) => ({ ...a, [m.key]: true }))
                  toast.success("Combinado — a gente para de avisar sobre isso neste ciclo.")
                }}
                onCaber={() => setPlanoModal(true)}
                onAvisar={() => {
                  setAvisos((a) => ({ ...a, [m.key]: !a[m.key] }))
                  toast.success(avisos[m.key] ? "Aviso desligado." : "Certo — a gente te avisa assim que passar da cota.")
                }}
              />
            ))}
          </div>
        </SectionCard>

        {/* ── O que NÃO vira conta ── */}
        <SectionCard
          title="Não gera cobrança"
          description="Entra no plano. Se algum encher, a gente avisa antes de parar qualquer coisa."
          flush
        >
          <div className="divide-y divide-slate-100">
            {discretas.map((d) => <LinhaDiscretaRow key={d.key} linha={d} />)}
          </div>
        </SectionCard>

        <p className="text-[11px] text-slate-400 leading-relaxed px-1">
          Excedente é cobrado por uso, no fim do ciclo, sem multa e sem contrato novo.
          Nada aqui deveria te surpreender na fatura — se surpreender, escreve pra gente que a gente ajusta.
        </p>
      </div>

      {planoModal && (
        <CaberNoPlanoModal
          medidas={medidas}
          gastoAtualCents={conta.totalCents}
          planoAtualCents={conta.planoCents}
          onClose={() => setPlanoModal(false)}
        />
      )}
    </>
  )
}

// ── Linha que pode virar dinheiro ──────────────────────────────

function LinhaMedidaRow({
  linha, fechaEm, aceito, avisando, onAceitar, onCaber, onAvisar,
}: {
  linha:     LinhaMedida
  fechaEm:   string | null
  aceito:    boolean
  avisando:  boolean
  onAceitar: () => void
  onCaber:   () => void
  onAvisar:  () => void
}) {
  const [verQuem, setVerQuem] = useState(false)
  const excedeu = linha.excedente > 0
  const vaiExceder = !excedeu && linha.projecaoCents > 0
  const parou = !!linha.parou

  return (
    <div className="px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800">{linha.label}</p>
            {parou && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-px">
                <Pause className="size-2.5" strokeWidth={3} /> pausado
              </span>
            )}
            {aceito && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-px">
                <Check className="size-2.5" strokeWidth={3} /> combinado
              </span>
            )}
          </div>

          <p className="text-xs text-slate-500 tabular-nums mt-1">
            {num(linha.usado)} {linha.unidade}s
            {linha.cota != null && <> · o plano inclui {num(linha.cota)}</>}
            {excedeu && <> · <span className="text-slate-700 font-medium">{plural(linha.excedente, linha.unidade)} além da cota</span></>}
          </p>

          <Barra usado={linha.usado} cota={linha.cota} parou={parou} />

          {/* A frase que dá o tamanho exato do problema. */}
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            {parou ? (
              <>Pausado enquanto a fatura estiver em aberto — o consumo do ciclo continua contando e nada foi perdido.</>
            ) : excedeu ? (
              <>Já rodou e será cobrado na fatura{fechaEm ? ` de ${dataLonga(fechaEm)}` : ""}, a {brl(linha.precoUnitCents)} por {linha.unidade}.</>
            ) : vaiExceder ? (
              <><TrendingUp className="size-3.5 text-sky-500 inline align-[-2px] mr-1" />
              No ritmo atual, deve passar da cota e fechar em ~{brl(linha.projecaoCents)} de excedente.</>
            ) : (
              <>Dentro da cota do plano — não gera cobrança extra neste ciclo.</>
            )}
          </p>

          {/* Evidência: quem quiser conferir, confere aqui — sem sair da tela. */}
          {excedeu && linha.evidencia && linha.evidencia.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setVerQuem((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
              >
                {verQuem ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {verQuem ? "Esconder" : "Ver quais"}
              </button>
              {verQuem && (
                <ul className="mt-1.5 pl-4 border-l-2 border-slate-100 space-y-1">
                  {linha.evidencia.map((e) => (
                    <li key={e.quem} className="text-[11px] text-slate-500">
                      <span className="font-medium text-slate-700">{e.quem}</span>
                      {e.quando && <> — entrou em {e.quando}</>}
                      {e.detalhe && <span className="text-slate-400"> · {e.detalhe}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* AS DUAS SAÍDAS. Nunca só uma. */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {parou ? (
              <>
                <Link href="/configuracoes/assinatura" className={BTN_ROW_PRIMARY}>Pagar fatura</Link>
                <button type="button" onClick={onCaber} className={BTN_ROW}>Quero caber no plano</button>
              </>
            ) : excedeu ? (
              <>
                <button type="button" onClick={onAceitar} disabled={aceito} className={BTN_ROW}>
                  {aceito ? "Aceito — pode cobrar" : "Aceito e pago"}
                </button>
                <button type="button" onClick={onCaber} className={BTN_ROW}>Quero caber no plano</button>
              </>
            ) : vaiExceder ? (
              <>
                <button type="button" onClick={onAvisar} className={BTN_ROW}>
                  <BellRing className="size-3.5" /> {avisando ? "Aviso ligado" : "Me avise ao passar da cota"}
                </button>
                <button type="button" onClick={onCaber} className={BTN_ROW}>Quero caber no plano</button>
              </>
            ) : null}
          </div>
        </div>

        {/* Âncora de dinheiro — a coluna que o olho varre. */}
        <div className="text-right shrink-0 w-28 sm:w-32">
          <p className={`text-lg font-bold tabular-nums ${excedeu ? "text-slate-900" : "text-slate-300"}`}>
            {brl(linha.excedenteCents)}
          </p>
          <p className="text-[11px] text-slate-400 leading-snug mt-0.5">
            {excedeu
              ? fechaEm ? `na fatura de ${dataLonga(fechaEm).split(" de ")[0]}/${dataLonga(fechaEm).split(" de ")[1].slice(0, 3)}` : "nesta fatura"
              : "sem excedente"}
          </p>
          {vaiExceder && (
            <p className="text-[11px] text-sky-600 font-semibold tabular-nums mt-1">~{brl(linha.projecaoCents)}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Barra de dois segmentos: cota (primary) + excedente (sky).
 * O excedente é desenhado ATÉ 30% da largura, não proporcional de verdade —
 * 400% de uso viraria uma barra que sai da tela e não comunica nada. A verdade
 * do número mora no texto e na âncora de dinheiro; a barra é só ritmo.
 */
function Barra({ usado, cota, parou }: { usado: number; cota: number | null; parou: boolean }) {
  if (cota == null || cota <= 0) return null
  const over    = usado > cota
  const excPct  = over ? Math.min(30, ((usado - cota) / cota) * 100) : 0
  const dentro  = over ? 100 - excPct : (usado / cota) * 100

  return (
    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden flex mt-2">
      <div className={`h-full ${parou ? "bg-red-400" : "bg-primary"}`} style={{ width: `${dentro}%` }} />
      {excPct > 0 && <div className="h-full bg-sky-500" style={{ width: `${excPct}%` }} />}
    </div>
  )
}

// ── Linha discreta (não vira dinheiro) ─────────────────────────

function LinhaDiscretaRow({ linha }: { linha: LinhaDiscreta }) {
  const [aberto, setAberto] = useState(false)
  const pct = linha.cota ? Math.min(100, (linha.usado / linha.cota) * 100) : 0
  const cheio = pct >= 80

  return (
    <div className="px-5 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600">{linha.label}</span>
          {linha.detalhe && (
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              className="text-[11px] text-slate-400 hover:text-slate-600 inline-flex items-center gap-0.5"
            >
              {aberto ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} por origem
            </button>
          )}
          {cheio && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-px">
              <Info className="size-2.5" /> perto do limite
            </span>
          )}
        </div>

        <div className="w-24 h-1 rounded-full bg-slate-100 overflow-hidden shrink-0 hidden sm:block">
          <div className={`h-full ${cheio ? "bg-amber-400" : "bg-slate-300"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-slate-500 tabular-nums shrink-0 w-32 text-right">{linha.textoUso}</span>
      </div>

      {aberto && linha.detalhe && (
        <ul className="mt-1.5 ml-1 pl-3 border-l-2 border-slate-100 space-y-0.5">
          {linha.detalhe.map((d) => (
            <li key={d.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="text-slate-500">{d.label}</span>
              <span className="text-slate-400 tabular-nums">{d.texto}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const BTN_ROW = "inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors disabled:opacity-60 disabled:hover:bg-white"
const BTN_ROW_PRIMARY = "inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
