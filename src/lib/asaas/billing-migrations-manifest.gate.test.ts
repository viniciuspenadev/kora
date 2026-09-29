// Gate estático da allow-list de migrations de billing.
//
// Não executa SQL nem abre conexão. O manifesto existe justamente porque a ordem lexical
// dos arquivos não é uma autorização de deploy e `supabase db push` é amplo demais para
// um banco sem histórico confiável de migrations.

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const MANIFEST_PATH = resolve(process.cwd(), "supabase/billing-migrations.manifest.json")
const F2A = "supabase/migrations/20260821000300_invoice_payments_gateway_atomic.sql"
const SOURCE = "supabase/migrations/20260821000100_tenant_modules_source_foundation.sql"
const F7A = "supabase/migrations/20260821000200_billing_apply_plan_atomic.sql"
// F2a fica por último: ela habilita o trigger financeiro e fecha a RPC-base. As fundações
// de entitlement devem estar validadas antes de abrir essa nova superfície operacional.
const REQUIRED = [SOURCE, F7A, F2A] as const

interface MigrationEntry {
  path: string
  sha256: string
  phase: string
  requires: string[]
  precheck: string
  rollback: string
}

interface BillingManifest {
  status: string
  strategy: string
  cleanInstall: string
  hashCanonicalization: string
  targetBaseline: unknown
  migrations: MigrationEntry[]
}

function loadManifest(): BillingManifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error("manifesto obrigatório ausente: supabase/billing-migrations.manifest.json")
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as BillingManifest
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsOf)
  }
  return []
}

function validate(manifest: BillingManifest): string[] {
  const errors: string[] = []
  if (manifest.status !== "local-no-go") errors.push("status deve permanecer local-no-go")
  if (manifest.strategy !== "exact-files-only") errors.push("strategy deve ser exact-files-only")
  if (manifest.cleanInstall !== "unsupported-overlay-only") errors.push("bootstrap limpo deve permanecer bloqueado")
  if (manifest.hashCanonicalization !== "utf8-lf") errors.push("hash deve usar UTF-8/LF canônico")
  if (!manifest.targetBaseline || typeof manifest.targetBaseline !== "object") {
    errors.push("targetBaseline deve registrar o snapshot alvo")
  } else {
    const excluded = (manifest.targetBaseline as { mustRemainExcluded?: unknown }).mustRemainExcluded
    if (!Array.isArray(excluded)
      || !excluded.includes("supabase/migrations/20260803_entitlements_restructure.sql")) {
      errors.push("migration multifase destrutiva deve permanecer excluída")
    }
  }
  if (!Array.isArray(manifest.migrations)) return [...errors, "migrations deve ser array"]

  const paths = manifest.migrations.map((entry) => entry.path)
  if (new Set(paths).size !== paths.length) errors.push("paths duplicados")
  for (const required of REQUIRED) {
    if (!paths.includes(required)) errors.push(`migration obrigatória ausente: ${required}`)
  }
  if (paths.length === REQUIRED.length && paths.some((path, index) => path !== REQUIRED[index])) {
    errors.push("ordem operacional deve ser F7-source -> F7a -> F2a")
  }
  for (const path of paths) {
    if (!REQUIRED.includes(path as typeof REQUIRED[number])) errors.push(`migration não autorizada: ${path}`)
    if (!/^supabase\/migrations\/[0-9][a-z0-9_-]*\.sql$/i.test(path)) {
      errors.push(`path não é arquivo SQL exato: ${path}`)
    }
    if (/[?*\[\]{}]/.test(path)) errors.push(`wildcard proibido: ${path}`)
  }

  const expectedPhases = new Map<string, string>([
    [SOURCE, "F7-source"],
    [F7A, "F7a"],
    [F2A, "F2a"],
  ])
  for (const entry of manifest.migrations) {
    if (expectedPhases.get(entry.path) !== entry.phase) errors.push(`phase inválida: ${entry.path}`)
  }
  const versions = paths.map((path) => /^supabase\/migrations\/(\d{14})_/.exec(path)?.[1] ?? "")
  if (versions.some((version) => !version)) errors.push("toda migration deve ter versão canônica de 14 dígitos")
  if (versions.some((version, index) => index > 0 && version <= versions[index - 1])) {
    errors.push("versões devem ser únicas e estritamente crescentes")
  }

  const sourceIndex = paths.indexOf(SOURCE)
  const f7aIndex = paths.indexOf(F7A)
  if (sourceIndex < 0 || f7aIndex < 0 || sourceIndex >= f7aIndex) {
    errors.push("fundação source deve vir antes da RPC F7a")
  }

  for (const [index, entry] of manifest.migrations.entries()) {
    if (!Array.isArray(entry.requires)) {
      errors.push(`requires inválido em ${entry.path}`)
      continue
    }
    for (const dependency of entry.requires) {
      const dependencyIndex = paths.indexOf(dependency)
      if (dependencyIndex < 0) errors.push(`dependência ausente: ${entry.path} -> ${dependency}`)
      if (dependencyIndex >= index) errors.push(`dependência fora de ordem: ${entry.path} -> ${dependency}`)
    }
    if (!entry.precheck?.trim()) errors.push(`precheck ausente: ${entry.path}`)
    if (!entry.rollback?.trim()) errors.push(`rollback ausente: ${entry.path}`)
  }
  const f7a = manifest.migrations.find((entry) => entry.path === F7A)
  if (!f7a?.requires.includes(SOURCE)) errors.push("F7a deve declarar a fundação source em requires")
  const f2a = manifest.migrations.find((entry) => entry.path === F2A)
  if (!f2a?.requires.includes(SOURCE) || !f2a?.requires.includes(F7A)) {
    errors.push("F2a deve declarar F7-source e F7a em requires")
  }

  for (const value of stringsOf(manifest)) {
    if (/\b(?:supabase\s+)?db\s+push\b/i.test(value)) errors.push("db push amplo é proibido")
  }
  return errors
}

