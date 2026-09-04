#!/usr/bin/env node
import {
  EXPECTED_CHECKS,
  buildReadOnlyContractSql,
  evaluateContractRows,
  extractContractRows,
} from "./lib/db-live-contract.mjs"

function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF?.trim()) return process.env.SUPABASE_PROJECT_REF.trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) return ""
  try { return new URL(url).hostname.split(".")[0] ?? "" } catch { return "" }
}

function selfTest() {
  const sql = buildReadOnlyContractSql()
  if (!/^BEGIN READ ONLY;/i.test(sql) || !/COMMIT;\s*$/i.test(sql)) {
    throw new Error("SQL do contrato deve ser explicitamente READ ONLY e atomico")
  }
  const good = EXPECTED_CHECKS.map((objeto) => ({ objeto, ok: true }))
  if (!evaluateContractRows(extractContractRows({ result: good })).ok) {
    throw new Error("fixture valida foi recusada")
  }
  const bad = good.map((row, index) => index === 0 ? { ...row, ok: false } : row)
  if (evaluateContractRows(bad).ok) throw new Error("fixture divergente foi aceita")
  console.log(`✅ Contrato DB: self-test OK (${EXPECTED_CHECKS.length} invariantes).`)
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest()
  if (process.argv.includes("--print-sql")) {
    process.stdout.write(buildReadOnlyContractSql() + "\n")
    return
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  const ref = projectRef()
  if (!token || !ref) {
    console.error("Uso: SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (ou NEXT_PUBLIC_SUPABASE_URL) npm run check:db-live")
    process.exitCode = 2
    return
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: buildReadOnlyContractSql() }),
    signal: AbortSignal.timeout(20_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    console.error(`❌ Contrato DB: Management API respondeu HTTP ${response.status}.`)
    process.exitCode = 1
    return
  }

  const rows = extractContractRows(payload)
  const result = evaluateContractRows(rows)
  if (!result.ok) {
    console.error("❌ Contrato DB incompatível com o código:")
    for (const key of result.failed) console.error(`   FALHOU  ${key}`)
    for (const key of result.missing) console.error(`   AUSENTE ${key}`)
    for (const key of result.unexpected) console.error(`   EXTRA   ${key}`)
    process.exitCode = 1
    return
  }
  console.log(`✅ Contrato DB ao vivo OK (${rows.length} invariantes, consulta READ ONLY).`)
}

main().catch((error) => {
  console.error(`❌ Contrato DB: ${error instanceof Error ? error.message : "falha inesperada"}`)
  process.exitCode = 1
})
