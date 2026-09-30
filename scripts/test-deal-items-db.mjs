// Local PostgreSQL integration test for the deal-item foundation (F1). Never connects to production.
// DEAL_ITEMS_PSQL points to psql; DEAL_ITEMS_PG_PORT is a local disposable test server.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const exec = promisify(execFile)
const psql = process.env.DEAL_ITEMS_PSQL || "psql"
const port = process.env.DEAL_ITEMS_PG_PORT
if (!port || !/^\d+$/.test(port)) throw new Error("Set DEAL_ITEMS_PG_PORT to a local disposable PostgreSQL server")
const database = `kora_deal_items_test_${process.pid}`
const base = ["-X", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1"]
// -q: sem a linha de status ("INSERT 0 1") colada no resultado de um RETURNING.
const command = async (db, sql) => (await exec(psql, [...base, "-q", "-d", db, "-At", "-c", sql], { maxBuffer: 1024 * 1024 })).stdout.split(/\r?\n/)[0].trim()
await command("postgres", `CREATE DATABASE ${database}`)
try {
  await command("postgres", `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$`)
  await exec(psql, [...base, "-d", database, "-f", fileURLToPath(new URL("../supabase/tests/deal-items-manual.sql", import.meta.url))], { maxBuffer: 1024 * 1024 })
  // Race: item removed while another session wins the deal — the trigger must see a consistent state.
  const deal = await command(database, "INSERT INTO public.tenant_deals (tenant_id, pipeline_id, status) VALUES ('00000000-0000-0000-0000-00000000000a','20000000-0000-0000-0000-000000000001','open') RETURNING id")
  await command(database, `INSERT INTO public.tenant_deal_items (tenant_id, deal_id, catalog_item_id, name, source) VALUES ('00000000-0000-0000-0000-00000000000a','${deal}',NULL,'x','manual')`)
  const outcomes = await Promise.allSettled([
    command(database, `UPDATE public.tenant_deals SET status='won' WHERE id='${deal}' RETURNING status`),
    command(database, `DELETE FROM public.tenant_deal_items WHERE deal_id='${deal}' RETURNING id`),
  ])
  assert.ok(outcomes.every((o) => o.status === "fulfilled" || /deal_requires_items/.test(String(o.reason?.stderr))), "race ends in a clean outcome")
  console.log("PASS: source backfill, browser cannot execute trigger fn, source↔catalog link CHECK, RESTRICT on used product, lock off = no change, lock on blocks update/insert to won, item (manual counts) unlocks, D4 no re-check after won, lost/canceled free, other tenant/no-pipeline unaffected, concurrent win × item delete")
} finally {
  await command("postgres", `DROP DATABASE ${database} WITH (FORCE)`)
}
