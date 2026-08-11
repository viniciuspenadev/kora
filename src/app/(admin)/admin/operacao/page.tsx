import { Activity, AlertTriangle, CircleSlash, Clock3, Database, Zap } from "lucide-react"
import { getEstadoDaFrota, type EstadoDoJob } from "@/lib/cron/status"

// ═══════════════════════════════════════════════════════════════
// /admin/operacao — o trabalho agendado, visível
// ═══════════════════════════════════════════════════════════════
//
// Design: docs/cron-reliability-design.md §7
//
// 🔴 A PERGUNTA QUE ESTA TELA RESPONDE, e que até 10/08 não tinha resposta: **o
//    faturamento rodou?** O agendador reportava 4.420 execuções por dia, todas
//    "succeeded", com o `trial-housekeeping` em **39 ms** — um job que cancela assinatura,
//    anula fatura e roda a reconciliação inteira. Aquilo era o tempo de ENFILEIRAR a
//    chamada. Milhares de sucessos por dia e zero informação sobre o trabalho ter
//    terminado.
//
// 🔑 DUAS FONTES, DITAS COM HONESTIDADE. Os 12 jobs HTTP têm duração real no nosso livro.
//    Os 3 SQL puros não estão no livro **de propósito** — neles o trabalho roda dentro do
//    próprio agendador, que reporta a verdade. A tela rotula a origem em vez de fingir uma
//    fonte só; tela que esconde o que não sabe é a mesma classe de defeito que ela veio
//    consertar.
//
// 🔒 Herda o portão de platform admin do layout de `(admin)`. Só leitura — o botão de
//    destravar (ação privilegiada, com motivo e trilha) vem junto do vigia.

export const dynamic = "force-dynamic"

const fmtHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"

/** "há 3 min" — o que se lê num incidente, não o timestamp absoluto. */
function faz(iso: string | null): string {
  if (!iso) return "nunca"
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return `há ${s}s`
  const m = Math.floor(s / 60)
  if (m < 90) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

const fmtMs = (ms: number | null) =>
  ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`

// Cadência em português — a expressão crua do agendador não diz nada pra quem lê a tela.
// ⚠️ Comentário de LINHA de propósito: a expressão de 5 em 5 minutos contém a sequência
//    que fecha um bloco `/* */`, e escrevê-la num docblock quebra o arquivo inteiro.
function cadencia(schedule: string): string {
  const s = schedule.trim()
  if (s.startsWith("* ")) return "a cada minuto"
  const m = s.match(/^\*\/(\d+)\s/)
  if (m) return `a cada ${m[1]} min`
  const h = s.match(/^(\d+)\s+(\d+)\s/)
  if (h) return `todo dia ${h[2].padStart(2, "0")}:${h[1].padStart(2, "0")} UTC`
  return s
}

function Estado({ j }: { j: EstadoDoJob }) {
  if (!j.ativo)   return <Chip cor="danger"  icone={CircleSlash}   texto="desagendado" />
  if (j.atrasado) return <Chip cor="danger"  icone={AlertTriangle} texto="atrasado" />
  if (j.inedito)  return <Chip cor="neutro"  icone={Clock3}        texto="ainda não visto" />
  if (j.status === "failed" || j.status === "timeout")
    return <Chip cor="danger" icone={AlertTriangle} texto={j.status === "timeout" ? "sem resposta" : "falhou"} />
  if (j.status === "partial") return <Chip cor="atencao" icone={Clock3} texto="parcial" />
  // 🔴 `running` NÃO é "em dia" (revisão 11/08). Caía no `else` e pintava verde — então
  //    uma corrida travada aparecia saudável durante a margem inteira, que nos diários é
  //    26 horas. É exatamente o estado que o operador precisa ver.
  if (j.status === "running") return <Chip cor="atencao" icone={Clock3} texto="em curso" />
  // 🔴 E falha CONTADA também não é "em dia": `reconcile-billing` fecha `ok` com
  //    `failed: 200` quando o gateway recusa tudo. O único job que sabe dizer "o Asaas
  //    está fora" dizia isso num campo que ninguém lia.
  if ((j.failed ?? 0) > 0) return <Chip cor="atencao" icone={AlertTriangle} texto={`${j.failed} falhas`} />
  return <Chip cor="ok" icone={Activity} texto="em dia" />
}

function Chip({ cor, icone: Icone, texto }: {
  cor: "ok" | "atencao" | "danger" | "neutro"
  icone: typeof Activity
  texto: string
}) {
  const estilo = {
    ok:      "text-emerald-700 bg-emerald-50 border-emerald-200",
    atencao: "text-amber-800 bg-amber-50 border-amber-200",
    danger:  "text-red-700 bg-red-50 border-red-200",
    neutro:  "text-slate-600 bg-slate-50 border-slate-200",
  }[cor]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${estilo}`}>
      <Icone className="size-3.5 shrink-0" />{texto}
    </span>
  )
}

