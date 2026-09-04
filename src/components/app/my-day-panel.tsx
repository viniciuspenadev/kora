"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarClock, AlarmClock, CalendarCheck, X, Loader2, ChevronRight,
  CheckCheck, Check, Sunrise, ArrowUpRight,
} from "lucide-react"
import { ContactPic } from "@/components/chat/contact-pic"
import { toast } from "sonner"
import { TaskDialog } from "@/components/crm/task-dialog"
import { getMyDay, type DayItem } from "@/lib/actions/my-day"
import { completeFollowUp, scheduleFollowUp, cancelFollowUp } from "@/lib/actions/followup"
import { FollowUpDialog } from "@/components/chat/followup-dialog"

// ═══════════════════════════════════════════════════════════════
// "Tarefas" — painel do ícone de agenda na topbar (docs/atendimento-followup-design.md §5 S4)
// ⚠️ Chamava-se "Meu dia" até 2026-08-20 (o dono renomeou). O arquivo/ação mantêm
//    `my-day` de propósito: renomear arquivo é ruído de diff, e o nome de tela é
//    conteúdo — muda mais que o código.
// ═══════════════════════════════════════════════════════════════
// A gestão do follow-up mora AQUI, e não enterrada no inbox: o dono pediu um lugar
// a uma tecla de qualquer tela. Junta os dois compromissos do atendente — a promessa
// de voltar (follow-up) e o encontro marcado (agenda) — porque pra quem trabalha eles
// disputam o mesmo horário.
//
// Supervisor/admin ganham a aba EQUIPE. Sem permissão nova: quem vê a conversa/agenda
// já via; o servidor decide (`canSeeTeam`).
//
// A superfície é uma CENTRAL DE TRABALHO ligada à topbar, não um dashboard dentro
// de um modal. Resumo temporal compacto + lista editorial por dia; o espaço pertence
// aos compromissos, não a cartões de KPI decorativos.

const TZ = "America/Sao_Paulo"
const HORIZONTE = 30

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
const chaveDoDia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
const diaExtenso = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short", timeZone: TZ }).replace(".", "")

/** Atrasado · Hoje · Amanhã · Futuro. PURA: o "agora" entra por parâmetro (vem do
 *  estado) — ler o relógio no render deixaria a tela não-determinística. */
type Faixa = "atrasado" | "hoje" | "amanha" | "futuro"
/** Lentes do topo: as 4 faixas de tempo + o histórico do que já foi cumprido. */
type Lente = Faixa | "feitos"
function faixaDe(at: string, agora: number): Faixa {
  const t = new Date(at).getTime()
  if (t < agora) return "atrasado"
  const dia = chaveDoDia(at)
  if (dia === chaveDoDia(new Date(agora).toISOString())) return "hoje"
  if (dia === chaveDoDia(new Date(agora + 86_400_000).toISOString())) return "amanha"
  return "futuro"
}

/** "agora" · "em 25min" · "em 3h" · "há 2 dias" — compacto, cabe embaixo da hora.
 *  PURA: recebe o "agora" (o render não lê relógio). */
