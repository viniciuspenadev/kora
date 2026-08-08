"use client"

import Link from "next/link"
import { useState, useMemo, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Package, Plus, Pencil, Copy, Trash2, Users, Loader2, CheckCircle2, AlertCircle, Check, ArrowLeft, GripVertical, ArrowRight, TriangleAlert, Archive } from "lucide-react"
import { createPlan, updatePlan, deletePlan, duplicatePlan, reorderPlans, type Plan, type PlanInput } from "@/lib/actions/admin-plans"
import { LIMIT_META, type LimitResource } from "@/lib/limits-shared"
import { CATEGORIA_LABEL } from "@/lib/modules-shared"

const LIMIT_KEYS = Object.keys(LIMIT_META) as LimitResource[]

export interface ModuleOption { slug: string; name: string; category: string }

interface Props {
  plans:       Plan[]
  modules:     ModuleOption[]
  tenantCount: Record<string, number>
}

/**
 * Rótulo humano da categoria do catálogo.
 *
 * ⚠️ AS CHAVES SÃO AS DO BANCO (`module_catalog.category`), não as que a gente gostaria.
 *    Estavam desatualizadas: `commercial`, `lead gen`, `ai`, `engagement`, `multi-channel`
 *    não existem em nenhuma linha, e as reais (`agenda`, `atendimento`, `campanhas`, `crm`,
 *    `studio`, `deprecated`, `multichannel`) caíam no fallback e imprimiam o SLUG CRU.
 *    Passava despercebido no modal antigo; na tela cheia o cabeçalho de categoria é o
 *    principal ponto de leitura do bloco. Conferido contra a prod em 2026-08-03.
 */
// ⚠️ O mapa mora em `lib/modules-shared.ts` desde 2026-08-05 — a tela do cliente
//    agrupa pelas MESMAS categorias, e duas cópias divergiriam.
const CATEGORY_LABEL = CATEGORIA_LABEL

const BRL = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const centsToInput = (cents: number) => (cents / 100).toFixed(2)
const inputToCents = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 100)

const INP = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400"

