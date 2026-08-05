import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { runTrialHousekeeping } from "@/lib/trial-housekeeping"
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

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const startedAt = Date.now()
  // Sequencial e independentes: a reconciliação do storage não pode ser derrubada por
  // uma falha do housekeeping de trial, nem o contrário.
  const result  = await runTrialHousekeeping()
  const storage = await reconcileStorage()
  const elapsedMs = Date.now() - startedAt

  console.log("[cron/trial-housekeeping]", JSON.stringify({ elapsedMs, ...result, storage }))
  return NextResponse.json({ ok: true, elapsedMs, ...result, storage })
}