function sha256(path: string): string {
  const canonical = readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n")
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

describe("manifesto exato das migrations de billing", () => {
  it("existe, é válido e contém somente a allow-list pendente", () => {
    const manifest = loadManifest()

    expect(validate(manifest)).toEqual([])
    expect(manifest.migrations.map((entry) => entry.path)).toHaveLength(REQUIRED.length)
  })

  it("todos os arquivos exigidos existem e o sha256 fixa o SQL revisado", () => {
    const manifest = loadManifest()

    for (const entry of manifest.migrations) {
      expect(existsSync(resolve(process.cwd(), entry.path)), entry.path).toBe(true)
      expect(entry.sha256, `sha256 inválido: ${entry.path}`).toMatch(/^[a-f0-9]{64}$/)
      expect(entry.sha256, `SQL mudou depois da revisão: ${entry.path}`).toBe(sha256(entry.path))
    }
  })

  it("a ordem operacional é source, F7a e somente então F2a", () => {
    const manifest = loadManifest()
    const paths = manifest.migrations.map((entry) => entry.path)
    const f7a = manifest.migrations.find((entry) => entry.path === F7A)
    const f2a = manifest.migrations.find((entry) => entry.path === F2A)

    expect(paths).toEqual([...REQUIRED])
    expect(f7a?.requires).toContain(SOURCE)
    expect(f2a?.requires).toEqual(expect.arrayContaining([SOURCE, F7A]))
  })

  it("usa versões canônicas crescentes e mantém a migration multifase fora da allow-list", () => {
    const manifest = loadManifest()
    const versions = manifest.migrations.map((entry) =>
      /^supabase\/migrations\/(\d{14})_/.exec(entry.path)?.[1])
    const excluded = (manifest.targetBaseline as { mustRemainExcluded: string[] }).mustRemainExcluded

    expect(versions).toEqual(["20260821000100", "20260821000200", "20260821000300"])
    expect(excluded).toContain("supabase/migrations/20260803_entitlements_restructure.sql")
    expect(manifest.migrations.map((entry) => entry.path)).not.toContain(
      "supabase/migrations/20260803_entitlements_restructure.sql",
    )
  })
})

describe("o validador recusa mecanismos amplos ou ordem insegura", () => {
  const validFixture = (): BillingManifest => ({
    cleanInstall: "unsupported-overlay-only",
    hashCanonicalization: "utf8-lf",
    status: "local-no-go",
    strategy: "exact-files-only",
    targetBaseline: {
      snapshot: "read-only",
      mustRemainExcluded: ["supabase/migrations/20260803_entitlements_restructure.sql"],
    },
    migrations: [
      { path: SOURCE, phase: "F7-source", sha256: "b".repeat(64), requires: [], precheck: "p", rollback: "r" },
      { path: F7A, phase: "F7a", sha256: "c".repeat(64), requires: [SOURCE], precheck: "p", rollback: "r" },
      { path: F2A, phase: "F2a", sha256: "a".repeat(64), requires: [SOURCE, F7A], precheck: "p", rollback: "r" },
    ],
  })

  it("recusa fundação depois da RPC, mesmo que ambas estejam listadas", () => {
    const fixture = validFixture()
    fixture.migrations = [fixture.migrations[1], fixture.migrations[0], fixture.migrations[2]]

    expect(validate(fixture)).toContain("fundação source deve vir antes da RPC F7a")
    expect(validate(fixture).some((error) => error.startsWith("dependência fora de ordem:"))).toBe(true)
  })

  it("recusa arquivo obrigatório ausente", () => {
    const fixture = validFixture()
    fixture.migrations = fixture.migrations.filter((entry) => entry.path !== SOURCE)

    expect(validate(fixture)).toContain(`migration obrigatória ausente: ${SOURCE}`)
  })

  it("recusa wildcard e db push amplo", () => {
    const wildcard = validFixture()
    wildcard.migrations[0].path = "supabase/migrations/*.sql"
    const dbPush = validFixture()
    dbPush.migrations[0].precheck = "supabase db push"

    expect(validate(wildcard)).toContain("wildcard proibido: supabase/migrations/*.sql")
    expect(validate(dbPush)).toContain("db push amplo é proibido")
  })
})