export function PlansClient({ plans, modules, tenantCount }: Props) {
  const [editing, setEditing] = useState<Plan | "new" | null>(null)

  // ── Duplicar plano ────────────────────────────────────────────────────────
  // ⚠️ `router.refresh()` em vez de mexer numa lista local: a cópia nasce no servidor
  //    (nome com sufixo, `active=false`, `position+1`) e só ele sabe o resultado final.
  //    Inventar a linha aqui faria a tela mostrar um plano ligeiramente diferente do que
  //    foi gravado — e a pessoa clicaria em "Editar" num objeto que não existe assim.
  const [duplicandoId, setDuplicandoId] = useState<string | null>(null)
  const [erroDuplicar, setErroDuplicar] = useState("")
  const router = useRouter()

  // ── Ordem da vitrine ──────────────────────────────────────────────────────
  // 🔑 ORDEM É VITRINE, E SÓ (decisão do dono, 07/08): ela define a sequência em que o
  //    CLIENTE vê os planos ao escolher — nada mais depende dela. Não é escada de
  //    evolução; quem pode subir pra quem é capacidade, e capacidade mora nas cotas.
  // ⚠️ Estado local pra o arrasto ser instantâneo, ressincronizado quando o servidor
  //    devolve a lista nova. Sem o espelho local, cada solta esperaria o round-trip e o
  //    card "voltaria" no meio do gesto.
  const [ordem, setOrdem]   = useState<Plan[]>(plans)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [sobre, setSobre]   = useState<string | null>(null)
  const [salvandoOrdem, setSalvandoOrdem] = useState(false)
  const [erroOrdem, setErroOrdem] = useState("")
  useEffect(() => { setOrdem(plans) }, [plans])

  const ativos    = useMemo(() => ordem.filter((p) => p.active),  [ordem])
  const arquivados = useMemo(() => ordem.filter((p) => !p.active), [ordem])

  /**
   * Move um plano ATIVO de posição e persiste.
   *
   * ⚠️ Manda a lista INTEIRA (ativos na ordem nova + arquivados no fim). Mandar só os
   *    ativos deixaria os arquivados com posições antigas, que voltariam a colidir com as
   *    novas — o empate que criou o problema em primeiro lugar.
   */
  function mover(de: number, para: number) {
    if (de === para || para < 0 || para >= ativos.length) return
    const novos = [...ativos]
    const [item] = novos.splice(de, 1)
    novos.splice(para, 0, item)
    setOrdem([...novos, ...arquivados])
    setErroOrdem("")
    setSalvandoOrdem(true)
    reorderPlans([...novos, ...arquivados].map((p) => p.id)).then((r) => {
      setSalvandoOrdem(false)
      if (r.error) { setErroOrdem(r.error); setOrdem(plans); return }   // desfaz na tela
      router.refresh()
    })
  }

  // ⚠️ Sem `useTransition` aqui de propósito: `duplicandoId` JÁ é o estado de "em
  //    andamento", e por id — ele desabilita só o botão clicado, não os outros. Um
  //    `pending` global marcaria a lista inteira como ocupada.
  async function duplicar(id: string) {
    setErroDuplicar(""); setDuplicandoId(id)
    const r = await duplicatePlan(id)
    setDuplicandoId(null)
    if (r.error) { setErroDuplicar(r.error); return }
    router.refresh()
  }

  // 🔴 PÁGINA CHEIA, NÃO MODAL (2026-08-03). O editor era um overlay de 512px com DOIS
  //    blocos de rolagem de 224px empilhados (módulos e limites). Com 19 módulos em 8
  //    grupos, cada um com TRÊS estados, mais 10 limites, isso é rolagem dentro de
  //    rolagem — e é a tela onde se erra ao montar um plano que vai ser VENDIDO: marca
  //    PRO na linha errada, salva, e descobre pelo cliente. Modal fica só pra
  //    confirmação (decisão de um clique), que é o `ConfirmDelete` lá embaixo.
  if (editing) {
    return (
      <PlanEditor
        plan={editing === "new" ? null : editing}
        modules={modules}
        tenantsUsing={editing === "new" ? 0 : (tenantCount[editing.id] ?? 0)}
        onClose={() => setEditing(null)}
      />
    )
  }

  const clientes = Object.values(tenantCount).reduce((a, b) => a + b, 0)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Package className="size-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Planos</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {ativos.length} {ativos.length === 1 ? "plano na vitrine" : "planos na vitrine"}
              {arquivados.length > 0 && ` · ${arquivados.length} arquivado${arquivados.length === 1 ? "" : "s"}`}
              {" · "}{clientes} {clientes === 1 ? "cliente" : "clientes"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Plus className="size-3.5" /> Novo plano
        </button>
      </div>

      <div className="px-6 py-6">
        {erroDuplicar && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{erroDuplicar}</p>
          </div>
        )}
        {erroOrdem && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <AlertCircle className="size-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{erroOrdem}</p>
          </div>
        )}

        {plans.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Package className="size-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">Nenhum plano ainda</p>
            <p className="text-xs text-slate-400 mt-1">Crie o primeiro plano pra começar a cobrar.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── ATIVOS — a vitrine, na ordem em que o cliente vê ──────────────── */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900">Vitrine</h2>
                {/* 🔑 Dito na tela, não só no código: daqui a três meses ninguém lembra
                    PRA QUE serve arrastar — e a ordem some do radar junto. */}
                <p className="text-[11px] text-slate-400">
                  Arraste para definir a ordem em que o cliente vê os planos ao escolher
                </p>
                {salvandoOrdem && (
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Loader2 className="size-3 animate-spin" /> salvando ordem…
                  </span>
                )}
              </div>

              <ListaHeader />
              <div className="divide-y divide-slate-100">
                {ativos.map((p, i) => (
                  <PlanRow
                    key={p.id}
                    plan={p} modules={modules} tenants={tenantCount[p.id] ?? 0}
                    posicao={i + 1}
                    arrastavel
                    arrastando={arrastando === p.id}
                    alvo={sobre === p.id && arrastando !== p.id}
                    onDragStart={() => setArrastando(p.id)}
                    onDragEnter={() => setSobre(p.id)}
                    onDragEnd={() => { setArrastando(null); setSobre(null) }}
                    onDrop={() => {
                      const de = ativos.findIndex((x) => x.id === arrastando)
                      if (de >= 0) mover(de, i)
                      setArrastando(null); setSobre(null)
                    }}
                    onMoverTeclado={(dir) => mover(i, i + dir)}
                    onEdit={() => setEditing(p)}
                    onDuplicate={() => duplicar(p.id)}
                    duplicando={duplicandoId === p.id}
                  />
                ))}
                {ativos.length === 0 && (
                  <p className="px-5 py-8 text-center text-xs text-slate-400">
                    Nenhum plano ativo — o cliente não tem o que escolher hoje.
                  </p>
                )}
              </div>
            </section>

            {/* ── ARQUIVADOS — o cofre do grandfathering ────────────────────────
                🔑 Bloco PRÓPRIO, e não um card esmaecido no meio dos outros. Plano
                   arquivado COM cliente dentro não é lixo: é um compromisso de preço
                   vivo — foi ele que garantiu que quem fechou por R$ X continua em R$ X
                   quando a tabela subiu. Tratá-lo como resto é o caminho pra alguém
                   excluir sem perceber o que estava segurando. */}
            {arquivados.length > 0 && (
              <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2.5">
                  <Archive className="size-3.5 text-slate-400 shrink-0" />
                  <h2 className="text-sm font-bold text-slate-900">Arquivados</h2>
                  <p className="text-[11px] text-slate-400">
                    Não aparecem para novos clientes — quem já está neles mantém o preço
                  </p>
                </div>
                <ListaHeader />
                <div className="divide-y divide-slate-100">
                  {arquivados.map((p) => (
                    <PlanRow
                      key={p.id}
                      plan={p} modules={modules} tenants={tenantCount[p.id] ?? 0}
                      onEdit={() => setEditing(p)}
                      onDuplicate={() => duplicar(p.id)}
                      duplicando={duplicandoId === p.id}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ⚠️ Uma grade só pro cabeçalho e pras linhas — se as duas divergirem, a coluna deixa de
//    significar coisa nenhuma e a comparação vertical (o motivo de virar lista) morre.
const GRADE = "grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_7rem_9rem_7rem_8rem_auto] items-center gap-x-4"

function ListaHeader() {
  return (
    <div className={`${GRADE} px-5 py-2 bg-slate-50/60 border-b border-slate-100`}>
      <span className="w-5" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Plano</span>
      <span className="hidden md:block text-[10px] font-bold uppercase tracking-wider text-slate-400 text-right">Preço</span>
      <span className="hidden md:block text-[10px] font-bold uppercase tracking-wider text-slate-400 text-right">Usuários</span>
      <span className="hidden md:block text-[10px] font-bold uppercase tracking-wider text-slate-400 text-right">Módulos</span>
      <span className="hidden md:block text-[10px] font-bold uppercase tracking-wider text-slate-400 text-right">Clientes</span>
      <span className="w-16" />
    </div>
  )
}

/**
 * Uma linha de plano.
 *
 * 🔑 LINHA, NÃO CARD (07/08). Card é bom pra RECONHECER um item; linha é boa pra
 *    COMPARAR itens. A pergunta que se faz nesta tela nunca é "o que é o PLANO II?" — é
 *    "o II e o III diferem em quê?". Em card, você lê os dois inteiros e compara de
 *    cabeça; em coluna, o mesmo atributo cai no mesmo lugar e a comparação vira varredura
 *    vertical. É o mesmo argumento que já justificava o controle de três estados dos
 *    módulos ("a leitura é na DIAGONAL") — a lista é que tinha ficado pra trás.
 */
function PlanRow({
  plan, modules, tenants, posicao, arrastavel = false, arrastando = false, alvo = false,
  onDragStart, onDragEnter, onDragEnd, onDrop, onMoverTeclado,
  onEdit, onDuplicate, duplicando,
}: {
  plan: Plan; modules: ModuleOption[]; tenants: number
  posicao?: number
  arrastavel?: boolean; arrastando?: boolean; alvo?: boolean
  onDragStart?: () => void; onDragEnter?: () => void; onDragEnd?: () => void; onDrop?: () => void
  onMoverTeclado?: (dir: -1 | 1) => void
  onEdit: () => void; onDuplicate: () => void; duplicando: boolean
}) {
  const modCount = plan.included_modules.length
  const proCount = plan.pro_modules?.length ?? 0
  const nomes = plan.included_modules
    .map((s) => modules.find((m) => m.slug === s)?.name ?? s)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))

  // 🔴 A INCOERÊNCIA QUE O CARD ESCONDIA. `user_quota` é quanto o PREÇO inclui;
  //    `limits.users` é o TETO de quantos ele consegue cadastrar. Medido em produção
  //    (07/08): o PLANO III inclui 3 no preço e tem teto 1 — o cliente paga por três e
  //    não consegue criar o segundo. Os dois números moravam em cantos opostos do card;
  //    em coluna eles ficam lado a lado e o erro salta.
  // ⚠️ Avisa, não impede. É decisão comercial, não regra de sistema — e uma tela que
  //    barrasse aqui impediria o dono de montar um plano de propósito assim.
  const teto = plan.limits?.users
  const incoerente = typeof teto === "number" && plan.user_quota > teto

  return (
    <div
      draggable={arrastavel}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(e) => { if (arrastavel) e.preventDefault() }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop?.() }}
      className={`${GRADE} px-5 py-3 transition-colors ${
        arrastando ? "opacity-40" : alvo ? "bg-primary-50/60" : "hover:bg-slate-50/70"
      } ${plan.active ? "" : "opacity-70"}`}
    >
      {/* Alça — também é o controle de teclado. Arrastar não pode ser o ÚNICO jeito:
          quem usa teclado (ou trackpad ruim) ficaria sem reordenar. */}
      {arrastavel ? (
        <button
          type="button"
          aria-label={`Mover ${plan.name}. Use as setas para cima e para baixo.`}
          title="Arraste para reordenar · ou use ↑ ↓"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp")   { e.preventDefault(); onMoverTeclado?.(-1) }
            if (e.key === "ArrowDown") { e.preventDefault(); onMoverTeclado?.(1) }
          }}
          className="w-5 flex items-center justify-center text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing focus:outline-none focus:text-primary rounded"
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="w-5" />
      )}

      {/* Nome — a entidade tem presença (§tipografia): semibold slate-900, não caption. */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {posicao && <span className="text-[11px] font-semibold text-slate-300 tabular-nums shrink-0">{posicao}</span>}
          <span className="text-sm font-semibold text-slate-900 truncate">{plan.name}</span>
          {incoerente && (
            <span title={`Inclui ${plan.user_quota} usuários no preço, mas o teto é ${teto}. O cliente paga por ${plan.user_quota} e só consegue cadastrar ${teto}.`}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-warning-bg border border-amber-200 rounded px-1.5 py-px shrink-0">
              <TriangleAlert className="size-3" /> cobra {plan.user_quota}, entrega {teto}
            </span>
          )}
          {modCount === 0 && (
            <span className="text-[10px] font-semibold text-amber-800 bg-warning-bg border border-amber-200 rounded px-1.5 py-px shrink-0">
              sem módulos
            </span>
          )}
        </div>
        {plan.description && <p className="text-xs text-slate-400 truncate mt-0.5">{plan.description}</p>}
        {/* Em telas estreitas as colunas somem — os mesmos números viram uma tira meta. */}
        <p className="md:hidden text-[11px] text-slate-500 tabular-nums mt-1">
          {BRL(plan.price_cents)}/mês · {plan.user_quota} usuário{plan.user_quota === 1 ? "" : "s"} · {modCount} módulo{modCount === 1 ? "" : "s"} · {tenants} cliente{tenants === 1 ? "" : "s"}
        </p>
      </div>

      {/* Preço — o herói da linha: ancorado à direita, bold, tabular. */}
      <div className="hidden md:block text-right">
        <span className="text-sm font-bold text-slate-900 tabular-nums">{BRL(plan.price_cents)}</span>
        <span className="text-[10px] text-slate-400">/mês</span>
      </div>

      <div className="hidden md:block text-right">
        <span className="text-xs font-semibold text-slate-700 tabular-nums">{plan.user_quota}</span>
        <span className="text-[10px] text-slate-400"> inclus{plan.user_quota === 1 ? "o" : "os"}</span>
        {plan.extra_user_price_cents > 0 && (
          <p className="text-[10px] text-slate-400 tabular-nums">+{BRL(plan.extra_user_price_cents)} extra</p>
        )}
      </div>

      <div className="hidden md:block text-right" title={nomes.join(" · ")}>
        <span className="text-xs font-semibold text-slate-700 tabular-nums">{modCount}</span>
        {proCount > 0 && <span className="text-[10px] font-semibold text-primary-600"> · {proCount} PRO</span>}
      </div>

      {/* 🔑 A CONTAGEM VIROU PORTA (07/08). Era um número morto — e numa operação de venda
          assistida a pergunta seguinte a todo preço é "quem está nele?". Zero não vira
          link: link que leva a lista vazia ensina a não clicar. */}
      <div className="hidden md:block text-right">
        {tenants > 0 ? (
          <Link href={`/admin/tenants?plano=${plan.id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 tabular-nums">
            {tenants} <ArrowRight className="size-3" />
          </Link>
        ) : (
          <span className="text-xs text-slate-300 tabular-nums">0</span>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0 justify-end">
        {/* Duplicar antes de Editar: quem duplica quase sempre vai editar em seguida,
            e o botão de destino fica à direita, no caminho do gesto. */}
        <button type="button" onClick={onDuplicate} disabled={duplicando}
          title="Duplicar este plano (a cópia nasce arquivada)"
          className="size-7 rounded-lg hover:bg-slate-200/70 flex items-center justify-center disabled:opacity-40">
          {duplicando ? <Loader2 className="size-3.5 animate-spin text-slate-500" /> : <Copy className="size-3.5 text-slate-500" />}
        </button>
        <button type="button" onClick={onEdit} title="Editar"
          className="size-7 rounded-lg hover:bg-slate-200/70 flex items-center justify-center">
          <Pencil className="size-3.5 text-slate-500" />
        </button>
      </div>
    </div>
  )
}

/** Estado de um módulo dentro do plano. É o coração da tela. */
type EstadoModulo = "fora" | "incluido" | "pro"

/**
 * Controle de TRÊS posições, alinhado em colunas.
 *
 * 🔴 POR QUE NÃO É CHECKBOX + INTERRUPTOR "PRO". Dois controles empilhados obrigam a ler
 *    linha por linha pra saber o que o plano entrega. Com as três posições na mesma
 *    vertical, a leitura é na DIAGONAL: varre a coluna do meio e vê o incluído, varre a
 *    da direita e vê o PRO. Numa tela que define receita, conferir tem que ser de relance.
 *
 * ⚠️ Sair de "pro" para "fora" NÃO passa por "incluído": o clique é direto no destino.
 *    Máquina de estado por posição, não por toggle — toggle encadeado é o que faz alguém
 *    marcar PRO sem querer.
 */
function TresEstados({ valor, onChange, nome }: {
  valor: EstadoModulo; onChange: (v: EstadoModulo) => void; nome: string
}) {
  const opcoes: { v: EstadoModulo; titulo: string }[] = [
    { v: "fora",     titulo: `${nome}: não incluído` },
    { v: "incluido", titulo: `${nome}: incluído` },
    { v: "pro",      titulo: `${nome}: incluído em PRO` },
  ]
  // ⚠️ `radiogroup` + `aria-checked`, NÃO `aria-pressed`. São três opções MUTUAMENTE
  //    exclusivas: `aria-pressed` declara "botão de alternância independente", e o leitor
  //    de tela não avisa que marcar uma desmarca as outras. Semântica errada aqui não é
  //    detalhe — é a diferença entre entender e não entender o que o plano entrega.
  return (
    <div role="radiogroup" aria-label={`Inclusão de ${nome} no plano`} className="flex items-center gap-1.5 shrink-0">
      {opcoes.map(({ v, titulo }) => {
        const ativo = valor === v
        return (
          <button
            key={v}
            type="button"
            role="radio"
            title={titulo}
            aria-label={titulo}
            aria-checked={ativo}
            onClick={() => onChange(v)}
            className={`size-[18px] rounded-full border transition-colors flex items-center justify-center ${
              ativo && v === "fora"     ? "border-slate-400 bg-slate-300"
              : ativo                   ? "border-primary bg-primary"
              : "border-slate-300 bg-white hover:border-slate-400"
            }`}
          >
            {ativo && v !== "fora" && <Check className="size-3 text-white" strokeWidth={3} />}
          </button>
        )
      })}
    </div>
  )
}

function PlanEditor({ plan, modules, tenantsUsing, onClose }: {
  plan: Plan | null; modules: ModuleOption[]; tenantsUsing: number; onClose: () => void
}) {
  const [name, setName]           = useState(plan?.name ?? "")
  const [description, setDesc]    = useState(plan?.description ?? "")
  const [price, setPrice]         = useState(plan ? centsToInput(plan.price_cents) : "")
  const [quota, setQuota]         = useState(plan ? String(plan.user_quota) : "1")
  const [extra, setExtra]         = useState(plan ? centsToInput(plan.extra_user_price_cents) : "")
  const [active, setActive]       = useState(plan?.active ?? true)
  const [mods, setMods]           = useState<Set<string>>(new Set(plan?.included_modules ?? []))
  const [pros, setPros]           = useState<Set<string>>(new Set(plan?.pro_modules ?? []))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [limits, setLimits]       = useState<Record<string, number | null | undefined>>(() => ({ ...(plan?.limits ?? {}) }))
  const [hasValidity, setHasValidity] = useState((plan?.trial_days ?? 0) > 0)
  const [trialDays, setTrialDays]     = useState(plan?.trial_days ? String(plan.trial_days) : "3")
  const [activation, setActivation]   = useState<string>(plan?.trial_activation_mode ?? "manual")
  const [feedback, setFeedback]   = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const grouped = useMemo(() => {
    const g: Record<string, ModuleOption[]> = {}
    for (const m of modules) (g[m.category] ??= []).push(m)
    return Object.entries(g)
  }, [modules])

  const estadoDe = (slug: string): EstadoModulo =>
    pros.has(slug) ? "pro" : mods.has(slug) ? "incluido" : "fora"

  /** 🔴 Tirar do plano tira o PRO junto — "PRO sem o módulo" não é estado exprimível.
   *     Mesma regra do god mode (desligar o módulo derruba o PRO) e do CHECK no banco. */
  function setEstado(slug: string, v: EstadoModulo) {
    setMods((prev) => {
      const n = new Set(prev)
      if (v === "fora") n.delete(slug); else n.add(slug)
      return n
    })
    setPros((prev) => {
      const n = new Set(prev)
      if (v === "pro") n.add(slug); else n.delete(slug)
      return n
    })
  }

  function save() {
    setFeedback(null)
    const input: PlanInput = {
      name,
      description:            description || null,
      price_cents:            inputToCents(price),
      user_quota:             parseInt(quota, 10) || 1,
      extra_user_price_cents: inputToCents(extra),
      included_modules:       Array.from(mods),
      pro_modules:            Array.from(pros).filter((s) => mods.has(s)),
      limits:                 Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) as Record<string, number | null>,
      trial_days:             hasValidity ? Math.max(1, parseInt(trialDays, 10) || 1) : 0,
      trial_activation_mode:  activation,
      active,
    }
    startTransition(async () => {
      const res = plan ? await updatePlan(plan.id, input) : await createPlan(input)
      if (res.error) setFeedback(res.error)
      else onClose()
    })
  }

  function remove() {
    if (!plan) return
    startTransition(async () => {
      const res = await deletePlan(plan.id)
      if (res.error) setFeedback(res.error)
      else onClose()
    })
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Cabeçalho fixo: o salvar não some ao rolar uma página de 4 blocos. */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* `disabled` como os outros: sair no meio de um save desmonta o editor e o
              erro nunca aparece — o feedback morre junto com o componente. */}
          <button type="button" onClick={onClose} disabled={pending} title="Voltar" className="size-8 rounded-lg hover:bg-slate-100 flex items-center justify-center shrink-0 disabled:opacity-40">
            <ArrowLeft className="size-4 text-slate-500" />
          </button>
          <h2 className="text-base font-bold text-slate-900 truncate">
            {plan ? `Editar plano · ${plan.name}` : "Novo plano"}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {plan && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
              className="h-9 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" /> Excluir
            </button>
          )}
          <button type="button" onClick={onClose} disabled={pending} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={save} disabled={pending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {plan ? "Salvar plano" : "Criar plano"}
          </button>
        </div>
      </div>

      <div className="px-6 py-6 space-y-4 max-w-6xl">
        {feedback && (
          <div className="flex items-start gap-2 p-3 rounded-lg text-xs bg-red-50 border border-red-200 text-red-800">
            <AlertCircle className="size-4 shrink-0 mt-0.5" /><span>{feedback}</span>
          </div>
        )}

        {/* ── BLOCO 1 ─────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-bold text-slate-900">Identidade e preço</h3>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              Plano ativo
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Nome do plano">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Pro" className={INP} />
            </Field>
            <Field label="Descrição curta">
              <input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="ex: Para equipes em crescimento" className={INP} />
            </Field>
            <Field label="Preço mensal (R$)">
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" className={INP} />
            </Field>
            <Field label="Usuários inclusos">
              <input value={quota} onChange={(e) => setQuota(e.target.value)} inputMode="numeric" placeholder="1" className={INP} />
            </Field>
            <Field label="Preço por usuário adicional (R$)">
              <input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" placeholder="0,00" className={INP} />
            </Field>
          </div>
        </section>

        {/* ── BLOCO 2 — o mais importante ──────────────────────── */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-900">O que está incluído</h3>
              <span className="text-[11px] text-slate-400">
                {mods.size} {mods.size === 1 ? "incluído" : "incluídos"}
                {pros.size > 0 && <span className="text-primary-600 font-semibold"> · {pros.size} em PRO</span>}
              </span>
            </div>
            {/* Legenda: sem ela, três círculos iguais viram adivinhação. */}
            <div className="flex items-center gap-4 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="size-[14px] rounded-full border border-slate-400 bg-slate-300" /> Não incluído</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-[14px] rounded-full bg-primary" /> Incluído</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-[14px] rounded-full bg-primary" /> Incluído em <b className="text-primary-700">PRO</b></span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-5">
            {grouped.map(([cat, items]) => (
              <div key={cat}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">{CATEGORY_LABEL[cat] ?? cat}</p>
                <div className="space-y-0.5">
                  {items.map((m) => {
                    const est = estadoDe(m.slug)
                    return (
                      <div key={m.slug} className="flex items-center justify-between gap-3 rounded px-1.5 py-1 hover:bg-slate-50">
                        <span className="text-sm text-slate-700 truncate flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{m.name}</span>
                          {est === "pro" && (
                            <span className="text-[9px] font-bold text-primary-700 border border-primary-300 rounded px-1 py-px shrink-0">PRO</span>
                          )}
                        </span>
                        <TresEstados valor={est} nome={m.name} onChange={(v) => setEstado(m.slug, v)} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── BLOCO 3 ─────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Limites</h3>
          <p className="text-[11px] text-slate-400 mb-4">Vazio = usa o padrão do sistema · &quot;ilimitado&quot; = sem teto.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-1.5">
              {LIMIT_KEYS.map((r) => {
                const v = limits[r]
                const unlimited = v === null
                return (
                  <div key={r} className="flex items-center gap-2">
                    <span className="flex-1 text-xs text-slate-600 truncate">{LIMIT_META[r].label}</span>
                    <input
                      type="number" min={0} disabled={unlimited}
                      value={unlimited || v === undefined ? "" : String(v)}
                      onChange={(e) => setLimits((p) => ({ ...p, [r]: e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                      placeholder="—"
                      className="w-24 h-8 px-2 text-sm text-right tabular-nums rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-300"
                    />
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none w-[68px]">
                      <input type="checkbox" checked={unlimited} onChange={(e) => setLimits((p) => ({ ...p, [r]: e.target.checked ? null : undefined }))} />
                      ilimitado
                    </label>
                  </div>
                )
              })}
          </div>
        </section>

        {/* ── BLOCO 4 ─────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Teste grátis</h3>

            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={hasValidity} onChange={(e) => setHasValidity(e.target.checked)} />
              Oferecer período de teste
            </label>

            {hasValidity ? (
              <div className="pl-6 flex items-center gap-2">
                <span className="text-xs text-slate-600">Expira em</span>
                <input
                  type="number" min={1} value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="w-20 h-8 px-2 text-sm text-right tabular-nums rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-xs text-slate-600">dias após a ativação</span>
              </div>
            ) : (
              <p className="pl-6 text-[11px] text-slate-400">Sem validade — o cliente segue ativo até você suspender no painel.</p>
            )}

            <div className="max-w-md">
              <p className="text-[11px] font-medium text-slate-500 mb-1">Forma de ativação</p>
              <div className="flex gap-2">
                {([["auto", "Automática no cadastro"], ["manual", "Manual (aprovo no painel)"]] as const).map(([val, label]) => (
                  <label key={val} className={`flex-1 flex items-center gap-2 text-xs rounded-md border px-2.5 py-2 cursor-pointer transition-colors ${activation === val ? "border-primary bg-primary-50 text-primary-700 font-medium" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    <input type="radio" name="activation" checked={activation === val} onChange={() => setActivation(val)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
        </section>
      </div>

      {confirmDelete && plan && (
        <ConfirmDelete
          plano={plan.name}
          clientes={tenantsUsing}
          pending={pending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </div>
  )
}

/**
 * Confirmação de exclusão, em DUAS caras.
 *
 * 🔴 Quando há cliente no plano o botão de excluir aparece DESABILITADO, não some: sumir
 *    deixa a pessoa procurando; desabilitado + o motivo escrito ensina. E a lista de quem
 *    está no plano é o que transforma "não pode" em "faça isto antes".
 */
function ConfirmDelete({ plano, clientes, pending, onCancel, onConfirm }: {
  plano: string; clientes: number; pending: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const bloqueado = clientes > 0
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-[480px]">
        <div className="p-5">
          {bloqueado && (
            <div className="size-9 rounded-lg bg-amber-50 flex items-center justify-center mb-3">
              <AlertCircle className="size-5 text-amber-600" />
            </div>
          )}
          <h3 className="text-base font-bold text-slate-900">
            {bloqueado ? `Não dá para excluir o plano ${plano}` : `Excluir o plano ${plano}?`}
          </h3>
          <p className="text-sm text-slate-500 mt-1.5">
            {bloqueado
              ? `${clientes} ${clientes === 1 ? "cliente está" : "clientes estão"} neste plano hoje. Mova ${clientes === 1 ? "esse cliente" : "esses clientes"} para outro plano antes de excluir — senão ${clientes === 1 ? "ele fica" : "eles ficam"} sem nenhum.`
              : "Nenhum cliente está neste plano. A exclusão não afeta ninguém."}
          </p>
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2 rounded-b-xl">
          <button type="button" onClick={onCancel} className="h-9 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg">
            {bloqueado ? "Fechar" : "Cancelar"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={bloqueado || pending}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-1.5 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Excluir plano
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  )
}
