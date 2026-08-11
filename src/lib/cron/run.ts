import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { readBuildId } from "@/lib/build-id"
import { redigirTexto, redigirObjeto } from "@/lib/redact-text"

// ═══════════════════════════════════════════════════════════════
// `executarJob` — o livro de execuções do trabalho agendado
// ═══════════════════════════════════════════════════════════════
//
// Design: docs/cron-reliability-design.md (v3) · migration `20260810_cron_runs.sql`
//
// 🔴 POR QUE EXISTE, MEDIDO EM PROD (10/08): 15 jobs, 4.420 execuções em 24 h, zero
//    falhas — e `trial-housekeeping` reportando **39 ms** para um job que cancela
//    assinatura, anula fatura e roda a reconciliação inteira com o Asaas. Aquilo não é a
//    duração do trabalho; é a de ENFILEIRAR a chamada. `pg_net` é fire-and-forget.
//    Resultado: milhares de "sucessos" por dia e nenhuma informação sobre o trabalho ter
//    terminado.
//
// 🔒 A REGRA QUE GOVERNA ESTE ARQUIVO: **o livro nunca impede o trabalho.** Se o registro
//    falhar — tabela ausente, banco fora, migration não aplicada — o job **roda mesmo
//    assim**, sem linha nenhuma. Camada de observação que derruba produção é pior que
//    observação nenhuma; e o silêncio resultante é justamente o que o vigia detecta
//    (job sem linha = mudo = alerta). A única exceção é a trava, que é uma decisão
//    deliberada de NÃO trabalhar.

/**
 * Idade a partir da qual uma corrida `running` é considerada abandonada.
 *
 * ⚠️ Generoso de propósito: mais que o dobro da pior execução plausível da frota (a
 *    reconciliação, com até 200 tenants × chamada ao gateway). Curto demais mataria
 *    corrida viva e criaria a sobreposição que a trava existe pra impedir; longo demais
 *    devolve a pane permanente. Meia hora limita o estrago a um ciclo nas varreduras de
 *    5 e 15 min, que são as que mexem em dinheiro.
 */
const REAPER_MS = 30 * 60_000

/** O que o trabalho devolve. `partial` = fez o que deu e sobrou (F3). */
export type ResultadoDoJob = {
  status?:  "ok" | "partial" | "failed"
  processed?: number
  failed?:    number
  /** Identidade da unidade de trabalho — a janela que este lote pertence (F3). */
  workKey?:   string | null
  /** Cursor composto de onde continuar (F3). */
  cursor?:    Record<string, unknown> | null
  /** Forma, nunca conteúdo: contagens, ids, códigos. Nunca payload/PII. */
  meta?:      Record<string, unknown>
}

type Opcoes = {
  /**
   * O nome do JOB em `cron.job` — **nunca** o caminho da rota. Os dois divergem
   * (`billing-monthly` → `/api/cron/billing`), e chavear por rota rotula errado
   * exatamente na hora de investigar.
   *
   * ⚠️ Para função de negócio COMPARTILHADA, o nome é o do TRABALHO. `reconcileAsaas`
   *    tem dois chamadores; se cada um usasse o próprio nome, os dois entrariam ao mesmo
   *    tempo e creditariam o mesmo pagamento duas vezes.
   */
  job: string
  /**
   * `false` para quem **já tem trava melhor**.
   *
   * 🔴 `campaigns-engine-tick` roda a cada minuto e um lote leva legitimamente ~104 s —
   *    e ele já trava **por campanha** (`next_batch_at` empurrado 180 s antes de enviar).
   *    Uma trava global por nome de job é mais GROSSA: um lote lento do cliente A
   *    bloquearia B..T de enviarem qualquer coisa. Trava pior por cima de trava melhor é
   *    regressão, não segurança.
   */
  travar?: boolean
}

