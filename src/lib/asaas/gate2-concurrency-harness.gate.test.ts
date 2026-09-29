// Contrato estático do harness multi-sessão. Não abre conexão nem executa PowerShell.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const harness = readFileSync(resolve(
  process.cwd(),
  "scripts/test-billing-gate2-concurrency.ps1",
), "utf8")

describe("Gate 2 concurrency harness · fail-closed local", () => {
  it("recusa host, porta e database fora do cluster descartável", () => {
    expect(harness).toContain('$env:PGHOST -cne "127.0.0.1"')
    expect(harness).toContain('$env:PGPORT -cne "55432"')
    expect(harness).toContain('$env:PGDATABASE -cnotlike "billing_gate2_*"')
    expect(harness).toContain("AcknowledgeDisposableDatabase")
    expect(harness).toContain("inet_server_addr() = '127.0.0.1'::inet")
    expect(harness).toContain("inet_server_port() = 55432")
    expect(harness).toContain("current_database() LIKE 'billing_gate2\\_%'")
  })

  it("usa sessões independentes, timeout e mata somente processos que criou", () => {
    expect(harness).toContain("System.Diagnostics.ProcessStartInfo")
    expect(harness).toContain("RedirectStandardInput = $true")
    expect(harness).toContain("WaitForExit(45000)")
    expect(harness).toContain("possivel deadlock")
    expect(harness).toContain("$process.Kill($true)")
  })

  it("cobre catálogo vs atribuição e os dois eixos de concorrência financeira", () => {
    expect(harness).toContain("$assignmentSql")
    expect(harness).toContain("$catalogUpdateSql")
    expect(harness).toContain("SET application_name = 'gate2c_assignment'")
    expect(harness).toContain("BarrierSqlBeforeB = $assignmentPausedSql")
    expect(harness).toContain("FROM pg_catalog.pg_stat_activity")
    expect(harness).toContain("wait_event = 'PgSleep'")
    expect(harness).not.toContain("DelayBeforeBMilliseconds = 300")
    expect(harness).toContain("gate2c_pay_same")
    expect(harness).toContain("gate2c_pay_split_a")
    expect(harness).toContain("gate2c_pay_split_b")
    expect(harness).toContain('($samePaymentFlags -join ",") -cne "f,t"')
    expect(harness).toContain("count(*) = 2 AND sum(amount_cents) = 10000")
  })
})
