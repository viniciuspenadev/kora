import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"
import { runTrialHousekeeping } from "@/lib/trial-housekeeping"
import { reconcileAsaas } from "@/lib/asaas/reconcile"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * GET /api/cron/trial-housekeeping
 *
 * Roda 1x/dia. Faz duas manutenções independentes:
 *   1. Trials vencidos (active=false + lifecycle=suspended) e purga de PII de cadastros
 *      consumidos/expirados (LGPD).
 *   2. **Reconciliação do ledger de armazenamento** — ver abaixo.
 * Autentica via CRON_SECRET.
 *
 * Schedule sugerido: "5 8 * * *" (5h08 UTC ≈ 5h BRT — fora do horário de pico).
 */

/**
 * Reconstrói `tenant_storage_objects` a partir do bucket.
 *
 * 🔴 SEM ISTO O LEDGER CONGELA no estado da última execução manual — arquivo novo não
 *    ganha atribuição e arquivo apagado continua "existindo" pra faxina. A função é
 *    idempotente por desenho (deriva tudo do path), então rodar todo dia é seguro e o
 *    custo é uma passada no catálogo do Storage.
 *
 * ⚠️ `sem_dono` > 0 é TRABALHO, não erro: são arquivos no bucket sem tenant atribuível
 *    (tenant removido, ou caminho que nenhum prefixo conhece). Medido em 2026-07-31: 8
 *    arquivos de um cliente já apagado. Fica no log de propósito — número escondido vira
 *    dívida; número exposto vira tarefa.
 *
 * ⚠️ NÃO mede cota. O número que o cliente vê sai de `tenant_storage_usage()`, que lê o
 *    bucket direto (docs/tenant-storage-foundation-design.md §1). Este ledger é
 *    ATRIBUIÇÃO — de quem é o arquivo — pra faxina e LGPD.
 */
async function reconcileStorage() {
  const { data, error } = await supabaseAdmin.rpc("reconcile_storage_objects")
  if (error) {
    // 42883 = função ainda não aplicada; silencioso pra não poluir log em ambiente antigo.
    if (error.code !== "42883") console.error("[cron/storage-reconcile]", error.code, error.message)
    return null
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    { inseridos?: number; atualizados?: number; removidos?: number; sem_dono?: number } | null
  return row ?? null
}

// ⚠️ `maxDuration` saiu: diretiva da Vercel, inerte no runtime standalone. Este é o job
//    mais pesado da frota (3 varreduras + reconciliação inteira + RPC de storage) e é
//    justamente o que reportava "39 ms" — o tempo de enfileirar, não o de trabalhar.
//    A duração real passa a viver em `cron_runs.meta.ms`.
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const saida = await executarJob({ job: "trial-housekeeping" }, async () => {
    // Sequencial e independentes: a reconciliação do storage não pode ser derrubada por
    // uma falha do housekeeping de trial, nem o contrário.
    const result = await runTrialHousekeeping()

    // 💳 RECONCILIAÇÃO COM O GATEWAY (05/08/2026). Roda DEPOIS do housekeeping de
    //    propósito: o bloco 1.a já não suspende quem tem assinatura, e esta varredura
    //    libera quem pagou e ficou preso em `trial_ended` porque o webhook se perdeu. Sem
    //    ela, uma única entrega HTTP falha deixava um cliente pagante travado,
    //    indefinidamente e em silêncio — o webhook era ponto único de falha do produto.
    // ⚠️ Não derruba o cron se falhar: as outras tarefas do dia não dependem dela.
    // 🔑 E ela toma a trava `reconcile-asaas` POR DENTRO — é o que impede este job e o
    //    `reconcile-billing` de reconciliarem em paralelo (nomes de job diferentes não
    //    colidem entre si).
    let billing: Awaited<ReturnType<typeof reconcileAsaas>> | { erro: string }
    try {
      billing = await reconcileAsaas()
    } catch (e) {
      billing = { erro: (e as Error).message }
      console.error("[cron/reconcile-asaas]", (e as Error).message)
    }

    const storage = await reconcileStorage()

    return {
      processed: result.suspended + result.encerradosPorFalta,
      meta: { ...result, storage, billing },
      // 🔴 O QUE NÃO CABE AQUI: devolver `billing`/`storage` inteiros na resposta HTTP
      //    continua valendo — quem chama por curl quer ver tudo. O livro fica com a forma.
    }
  })

  if (saida.pulado) return NextResponse.json({ ok: true, pulado: "já em execução" })

  console.log("[cron/trial-housekeeping]", JSON.stringify(saida.resultado?.meta))
  return NextResponse.json({ ok: true, ...(saida.resultado?.meta ?? {}) })
}
