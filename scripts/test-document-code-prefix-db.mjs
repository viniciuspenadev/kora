// Local PostgreSQL integration test for the stored document code prefix (COT → ORC). Never connects to production.
// DOC_PREFIX_PSQL points to psql; DOC_PREFIX_PG_PORT is a local disposable test server.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
const exec = promisify(execFile)
const psql = process.env.DOC_PREFIX_PSQL || "psql"
const port = process.env.DOC_PREFIX_PG_PORT
if (!port || !/^\d+$/.test(port)) throw new Error("Set DOC_PREFIX_PG_PORT to a local disposable PostgreSQL server")
const database = `kora_doc_prefix_test_${process.pid}`
const base = ["-X", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
const command = (db, sql) => exec(psql, [...base, "-d", db, "-c", sql])
await command("postgres", `CREATE DATABASE ${database}`)
try {
  await command("postgres", `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF; END $$`)
  await exec(psql, [...base, "-d", database, "-f", fileURLToPath(new URL("../supabase/tests/document-code-prefix.sql", import.meta.url))], { maxBuffer: 1024 * 1024 })
  console.log("PASS: issued docs keep COT, draft stays unprefixed, browser cannot execute trigger fn, new docs continue the same sequence as ORC, numbered without prefix refused, same number with other prefix refused, draft emission needs prefix, issued prefix frozen (change/erase refused, other edits pass), prefix format")
} finally {
  await command("postgres", `DROP DATABASE ${database} WITH (FORCE)`)
}