/**
 * ⚠️ União de DUAS pontas só, de propósito. A primeira versão distinguia também "rodou sem
 *    livro" — informação que nenhum chamador usa e que obrigava toda rota a tratar três
 *    ramos. Quem precisa saber que o livro falhou é o log (e o vigia, pela ausência da
 *    linha), não a resposta HTTP.
 */
export type SaidaDaExecucao =
  | { pulado: true }
  | { pulado: false; status: string; resultado: ResultadoDoJob }

/**
 * Roda `trabalho` com registro no livro e (opcionalmente) trava de exclusividade.
 *
 * Colisão com a trava devolve `skipped` e **não** executa — isso é sucesso, não erro:
 * significa "já tem alguém fazendo isso". Se virasse `failed`, o vigia gritaria à toa e
 * a gente aprenderia a ignorar o alerta, que é como alerta morre.
 */
export async function executarJob(
  { job, travar = true }: Opcoes,
  trabalho: () => Promise<ResultadoDoJob | void>,
): Promise<SaidaDaExecucao> {
  const runId = await abrir(job, travar)

  // Trava ocupada: sair sem trabalhar. O `skipped` fica FORA do índice parcial, então
  // não colide com a corrida viva — e o vigia não conta `skipped` como sinal de vida.
  if (runId === "ocupado") {
    await registrarPulo(job)
    return { pulado: true }
  }

  const inicio = Date.now()
  try {
    const r = (await trabalho()) ?? {}
    const status = r.status ?? "ok"
    await fechar(runId, status, r, Date.now() - inicio)
    return { pulado: false, status, resultado: r }
  } catch (e) {
    const msg = (e as Error).message
    await fechar(runId, "failed", { error: msg } as ResultadoDoJob & { error: string }, Date.now() - inicio, msg)
    // 🔑 RELANÇA. O livro registra o quê aconteceu; quem decide o que fazer é o chamador.
    //    Engolir aqui transformaria o registro numa forma de esconder falha.
    throw e
  }
}

/**
 * Abre a corrida. Devolve o `id`, `null` (sem livro — segue mesmo assim) ou `"ocupado"`.
 *
 * 🔑 A ISENÇÃO DE TRAVA É UM DADO (`exclusiva`), não um `if` aqui. O índice único é
 *    `WHERE status='running' AND exclusiva`, então a corrida isenta simplesmente **não
 *    entra no índice** — ela registra normalmente, inclusive sobreposta a outra do mesmo
 *    job. Sem essa coluna, os dois jobs de maior frequência (1.440 execuções/dia cada)
 *    ficariam sem linha no livro exatamente quando se sobrepõem, e o vigia leria o
 *    buraco como "mudo".
 */
async function abrir(job: string, travar: boolean): Promise<string | null | "ocupado"> {
  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 REAPER — sem ele, a trava transforma queda passageira em pane PERMANENTE
  // ══════════════════════════════════════════════════════════════════════════
  // Achado da revisão adversarial (11/08), e ele derruba o argumento que eu tinha
  // escrito no design ("reaper precisa de heartbeat, fica pra F3"):
  //
  //   Antes da trava, container morto no meio de um job era inconsequente — o tick
  //   seguinte rodava. AGORA a linha `running` órfã bloqueia o job **para sempre**. Um
  //   deploy no minuto errado, um OOM, ou um simples blip no UPDATE de fechamento
  //   (`fechar` falha ⇒ a rota ainda responde 200) desligam o faturamento em definitivo.
  //   Eu teria entregado uma peça que TROCA silêncio por pane.
  //
  // 🔑 E o argumento do heartbeat não se aplica a este caso: heartbeat é necessário pra
  //    matar corrida **lenta** sem matar a viva. Aqui a gente mata só o que passou de
  //    MEIA HORA — mais que o dobro da pior execução plausível da frota. Não precisa
  //    saber se ela está viva; nessa idade, ou morreu, ou já quebrou tudo que ia quebrar.
  if (travar) {
    const limite = new Date(Date.now() - REAPER_MS).toISOString()
    const { data: mortas } = await supabaseAdmin
      .from("cron_runs")
      .update({ status: "timeout", finished_at: new Date().toISOString(), error: "sem sinal — corrida abandonada" })
      .eq("job", job)
      .eq("status", "running")
      .lt("started_at", limite)
      .select("id")
    if (mortas && mortas.length > 0) {
      console.error(JSON.stringify({ src: "cron", kind: "corrida-abandonada-derrubada", job, n: mortas.length }))
    }
  }

  const { data, error } = await supabaseAdmin
    .from("cron_runs")
    .insert({ job, exclusiva: travar, meta: { build: readBuildId() } })
    .select("id")
    .single()

  if (!error) return (data as { id: string }).id

  // 23505 só é alcançável por corrida exclusiva — a isenta está fora do índice.
  if (error.code === "23505") return "ocupado"

  // Qualquer outra falha do livro: o trabalho SEGUE, sem linha. Ver a regra do topo.
  console.error(JSON.stringify({ src: "cron", kind: "livro-indisponivel-JOB-SEGUE", job, msg: error.message }))
  return null
}

