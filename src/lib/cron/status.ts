import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Estado da frota agendada — o que a tela e o vigia leem
// ═══════════════════════════════════════════════════════════════
//
// Design: docs/cron-reliability-design.md §6 e §7
//
// 🔑 A EXPECTATIVA VEM DE `cron.job`, NÃO DE LISTA NO CÓDIGO. Lista fixa é bug latente por
//    construção: job novo nasce sem vigia, cadência muda e ninguém atualiza a lista. Foi
//    exatamente assim que a primeira versão do plano contou 6 jobs quando existiam 15.
//    Aqui a fonte é o agendador; o código só interpreta.
//
// 🔑 DUAS FONTES, DITAS COM HONESTIDADE. Os 12 jobs HTTP têm a verdade no nosso livro
//    (`cron_runs`). Os 3 jobs SQL puros **não estão** no livro de propósito — neles o
//    trabalho roda dentro do próprio `pg_cron`, então `cron.job_run_details` reporta
//    duração real (medido: `storage-reconcile` em 201 ms é verdade). A mentira do
//    fire-and-forget só existe onde há salto HTTP. Fingir uma fonte só faria a tela mentir
//    sobre o que ela sabe.

/** Cadência → margem antes de considerar atrasado. Derivada, nunca fixa por job. */
export function margemMs(schedule: string): number {
  const s = schedule.trim()
  // `* * * * *` (1 min) · `*/N * * * *` (N min) · resto = diário/horário
  if (s.startsWith("* ")) return 5 * 60_000
  const m = s.match(/^\*\/(\d+)\s/)
  if (m) return Math.max(3, Number(m[1]) * 3) * 60_000
  if (/^\d+\s+\*\s/.test(s)) return 3 * 60 * 60_000     // de hora em hora
  return 26 * 60 * 60_000                                // diário: 24 h + folga
}

export type EstadoDoJob = {
  job:        string
  schedule:   string
  ativo:      boolean
  /** `livro` = temos duração real. `agendador` = job SQL, verdade vem do pg_cron. */
  fonte:      "livro" | "agendador"
  ultima:     string | null
  status:     string | null
  duracaoMs:  number | null
  processed:  number | null
  failed:     number | null
  /** Atrasado além da margem da própria cadência. */
  atrasado:   boolean
  /** Nunca observado — não é atraso, é ausência de histórico (arranque a frio). */
  inedito:    boolean
  erro:       string | null
}

type LinhaDoLivro = {
  job: string; started_at: string; status: string
  processed: number | null; failed: number | null
  error: string | null; meta: { ms?: number } | null
}

/**
 * Monta o estado de TODOS os jobs agendados.
 *
 * ⚠️ Falha do agendador não derruba a tela: a lista cai para os jobs que o LIVRO conhece.
 *    Mas `semAgendador` fica `true` e a tela precisa dizer, em letras claras, que ali
 *    ela **não sabe** o que deveria ter rodado — um job desagendado que nunca rodou não
 *    aparece por nenhum dos dois caminhos.
 */