export default async function OperacaoPage() {
  const { jobs, semAgendador } = await getEstadoDaFrota()

  const problemas = jobs.filter((j) => j.atrasado || !j.ativo || j.status === "failed" || j.status === "timeout")
  const maisLento = [...jobs].sort((a, b) => (b.duracaoMs ?? -1) - (a.duracaoMs ?? -1))[0]

  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 pt-10 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Operação</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {jobs.length} trabalhos agendados · a duração é a real, medida no servidor
        </p>
      </div>

      <div className="px-4 sm:px-6 pb-8 space-y-4">
        {/* ⚠️ O aviso de degradação vem ANTES da tabela: uma lista incompleta sem aviso é
            pior que lista nenhuma, porque parece completa. */}
        {semAgendador && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-px size-4 shrink-0" />
            Não consegui ler o agendador agora. A lista abaixo mostra só o que já rodou —
            um trabalho <strong>desagendado</strong> não apareceria aqui.
          </p>
        )}

        {/* Tira de contexto: o que precisa de gente, e onde está o gargalo. */}
        <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
          <Resumo
            rotulo="Precisam de atenção"
            valor={String(problemas.length)}
            meta={problemas.length ? problemas.map((p) => p.job).join(" · ") : "nenhum"}
            destaque={problemas.length > 0}
          />
          <Resumo
            rotulo="Mais demorado"
            valor={maisLento?.duracaoMs != null ? fmtMs(maisLento.duracaoMs) : "—"}
            meta={maisLento?.job ?? "—"}
          />
          <Resumo
            rotulo="No livro"
            valor={String(jobs.filter((j) => j.fonte === "livro").length)}
            meta={`de ${jobs.length} · os demais são SQL, medidos pelo agendador`}
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_auto_1fr_auto] gap-4 border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
            <span>Trabalho</span><span>Cadência</span><span>Última</span><span className="text-right">Feito</span><span className="text-right">Duração</span><span className="text-right">Estado</span>
          </div>

          {jobs.map((j) => (
            <article key={j.job}
              className={`grid grid-cols-1 gap-1 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto_1fr_auto] sm:items-center sm:gap-4 ${
                j.atrasado || !j.ativo ? "bg-red-50/40" : ""
              }`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{j.job}</p>
                {j.erro && <p className="truncate text-xs text-red-700" title={j.erro}>{j.erro}</p>}
              </div>

              <span className="text-xs text-slate-500">{cadencia(j.schedule)}</span>

              <span className="text-xs text-slate-500" title={fmtHora(j.ultima)}>
                {faz(j.ultima)}
                {/* 🔑 A ORIGEM DITA. Sem isto, "nunca" num job SQL leria como falha — e ele
                    está saudável; é que a verdade dele mora no agendador, não no livro. */}
                {j.fonte === "agendador" && !j.inedito && (
                  <span className="ml-1 text-slate-400">(agendador)</span>
                )}
              </span>

              {/* Volume: o que o job realmente fez. Estava calculado e jogado fora. */}
              <span className="text-xs tabular-nums sm:text-right">
                {j.processed === null ? <span className="text-slate-300">—</span> : (
                  <>
                    <span className="text-slate-700">{j.processed}</span>
                    {(j.failed ?? 0) > 0 && <span className="text-red-700 font-semibold"> +{j.failed}!</span>}
                  </>
                )}
              </span>

              <span className="text-xs tabular-nums text-slate-700 sm:text-right">
                {j.fonte === "livro" ? fmtMs(j.duracaoMs) : (
                  <span className="inline-flex items-center gap-1 text-slate-400" title="Job SQL: roda dentro do agendador, não passa pelo livro">
                    <Database className="size-3" />SQL
                  </span>
                )}
              </span>

              <div className="sm:text-right"><Estado j={j} /></div>
            </article>
          ))}
        </div>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
          <Zap className="mt-px size-3.5 shrink-0" />
          A duração vem do próprio servidor, não do agendador — ele mede só o tempo de
          enfileirar a chamada e por isso reportava dezenas de milissegundos para trabalhos
          de segundos.
        </p>
      </div>
    </div>
  )
}

function Resumo({ rotulo, valor, meta, destaque }: {
  rotulo: string; valor: string; meta: string; destaque?: boolean
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className={`text-xl font-bold tabular-nums ${destaque ? "text-red-700" : "text-slate-900"}`}>{valor}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-400" title={meta}>{meta}</p>
    </div>
  )
}