/** Deixa rastro de que houve tentativa — senão "pulou" é indistinguível de "não rodou". */
async function registrarPulo(job: string) {
  const { error } = await supabaseAdmin
    .from("cron_runs")
    // `exclusiva: false` porque a linha já nasce encerrada — ela não disputa nada, e
    // marcá-la exclusiva só criaria uma chance a mais de colidir com a corrida viva.
    .insert({ job, status: "skipped", exclusiva: false, finished_at: new Date().toISOString(), meta: { build: readBuildId() } })
  if (error) console.error(JSON.stringify({ src: "cron", kind: "pulo-nao-registrado", job, msg: error.message }))
}

/**
 * Fecha a corrida — **condicionalmente**.
 *
 * 🔴 `.eq("status", "running")` NÃO É DECORAÇÃO. Quando o reaper existir (F3), ele pode
 *    marcar `timeout` numa corrida que só estava lenta. Sem esta condição, a corrida
 *    "morta" volta e sobrescreve com `ok` — apagando a evidência de que duas corridas
 *    trabalharam sobrepostas. Zero linhas afetadas ⇒ **perdemos a trava** ⇒ gritar.
 *
 * ⚠️ `finished_at` é o único timestamp que o app escreve, e é de propósito: o `UPDATE`
 *    não tem como usar `now()` do banco pelo PostgREST sem uma RPC. `started_at` e
 *    `heartbeat_at` continuam vindo do banco (DEFAULT), então a duração medida do lado
 *    do servidor (`meta.ms`) é a fonte confiável — não a subtração dos dois timestamps.
 */
async function fechar(
  runId: string | null,
  status: string,
  r: ResultadoDoJob,
  ms: number,
  erro?: string,
) {
  if (!runId) return

  const { data, error } = await supabaseAdmin
    .from("cron_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      processed: r.processed ?? 0,
      failed:    r.failed ?? 0,
      work_key:  r.workKey ?? null,
      cursor:    r.cursor ?? null,
      // 🔒 REDIGIDO ANTES DE PERSISTIR. `e.message` de job que fala com Asaas/Meta/Resend
      //    é string montada por terceiro — e coluna é pior que log: consultável,
      //    correlacionável e retida 90 dias. Sem isto, o livro viraria depósito
      //    pesquisável de e-mail, CPF e token ecoado de fora. Ver `redact-text.ts`.
      error:     redigirTexto(erro),
      meta:      redigirObjeto({ build: readBuildId(), ms, ...(r.meta ?? {}) }),
    })
    .eq("id", runId)
    .eq("status", "running")
    .select("id")

  if (error) {
    console.error(JSON.stringify({ src: "cron", kind: "fechamento-falhou", runId, msg: error.message }))
    return
  }
  if (!data || data.length === 0) {
    console.error(JSON.stringify({ src: "cron", kind: "PERDI-A-TRAVA-corrida-sobreposta", runId, status }))
  }
}