function distanciaCurta(at: string, agora: number): string {
  const min = Math.round((new Date(at).getTime() - agora) / 60_000)
  const abs = Math.abs(min)
  if (abs < 2)      return "agora"
  const rotulo = abs < 60 ? `${abs}min` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`
  return min < 0 ? `há ${rotulo}` : `em ${rotulo}`
}

/** Inicial pro fallback do avatar (mesma regra do inbox). */
const inicialDe = (nome: string) => Array.from(nome.trim())[0]?.toLocaleUpperCase("pt-BR") || "?"

interface Grupo { chave: string; titulo: string; atrasado: boolean; itens: DayItem[] }

/** Agrupa POR DIA (o atraso vira um grupo só, no topo — é o que se olha primeiro). */
function agrupar(itens: DayItem[], agora: number): Grupo[] {
  // ⚠️ Cumprido NUNCA é "atrasado" — ele aconteceu. Vai pro grupo do dia dele,
  //    como histórico; chamá-lo de atrasado seria cobrar quem já entregou.
  const atrasados = itens.filter((i) => !i.done && faixaDe(i.at, agora) === "atrasado")
  const resto     = itens.filter((i) => i.done || faixaDe(i.at, agora) !== "atrasado")

  const porDia = new Map<string, DayItem[]>()
  for (const i of resto) {
    const k = chaveDoDia(i.at)
    const arr = porDia.get(k)
    if (arr) arr.push(i); else porDia.set(k, [i])
  }

  const grupos: Grupo[] = []
  if (atrasados.length) grupos.push({ chave: "atrasado", titulo: "Atrasados", atrasado: true, itens: atrasados })
  for (const [k, arr] of Array.from(porDia.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const f = faixaDe(arr[0].at, agora)
    grupos.push({
      chave: k,
      titulo: f === "hoje" ? `Hoje · ${diaExtenso(arr[0].at)}` : f === "amanha" ? `Amanhã · ${diaExtenso(arr[0].at)}` : diaExtenso(arr[0].at),
      atrasado: false,
      itens: arr,
    })
  }
  return grupos
}

export function MyDayPanel() {
  const router = useRouter()
  const [open, setOpen]     = useState(false)
  const [scope, setScope]   = useState<"me" | "team">("me")
  const [lente, setLente]   = useState<Lente | null>(null)
  const [tipo, setTipo]     = useState<"all" | DayItem["kind"]>("all")
  const [data, setData]     = useState<{ items: DayItem[]; canSeeTeam: boolean; agendaOn: boolean; crmOn?: boolean; tasksLimited?: boolean; crmUnavailable?: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [contador, setContador] = useState(0)
  const [concluindo, setConcluindo] = useState<string | null>(null)
  /** Ficha da promessa aberta a partir da lista — a MESMA do calendário. */
  const [taskId, setTaskId] = useState<string | null>(null)
  const request = useRef(0)
  const [loadError, setLoadError] = useState("")
  const [ficha, setFicha] = useState<DayItem | null>(null)
  /** Relógio do painel: carimbado a cada carga (o render nunca lê `Date.now()`). */
  const [agora, setAgora] = useState(0)

  const carregar = useCallback(async (s: "me" | "team") => {
    const ticket = ++request.current
    setLoading(true); setLoadError("")
    try {
      const r = await getMyDay({ scope: s, horizonDays: HORIZONTE })
      if (ticket !== request.current) return
      const t = Date.now()
      setAgora(t)
      setData(r)
      // Contador do ícone ignora o CUMPRIDO: ele fica na lista como histórico,
      // mas não é mais pendência — cobrar o que já foi feito seria mentira.
      if (s === "me") {
        setContador(r.items.filter((i) => !i.done && ["atrasado", "hoje"].includes(faixaDe(i.at, t))).length)
      }
    } catch { if(ticket === request.current) setLoadError("Não foi possível atualizar as tarefas.") } finally {
      if(ticket === request.current) setLoading(false)
    }
  }, [])

  // Contador do ícone: o que venceu + o que é pra hoje. Carrega ao montar e a cada
  // 5 min — o mesmo passo da varredura; olhar mais rápido não adianta.
  useEffect(() => {
    let vivo = true
    const puxar = () => { if (vivo) void carregar(open ? scope : "me") }
    puxar()
    const t = setInterval(puxar, 5 * 60_000)
    return () => { vivo = false; clearInterval(t) }
  }, [carregar, open, scope])

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [open])

  function abrir()  { setOpen(true); setLente(null); setTipo("all"); void carregar(scope) }
  function trocarAba(s: "me" | "team") { setScope(s); void carregar(s) }
  /** Clique na linha: promessa abre a FICHA (reagendar · cumpri · cancelar · abrir
   *  conversa) — pular direto pra conversa tirava a pessoa da lista sem ela pedir,
   *  o mesmo defeito que o dono apontou no calendário. Agendamento segue navegando:
   *  a máquina dele é a Agenda, não esta. */
  function ir(item: DayItem) {
    if (item.kind === "task") { setTaskId(item.id); return }
    if (item.kind === "followup") { setFicha(item); return }
    setOpen(false)
    router.push(item.href)
  }

  /** Concluir a promessa SEM sair do painel — ler e agir no mesmo lugar. */
  async function concluir(item: DayItem) {
    setConcluindo(item.id)
    try {
      const result = await completeFollowUp(item.id)
      if ("error" in result) { toast.error(result.error); return }
      await carregar(scope)
    } finally {
      setConcluindo(null)
    }
  }

  const itens   = data?.items ?? []
  // KPI conta PENDÊNCIA. O cumprido continua visível na lista, mas fora dos números.
  const conta   = (f: Faixa) => itens.filter((i) => !i.done && faixaDe(i.at, agora) === f).length
  const nFeitos = itens.filter((i) => i.done).length
  const nAtraso = conta("atrasado")
  const nHoje   = conta("hoje")
  const nAmanha = conta("amanha")
  const nFuturo = conta("futuro")

  const pelaData = !lente
    ? itens
    : lente === "feitos"
      ? itens.filter((i) => i.done)
      : itens.filter((i) => !i.done && faixaDe(i.at, agora) === lente)
  const visiveis = tipo === "all" ? pelaData : pelaData.filter((i) => i.kind === tipo)
  const grupos = agrupar(visiveis, agora)

  /** Uma lente por clique; clicar de novo volta pra visão inteira. */
  const alternar = (f: Lente) => setLente((atual) => (atual === f ? null : f))

  const faixas: Array<{ key: Faixa; label: string; value: number }> = [
    { key: "atrasado", label: "Atrasados", value: nAtraso },
    { key: "hoje", label: "Hoje", value: nHoje },
    { key: "amanha", label: "Amanhã", value: nAmanha },
    { key: "futuro", label: "Próximos", value: nFuturo },
  ]

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-label={`Tarefas${contador ? ` · ${contador} pra agora` : ""}`}
        className={`relative inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl border px-2 transition-colors ${
          open
            ? "border-primary-200 bg-primary-50 text-primary-700"
            : "border-transparent text-nav-dim hover:border-nav-line hover:bg-nav-hover hover:text-nav-strong"
        }`}
      >
        <CalendarClock className="size-[18px]" strokeWidth={1.8} />
        {/* Selo redondo sobreposto (padrão escolhido pelo dono 2026-08-20). A COR
            carrega significado: vermelho quando há promessa atrasada, azul quando
            é só o compromisso de hoje. */}
        {contador > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] px-1 grid place-items-center rounded-full text-white text-[10px] font-bold leading-none tabular-nums ring-2 ring-nav ${
            nAtraso > 0 ? "bg-red-500" : "bg-primary"
          }`}>
            {contador > 99 ? "99+" : contador}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/10 sm:bg-transparent"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Tarefas"
            className="absolute inset-x-2 bottom-2 top-[4.25rem] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_60px_-22px_rgba(15,23,42,0.45)] sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:h-[min(680px,calc(100dvh-5rem))] sm:w-[520px]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="shrink-0 border-b border-slate-200 bg-white">
              <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold tracking-tight text-slate-950">Tarefas</h2>
                    {loading && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {data?.crmOn ? "Follow-ups e tarefas" : "Follow-ups"}{data?.agendaOn ? " · agenda" : ""} · próximos {HORIZONTE} dias
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar tarefas"
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                  <X className="size-4" />
                </button>
              </div>

              {data?.canSeeTeam && (
                <div className="flex items-center gap-5 px-4">
                  {([["me", "Minhas"], ["team", "Equipe"]] as const).map(([k, rotulo]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => trocarAba(k)}
                      aria-pressed={scope === k}
                      className={`-mb-px border-b-2 pb-2 text-xs font-semibold transition-colors ${
                        scope === k
                          ? "border-primary text-primary-700"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              )}
            </header>

            <div className="grid shrink-0 grid-cols-4 border-b border-slate-200 bg-slate-50/70">
              {faixas.map((faixa) => {
                const ativa = lente === faixa.key
                const atrasada = faixa.key === "atrasado" && faixa.value > 0
                return (
                  <button
                    key={faixa.key}
                    type="button"
                    onClick={() => alternar(faixa.key)}
                    aria-pressed={ativa}
                    className={`relative px-2 py-2.5 text-left transition-colors hover:bg-white focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300 ${
                      ativa ? "bg-white" : ""
                    }`}
                  >
                    <span className={`block text-lg font-bold leading-none tabular-nums ${
                      atrasada ? "text-red-600" : ativa ? "text-primary-700" : "text-slate-900"
                    }`}>
                      {faixa.value}
                    </span>
                    <span className={`mt-1 block truncate text-[10px] font-medium ${
                      atrasada ? "text-red-600" : ativa ? "text-primary-700" : "text-slate-500"
                    }`}>
                      {faixa.label}
                    </span>
                    {ativa && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
                  </button>
                )
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-3 py-2">
              {([
                ["all", "Todos"],
                ["followup", "Follow-ups"],
                ...(data?.crmOn ? [["task", "CRM"]] : []),
                ...(data?.agendaOn ? [["appointment", "Agenda"]] : []),
              ] as Array<["all" | DayItem["kind"], string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTipo(key)}
                  aria-pressed={tipo === key}
                  className={`h-7 rounded-md px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 ${
                    tipo === key
                      ? "bg-primary text-white shadow-sm shadow-primary/15 hover:bg-primary-700"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => alternar("feitos")}
                aria-pressed={lente === "feitos"}
                className={`ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 ${
                  lente === "feitos"
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                <Check className="size-3" />
                <span className="hidden min-[360px]:inline">Concluídos</span>
                <span className="tabular-nums">{nFeitos}</span>
              </button>
            </div>

            {loadError && <p role="alert" className="px-4 py-2 text-xs text-red-700">{loadError}</p>}
            {data?.crmUnavailable && <p role="alert" className="px-4 py-2 text-xs text-red-700">Não foi possível carregar as tarefas do CRM. A lista e os contadores estão incompletos. <button type="button" disabled={loading} className="underline disabled:opacity-50" onClick={() => void carregar(scope)}>Tentar novamente</button></p>}
            {data?.tasksLimited && <p className="px-4 py-2 text-xs text-slate-500">Exibindo até 200 tarefas comerciais. Consulte todas na gestão.</p>}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading && itens.length === 0 && (
                <div className="divide-y divide-slate-100">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="h-8 w-12 animate-pulse rounded bg-slate-100" />
                      <div className="size-9 animate-pulse rounded-full bg-slate-100" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-2/5 animate-pulse rounded bg-slate-100" />
                        <div className="h-2.5 w-3/5 animate-pulse rounded bg-slate-100" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && visiveis.length === 0 && (
                <div className="grid h-full min-h-48 place-items-center px-8 py-12 text-center">
                  <div>
                    <span className="mx-auto grid size-10 place-items-center rounded-full bg-slate-100">
                      <Sunrise className="size-5 text-slate-400" strokeWidth={1.7} />
                    </span>
                    <p className="mt-3 text-sm font-semibold text-slate-800">
                      {data?.crmUnavailable ? "Consulta incompleta" : lente || tipo !== "all"
                        ? "Nada nesta seleção"
                        : scope === "team" ? "A equipe está em dia" : "Seu dia está limpo"}
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                      {data?.crmUnavailable ? "Tente carregar novamente para conferir as pendências do CRM." : lente || tipo !== "all"
                        ? "Altere ou desmarque os filtros para consultar os outros compromissos."
                        : "Seus próximos compromissos aparecerão aqui em ordem de horário."}
                    </p>
                  </div>
                </div>
              )}

              {grupos.map((g) => (
                <section key={g.chave}>
                  <div className={`sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-1.5 backdrop-blur ${
                    g.atrasado ? "border-red-100 bg-red-50/95" : "border-slate-100 bg-slate-50/95"
                  }`}>
                    <h3 className={`text-[10.5px] font-semibold capitalize tracking-wide ${
                      g.atrasado ? "text-red-700" : "text-slate-600"
                    }`}>
                      {g.titulo}
                    </h3>
                    <span className={`text-[10px] font-semibold tabular-nums ${g.atrasado ? "text-red-500" : "text-slate-400"}`}>
                      {g.itens.length}
                    </span>
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {g.itens.map((i) => {
                      const ocupado = concluindo === i.id
                      const followup = i.kind === "followup"
                      return (
                        <li key={`${i.kind}-${i.id}`} className={`group flex items-stretch transition-colors hover:bg-slate-50 ${
                          g.atrasado && !i.done ? "bg-red-50/30" : ""
                        }`}>
                          <button
                            type="button"
                            onClick={() => ir(i)}
                            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300"
                          >
                            <div className="w-12 shrink-0">
                              <p className={`text-[15px] font-bold leading-none tabular-nums ${
                                g.atrasado && !i.done ? "text-red-700" : "text-slate-900"
                              }`}>
                                {hora(i.at)}
                              </p>
                              <p className={`mt-1.5 text-[10px] font-medium leading-none ${
                                g.atrasado && !i.done ? "text-red-500" : "text-slate-400"
                              }`}>
                                {distanciaCurta(i.at, agora)}
                              </p>
                            </div>

                            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
                              <ContactPic
                                pic={i.avatarUrl ?? null}
                                initial={inicialDe(i.title)}
                                imgClass="size-9 object-cover"
                                fallbackClass="text-xs font-bold"
                              />
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className={`truncate text-[13px] font-semibold leading-tight ${
                                  i.done ? "text-slate-400 line-through" : "text-slate-900"
                                }`}>
                                  {i.title}
                                </p>
                                <span title={followup ? "Follow-up" : i.kind === "task" ? "Tarefa CRM" : "Agenda"} className={followup ? "text-primary-600" : "text-emerald-600"}>
                                  {followup ? <AlarmClock className="size-3" /> : <CalendarCheck className="size-3" />}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                {i.subtitle ?? (followup ? "Sem observação" : "Compromisso")}
                              </p>
                            </div>

                            <div className="hidden max-w-32 shrink-0 text-right sm:block">
                              {i.done ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                                  <Check className="size-3" /> Concluído
                                </span>
                              ) : i.answered ? (
                                <span title="O cliente voltou a falar" className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                                  <CheckCheck className="size-3" /> Respondeu
                                </span>
                              ) : (
                                <span className={`text-[10px] font-semibold ${followup ? "text-primary-700" : "text-emerald-700"}`}>
                                  {followup ? "Follow-up" : i.kind === "task" ? "Tarefa CRM" : "Agenda"}
                                </span>
                              )}
                              {i.ownerName && <p className="mt-1 truncate text-[10px] text-slate-400">{i.ownerName}</p>}
                            </div>

                            <span
                              aria-hidden="true"
                              className="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition-colors group-hover:bg-primary-50 group-hover:text-primary-700"
                            >
                              <ChevronRight className="size-4" strokeWidth={2.2} />
                            </span>
                          </button>

                          <div className="flex shrink-0 items-center pr-2">
                            {followup && !i.done && (
                              <button
                                type="button"
                                onClick={() => concluir(i)}
                                disabled={ocupado}
                                title="Marcar como concluído"
                                aria-label={`Concluir follow-up de ${i.title}`}
                                className="grid size-8 place-items-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
                              >
                                {ocupado ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3">
              <p className="min-w-0 truncate text-[11px] text-slate-500">
                <span className="font-semibold tabular-nums text-slate-800">{visiveis.length}</span>{" "}
                {visiveis.length === 1 ? "compromisso" : "compromissos"}
                {!lente && tipo === "all" && ` · próximos ${HORIZONTE} dias`}
              </p>
              {data?.crmOn && <button onClick={() => { setOpen(false); router.push("/tarefas") }} className="text-xs font-semibold text-primary-700">Gerir tarefas</button>}
              {data?.agendaOn && (
                <button
                  type="button"
                  onClick={() => { setOpen(false); router.push("/agenda") }}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-700 transition-colors hover:text-primary-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                  Abrir agenda <ArrowUpRight className="size-3.5" />
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {taskId && <TaskDialog id={taskId} onClose={() => setTaskId(null)} onChanged={() => { void carregar(scope) }} />}
      {/* A MESMA ficha do calendário — uma peça só pras duas superfícies. Fica
          fora do painel no DOM pra desenhar por cima dele. */}
      {ficha && (
        <FollowUpDialog
          contactName={ficha.title}
          contactPic={ficha.avatarUrl ?? null}
          ownerName={ficha.ownerName}
          current={{ follow_up_at: ficha.at, follow_up_note: ficha.subtitle, follow_up_set_at: ficha.at }}
          onClose={() => setFicha(null)}
          onOpenConversation={() => { setFicha(null); setOpen(false); router.push(ficha.href) }}
          onComplete={async () => {
            const r = await completeFollowUp(ficha.id)
            if ("error" in r) return r
            await carregar(scope)
          }}
          onSave={async (dueAt, note) => {
            const r = await scheduleFollowUp(ficha.id, { dueAt, note })
            if ("error" in r) return r
            await carregar(scope)
          }}
          onCancel={async () => {
            const r = await cancelFollowUp(ficha.id)
            if ("error" in r) return r
            await carregar(scope)
          }}
        />
      )}
    </>
  )
}
