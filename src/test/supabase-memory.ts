// Stateful fake: filters are evaluated at execution time, so competing CAS writes
// really lose. No credentials or network; shared by attendance regression tests.
type Row = Record<string, any>
export class MemoryDb {
  tables: Record<string, Row[]> = {}
  writes: { table: string; patch: Row; count: number }[] = []
  errors: Record<string, string> = {}
  beforeWrite?: (table: string, patch: Row) => void
  reset(tables: Record<string, Row[]>) {
    this.tables = structuredClone(tables); this.writes = []; this.errors = {}; this.beforeWrite = undefined
  }
  from = (table: string) => {
    let patch: Row | undefined, inserts: Row[] | undefined, conflict: string | undefined, one = false, limit = Infinity
    const filters: ((r: Row) => boolean)[] = []
    const db = this
    const q = {
      select: (_columns?: string) => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q },
      in: (k: string, values: unknown[]) => { filters.push(r => values.includes(r[k])); return q },
      lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return q },
      or: (_value: string) => q,
      order: (_column: string, _opts?: unknown) => q,
      limit: (n: number) => { limit = n; return q },
      update: (value: Row) => { patch = value; return q },
      insert: (value: Row | Row[]) => { inserts = Array.isArray(value) ? value : [value]; return q },
      upsert: (value: Row, options: { onConflict: string }) => { inserts = [value]; conflict = options.onConflict; return q },
      single: () => { one = true; return q },
      maybeSingle: () => { one = true; return q },
      then: (resolve: (value: any) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        if (db.errors[table]) return { data: null, error: { message: db.errors[table] } }
        const rows = db.tables[table] ??= []
        if (patch) db.beforeWrite?.(table, patch)
        let matched = rows.filter(r => filters.every(f => f(r))).slice(0, limit)
        if (inserts) {
          matched = inserts.map((r) => {
            const existing = conflict ? rows.find(row => row[conflict!] === r[conflict!]) : undefined
            if (existing) return Object.assign(existing, structuredClone(r))
            const created = { id: `msg-${rows.length}`, ...structuredClone(r) }; rows.push(created); return created
          })
        }
        if (patch) {
          matched.forEach(r => Object.assign(r, structuredClone(patch)))
          db.writes.push({ table, patch: structuredClone(patch), count: matched.length })
        }
        return { data: structuredClone(one ? matched[0] ?? null : matched), error: null }
      }).then(resolve, reject),
    }
    return q
  }
  storage = { from: () => ({
    upload: async () => ({ error: null }), remove: async () => ({ error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://test.invalid/file" }, error: null }),
  }) }
}
