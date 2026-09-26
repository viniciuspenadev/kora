// Local PostgreSQL integration test. Never connects to production.
// PASSWORD_RECOVERY_PSQL points to psql; PASSWORD_RECOVERY_PG_PORT is a local test server.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
const exec = promisify(execFile)
const psql = process.env.PASSWORD_RECOVERY_PSQL || "psql"
const port = process.env.PASSWORD_RECOVERY_PG_PORT
if (!port || !/^\d+$/.test(port)) throw new Error("Set PASSWORD_RECOVERY_PG_PORT to a local disposable PostgreSQL server")
const database = `kora_password_recovery_test_${process.pid}`
const base = ["-X", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1"]
async function command(db, sql) {
  const result = await exec(psql, [...base, "-d", db, "-At", "-c", sql], { maxBuffer: 1024 * 1024 })
  return result.stdout.trim()
}
await command("postgres", `CREATE DATABASE ${database}`)
try {
  // These test roles match Supabase. On a fresh local runtime create them once.
  await command("postgres", `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$`)
  await exec(psql, [...base, "-d", database, "-f", fileURLToPath(new URL("../supabase/tests/password-recovery.sql", import.meta.url))], { maxBuffer: 1024 * 1024 })
  const limits = await Promise.all(Array.from({ length: 20 }, () => command(database, "SELECT public.take_password_reset_limit(repeat('9',64),3,3600)")))
  assert.equal(limits.filter(value => value === "t").length, 3, "parallel rate cap")
  // Fingerprint = sha256 hex of the stored hash, exactly as hashResetToken() computes it in the app.
  const fp = (hash) => `encode(sha256(convert_to(${hash},'UTF8')),'hex')`
  const consumeSql = `SELECT public.consume_password_reset(repeat('f',64),'$2b$12$'||repeat('A',53),${fp("'$2b$12$'||repeat('A',53)")},'$2b$12$'||repeat('B',53))`
  const claims = await Promise.all([command(database, consumeSql), command(database, consumeSql)])
  assert.equal(claims.filter(Boolean).length, 1, "exactly one parallel token consumer")
  // Parallel issuance for one account: every request is served, but only the LAST link stays alive.
  const issueSql = (i) => `SELECT public.issue_password_reset('44444444-4444-4444-4444-444444444444','paralelo@example.com','$2b$12$'||repeat('D',53),lpad(to_hex(${i}),64,'0'),${fp("'$2b$12$'||repeat('D',53)")})`
  const issued = await Promise.all(Array.from({ length: 10 }, (_, i) => command(database, issueSql(i + 1))))
  assert.equal(issued.filter(value => value === "t").length, 10, "parallel issuance serialized")
  assert.equal(await command(database, "SELECT count(*) FROM public.password_reset_tokens WHERE user_id='44444444-4444-4444-4444-444444444444' AND consumed_at IS NULL"), "1", "only one live link after parallel issuance")
  // Retention cleanup under contention: 30 callers, each on its own abandoned (>24h) key, while
  // every call's cleanup targets the others' rows. A lock cycle here surfaces as "deadlock detected".
  const stale = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => command(database, `SELECT public.take_password_reset_limit(lpad(to_hex(${1001 + i}),64,'e'),5,600)`)))
  const staleErrors = stale.filter(r => r.status === "rejected").map(r => String(r.reason?.stderr ?? r.reason).trim().split("\n")[0])
  assert.deepEqual(staleErrors, [], "cleanup contention must not deadlock")
  assert.equal(stale.filter(r => r.status === "fulfilled" && r.value === "t").length, 30, "every contended caller accepted")
  console.log("PASS: migration, grants under Supabase default ACLs, rate cap, retention, issuance CAS, consume refusals, cascade + isolation, replay, stale proof guards (5 tables + re-trust), cross-path invalidation, concurrent rate cap, concurrent reset, concurrent issuance, cleanup contention")
} finally {
  await command("postgres", `DROP DATABASE ${database} WITH (FORCE)`)
}
