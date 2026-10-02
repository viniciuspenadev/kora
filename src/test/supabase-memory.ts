// Stateful fake: filters are evaluated at execution time, so competing CAS writes
// really lose. No credentials or network; shared by attendance regression tests.
/* eslint-disable @typescript-eslint/no-explicit-any -- test fake: rows have no schema, tests read fields freely */
type Row = Record<string, any>
// `coluna->>chave` e `coluna->objeto->>chave` (campo de JSON, como o PostgREST aceita em filtro).
const val = (r: Row, k: string) => {
  const cut = k.lastIndexOf("->>")
  const [path, last] = cut < 0 ? [k, undefined] : [k.slice(0, cut), k.slice(cut + 3)]
  const [col, ...inner] = path.split("->")
  let v = r[col]
  for (const key of inner) v = v?.[key]
  return last === undefined ? v : v?.[last]
}
export class MemoryDb {
  tables: Record<string, Row[]> = {}
  writes: { table: string; patch: Row; count: number }[] = []
  errors: Record<string, string> = {}
  /** Código PostgREST/Postgres do erro da tabela (ex.: "42P01" = tabela não existe). */
  errorCodes: Record<string, string> = {}
  beforeWrite?: (table: string, patch: Row) => void
  /** Recusa de ESCRITA (gatilho/CHECK do banco): devolve a mensagem de erro, ou nada para gravar.
   *  Recebe as linhas que seriam afetadas, já com o patch (update) ou como vão entrar (insert). */
  writeError?: (table: string, rows: Row[], op: "insert" | "update") => string | null | undefined
  reset(tables: Record<string, Row[]>) {
    this.tables = structuredClone(tables); this.writes = []; this.deletes = []; this.errors = {}; this.beforeWrite = undefined; this.writeError = undefined; this.rpcs = {}; this.errorCodes = {}
  }
  deletes: { table: string; count: number }[] = []
  /** RPC: cada teste registra o que a função do banco responde (sem handler = erro, como
   *  uma função que não existe — PGRST202). */
  rpcs: Record<string, (args: Row) => { data: any; error: any }> = {}
  rpc = (name: string, args: Row) => Promise.resolve().then(() =>
    this.rpcs[name] ? this.rpcs[name](structuredClone(args))
      : { data: null, error: { code: "PGRST202", message: `função ${name} não existe` } })
  from = (table: string) => {
    let patch: Row | undefined, inserts: Row[] | undefined, conflict: string | undefined, one = false, limit = Infinity
    let removing = false, rangeFrom = 0
    const filters: ((r: Row) => boolean)[] = []
    const q = {
      select: (_columns?: string) => q,
      eq: (k: string, v: unknown) => { filters.push(r => typeof r[k] === "object" && r[k] !== null && typeof v === "string"
        ? JSON.stringify(r[k]) === JSON.stringify(Array.isArray(r[k]) && v.startsWith("{") && v.endsWith("}")
          ? v.slice(1, -1).split(",").filter(Boolean) : JSON.parse(v)) : val(r, k) === v); return q },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q },
      in: (k: string, values: unknown[]) => { filters.push(r => values.includes(val(r, k))); return q },
      lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return q },
      gte: (k: string, v: any) => { filters.push(r => r[k] >= v); return q },
      gt: (k: string, v: any) => { filters.push(r => r[k] > v); return q },
      or: (_value: string) => q,
      // Só `not(col, "is", null)` — é o único uso nos caminhos testados.
      not: (k: string, op: string, v: unknown) => { if (op === "is") filters.push(r => (val(r, k) ?? null) !== v); return q },
      order: (_column: string, _opts?: unknown) => q,
      limit: (n: number) => { limit = n; return q },
      range: (from: number, to: number) => { rangeFrom = from; limit = to - from + 1; return q },
      delete: () => { removing = true; return q },
      update: (value: Row) => { patch = value; return q },
      insert: (value: Row | Row[]) => { inserts = Array.isArray(value) ? value : [value]; return q },
      upsert: (value: Row, options: { onConflict: string }) => { inserts = [value]; conflict = options.onConflict; return q },
      single: () => { one = true; return q },
      maybeSingle: () => { one = true; return q },
      then: (resolve: (value: any) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        if (this.errors[table]) return { data: null, error: { message: this.errors[table], code: this.errorCodes[table] } }
        const rows = this.tables[table] ??= []
        if (patch) this.beforeWrite?.(table, patch)
        let matched = rows.filter(r => filters.every(f => f(r))).slice(rangeFrom, rangeFrom + limit)
        if (removing) {
          this.tables[table] = rows.filter(r => !matched.includes(r))
          this.deletes.push({ table, count: matched.length })
          return { data: structuredClone(matched), error: null, count: matched.length }
        }
        const refusal = this.writeError && (inserts ? this.writeError(table, structuredClone(inserts), "insert")
          : patch ? this.writeError(table, matched.map(r => ({ ...structuredClone(r), ...structuredClone(patch) })), "update") : null)
        if (refusal) return { data: null, error: { message: refusal } }
        if (inserts) {
          matched = inserts.map((r) => {
            const existing = conflict ? rows.find(row => row[conflict!] === r[conflict!]) : undefined
            if (existing) return Object.assign(existing, structuredClone(r))
            const created = { id: `msg-${rows.length}`, ...structuredClone(r) }; rows.push(created); return created
          })
        }
        if (patch) {
          matched.forEach(r => Object.assign(r, structuredClone(patch)))
          this.writes.push({ table, patch: structuredClone(patch), count: matched.length })
        }
        // `count` como o PostgREST devolve em `select(..., { count: "exact", head: true })`.
        return { data: structuredClone(one ? matched[0] ?? null : matched), error: null, count: matched.length }
      }).then(resolve, reject),
    }
    return q
  }
  storage = { from: () => ({
    upload: async () => ({ error: null }), remove: async () => ({ error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://test.invalid/file" }, error: null }),
  }) }
}
