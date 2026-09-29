// Local PostgreSQL integration test for per-item details on deal lines. Never connects to production.
// DEAL_DETAILS_PSQL points to psql; DEAL_DETAILS_PG_PORT is a local disposable test server.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
const exec = promisify(execFile)
const psql = process.env.DEAL_DETAILS_PSQL || "psql"
const port = process.env.DEAL_DETAILS_PG_PORT
if (!port || !/^\d+$/.test(port)) throw new Error("Set DEAL_DETAILS_PG_PORT to a local disposable PostgreSQL server")
const database = `kora_deal_details_test_${process.pid}`
const base = ["-X", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
const command = (db, sql) => exec(psql, [...base, "-d", db, "-c", sql])
await command("postgres", `CREATE DATABASE ${database}`)
try {
  await command("postgres", `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$`)
  await exec(psql, [...base, "-d", database, "-f", fileURLToPath(new URL("../supabase/tests/deal-item-details.sql", import.meta.url))], { maxBuffer: 1024 * 1024 })
  console.log("PASS: existing lines untouched, browser has no access to the column, details saved/edited/cleared, 1000 chars ok, 1001 refused, empty and blank refused, counted in characters")
} finally {
  await command("postgres", `DROP DATABASE ${database} WITH (FORCE)`)
}
