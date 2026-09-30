import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260821000100_tenant_modules_source_foundation.sql",
)
const migration = readFileSync(migrationPath, "utf8")

function block(tag: "precheck" | "postcheck"): string {
  const match = migration.match(new RegExp(`DO \\$${tag}\\$([\\s\\S]*?)END \\$${tag}\\$;`, "i"))
  expect(match, `bloco ${tag} ausente`).not.toBeNull()
  return (match?.[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

describe("F7-source — baseline de segurança de tenant_modules", () => {
  it("prova o mesmo fechamento de RLS, ACL e publication antes e depois", () => {
    for (const sql of [block("precheck"), block("postcheck")]) {
      expect(sql).toContain("c.relrowsecurity")
      expect(sql).toContain("information_schema.table_privileges")
      expect(sql).toContain("p.grantee in ('anon', 'authenticated', 'public')")
      expect(sql).toContain("pg_catalog.has_table_privilege")
      expect(sql).toContain("('select'), ('insert'), ('update'), ('delete')")
      expect(sql).toContain("('truncate'), ('references'), ('trigger')")
      expect(sql).toContain("pg_catalog.pg_publication_tables")
      expect(sql).toContain("p.tablename = 'tenant_modules'")
    }
  })

  it("exige as duas FKs validadas, exatas e com cascade nos dois checkpoints", () => {
    for (const sql of [block("precheck"), block("postcheck")]) {
      expect(sql).toContain("c.contype = 'f'")
      expect(sql).toContain("c.convalidated")
      expect(sql).toContain("c.confdeltype = 'c'")
      expect(sql).toContain("c.confrelid = 'public.tenants'::regclass")
      expect(sql).toContain("c.confrelid = 'public.module_catalog'::regclass")
      expect(sql).toContain("= 'tenant_id'")
      expect(sql).toContain("= 'module_slug'")
      expect(sql).toContain("= 'slug'")
    }
  })

  it("exige uma única chave completa e recusa órfãos antes e depois", () => {
    for (const sql of [block("precheck"), block("postcheck")]) {
      expect(sql).toContain("i.indisunique")
      expect(sql).toContain("i.indisvalid")
      expect(sql).toContain("i.indpred is null")
      expect(sql).toContain("i.indnkeyatts = 2")
      expect(sql).toContain("i.indnatts = 2")
      expect(sql).toContain("array['tenant_id', 'module_slug']::text[]")
      expect(sql).toContain("left join public.tenants")
      expect(sql).toContain("left join public.module_catalog")
    }
  })

  it("continua atômica e preserva o snapshot de ACL/RLS", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*?\nBEGIN;/)
    expect(migration.trimEnd()).toMatch(/COMMIT;[\s\S]*rollback/i)
    expect(migration).toContain("tenant_modules_security_before")
    expect(migration).toMatch(/c\.relacl IS DISTINCT FROM b\.relacl/i)
    expect(migration).toMatch(/c\.relrowsecurity IS DISTINCT FROM b\.relrowsecurity/i)
    expect(migration).toMatch(/c\.relforcerowsecurity IS DISTINCT FROM b\.relforcerowsecurity/i)
    expect(migration).not.toMatch(/^\s*(?:GRANT|REVOKE)\s+/im)
  })
})