export async function getEstadoDaFrota(): Promise<{ jobs: EstadoDoJob[]; semAgendador: boolean }> {
  const agendados = await supabaseAdmin.rpc("cron_jobs_agendados")
  const doAgendador = (agendados.data ?? []) as Array<{ jobname: string; schedule: string; active: boolean; via_http: boolean }>

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 O LIVRO TAMBÉM ENTRA NA LISTA — duas razões, as duas achadas na revisão de 11/08
  // ══════════════════════════════════════════════════════════════════════════
  // 1. **A trava de TRABALHO é invisível.** `reconcileAsaas` grava com o nome
  //    `reconcile-asaas`, que NÃO existe em `cron.job` — é um nome sintético (§4.1). Se
  //    a lista viesse só do agendador, ela nunca apareceria aqui. E ela é a mais fácil de
  //    travar da frota (execução mais longa, chamada ao gateway por tenant): uma corrida
  //    órfã a deixaria pulando para sempre, com `reconcile-billing` e `trial-housekeeping`
  //    fechando **verdes** por cima — porque para eles "pulou" devolve zeros e zeros
  //    fecham `ok`. A única varredura que destrava cliente que pagou ficaria desligada,
  //    invisível, com dois jobs dizendo que está tudo bem. Era o §0 reintroduzido pela
  //    peça que veio matá-lo.
  //
  // 2. **O fallback que eu tinha PROMETIDO não existia.** O comentário abaixo dizia que a
  //    tela mostra o livro quando o agendador falha — e o código montava tudo a partir da
  //    RPC, então uma falha dela produzia lista VAZIA com "0 trabalhos, nenhum problema".
  //    A tela de incidente lendo "tudo certo" é pior que tela em branco, porque tem um
  //    número tranquilizador nela.
  const { data: conhecidos } = await supabaseAdmin
    .from("cron_runs").select("job").order("job")
  const nomesDoLivro = [...new Set(((conhecidos ?? []) as Array<{ job: string }>).map((r) => r.job))]

  const jaListados = new Set(doAgendador.map((j) => j.jobname))
  const lista = [
    ...doAgendador,
    // Sem cadência conhecida: são travas de trabalho, disparadas por outro job. A margem
    // cai na regra diária (a mais frouxa) — de propósito: não sabemos a cadência delas, e
    // alarme falso numa tela de plantão custa mais que alarme tardio.
    ...nomesDoLivro.filter((n) => !jaListados.has(n))
      .map((n) => ({ jobname: n, schedule: "—", active: true, via_http: true })),
  ]

  // Quando o livro começou a existir — âncora do teto de "ainda não visto" (abaixo).
  const { data: maisAntiga } = await supabaseAdmin
    .from("cron_runs").select("started_at").order("started_at", { ascending: true }).limit(1).maybeSingle()
  const livroDesde = (maisAntiga as { started_at: string } | null)?.started_at ?? null

  // 🔴 UMA CONSULTA POR JOB, E NÃO UM LOTE ÚNICO ORDENADO POR DATA (bug meu, pego na
  //    releitura). A versão anterior pegava as 500 corridas mais recentes e agrupava aqui.
  //    Parece equivalente e não é: `campaigns-engine-tick` e `studio-wait-resume` rodam a
  //    cada minuto — 2.880 linhas/dia só os dois. As 500 mais recentes cobrem **menos de
  //    três horas**, então a última corrida do faturamento (1×/dia) **nunca estaria no
  //    lote**. Ele apareceria como "ainda não visto" para sempre — e "ainda não visto" é
  //    exatamente o estado que a tela usa para NÃO alarmar. O job mais importante da
  //    frota ficaria permanentemente invisível na tela feita pra vigiá-lo.
  // ⚠️ São ~15 consultas indexadas (`idx_cron_runs_job_recente`), em paralelo, numa tela
  //    de operação. Barato, e correto por construção em vez de por tamanho de lote.
  const ultimas = await Promise.all(
    lista.map((j) =>
      supabaseAdmin
        .from("cron_runs")
        .select("job, started_at, status, processed, failed, error, meta")
        .eq("job", j.jobname)
        // `skipped` NÃO conta como sinal de vida (§3 do design): um job travado apareceria
        // verde para sempre. Fica registrado, mas não serve de "última execução".
        .neq("status", "skipped")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  )

  const ultimaPorJob = new Map<string, LinhaDoLivro>()
  ultimas.forEach((r, i) => {
    if (r.data) ultimaPorJob.set(lista[i].jobname, r.data as LinhaDoLivro)
  })

  const agora = Date.now()

  const jobs: EstadoDoJob[] = lista.map((j) => {
    const l = ultimaPorJob.get(j.jobname)
    const ultima = l?.started_at ?? null
    // Sem linha no livro pode ser job SQL (que nunca vai ter) ou job HTTP nunca observado.
    const fonte: "livro" | "agendador" = l ? "livro" : "agendador"
    const atrasoOk = ultima ? agora - new Date(ultima).getTime() <= margemMs(j.schedule) : false

    // 🔴 TETO PARA "AINDA NÃO VISTO" (revisão 11/08). Só vale para job que DEVERIA
    //    escrever no livro (`via_http`): os 3 jobs SQL rodam dentro do pg_cron e nunca
    //    terão linha — tratá-los como atrasados seria alarme permanente sobre job
    //    saudável. Para os HTTP: se o livro já existe há mais que a margem do job e ele
    //    nunca escreveu, isso deixou de ser novidade. É o caso de alguém renomear a rota
    //    do faturamento — o pg_net passa a tomar 404, `executarJob` nunca roda, e sem
    //    este teto a tela diria "ainda não visto" em cinza para sempre, justamente sobre
    //    o job mais importante da frota.
    const estreiaVencida = !ultima && j.via_http && !!livroDesde
      && agora - new Date(livroDesde).getTime() > margemMs(j.schedule)

    return {
      job:       j.jobname,
      schedule:  j.schedule,
      ativo:     j.active,
      fonte,
      ultima,
      status:    l?.status ?? null,
      duracaoMs: l?.meta?.ms ?? null,
      processed: l?.processed ?? null,
      failed:    l?.failed ?? null,
      // 🔑 ARRANQUE A FRIO: job sem nenhuma linha NÃO é "atrasado" — é "ainda não visto".
      //    Sem esta distinção, o primeiro deploy pintaria a tela inteira de vermelho e o
      //    vigia dispararia doze e-mails no dia em que deveria ganhar confiança.
      // 🔴 TETO PARA "AINDA NÃO VISTO" (revisão 11/08). `inedito` é neutro de propósito
      //    (arranque a frio), mas SEM LIMITE ele vira ponto cego: renomeie a rota do
      //    faturamento e o `pg_net` passa a receber 404 — `executarJob` nunca roda, o
      //    livro nunca ganha linha, e a tela diz "ainda não visto" em cinza PARA SEMPRE,
      //    justamente sobre o job mais importante da frota. Passada a margem desde que a
      //    tabela existe, ausência de linha deixa de ser novidade e vira atraso.
      atrasado:  j.active && !atrasoOk && (!!ultima || estreiaVencida),
      inedito:   !ultima && !estreiaVencida,
      erro:      l?.error ?? null,
    }
  })

  return { jobs, semAgendador: !!agendados.error }
}
