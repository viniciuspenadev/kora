// ═══════════════════════════════════════════════════════════════
// Banco de mentira — o suficiente do PostgREST pra dirigir a cobrança
// ═══════════════════════════════════════════════════════════════
//
// 🔒 EXISTE PRA QUE NENHUM TESTE TOQUE PRODUÇÃO. Com ele no lugar do `supabaseAdmin`
//    (via `vi.mock`), o módulo real nunca carrega — não há URL, não há service key, não há
//    rede. Metade dos cenários de cobrança é "e quando o banco falha?"; apontar isso pro
//    banco de verdade seria o oposto do que se quer.
//
// 🔑 POR QUE UM DUBLÊ E NÃO O BANCO REAL: os bugs que estes testes trancam só aparecem
//    quando algo dá errado NO MEIO — o banco oscila entre criar a assinatura e gravar o
//    vínculo, o `applyPlan` falha depois do pagamento. Não dá pra pedir ao Postgres de
//    produção que falhe numa consulta específica. Aqui dá: `falharEm({...})`.
//
// ⚠️ Só implementa o que a cadeia de cobrança usa. Não é um clone do PostgREST. Faltou
//    operador? O teste quebra alto e a gente acrescenta — melhor que um dublê que finge
//    suportar tudo e mente em silêncio.
//
// ⚠️ Fica FORA de `src/lib/asaas/` de propósito: código de teste no meio da pasta de
//    domínio confunde quem abre o diretório procurando o que roda em produção.

type Row = Record<string, unknown>

/** Falha programada: qual tabela/operação deve devolver erro, e quantas vezes. */
export interface FalhaProgramada {
  tabela: string
  op:     "select" | "update" | "insert"
  /** Quantas chamadas falham antes de voltar ao normal. */
  vezes:  number
  msg?:   string
}

export class FakeDb {
  readonly tabelas = new Map<string, Row[]>()
  private falhas: FalhaProgramada[] = []
  /** Toda operação executada, na ordem — é o que permite afirmar "não escreveu". */
  readonly log: Array<{ tabela: string; op: string; patch?: Row }> = []

  seed(tabela: string, linhas: Row[]): this {
    this.tabelas.set(tabela, linhas.map((l) => ({ ...l })))
    return this
  }

  linhas(tabela: string): Row[] {
    return this.tabelas.get(tabela) ?? []
  }

  /** Programa uma falha — é como se testa "banco caiu no meio". */
  falharEm(f: FalhaProgramada): this {
    this.falhas.push({ ...f })
    return this
  }

  private consumirFalha(tabela: string, op: string): string | null {
    const f = this.falhas.find((x) => x.tabela === tabela && x.op === op && x.vezes > 0)
    if (!f) return null
    f.vezes -= 1
    return f.msg ?? `falha simulada em ${op} ${tabela}`
  }

  from(tabela: string) {
    return new FakeQuery(this, tabela, this.consumirFalha.bind(this), this.log)
  }
}

type Filtro = (r: Row) => boolean
type Resultado = { data: unknown; error: { message: string } | null }

class FakeQuery implements PromiseLike<Resultado> {
  private filtros: Filtro[] = []
  private op: "select" | "update" | "insert" | "delete" = "select"
  private patch: Row | null = null
  private inserindo: Row[] = []
  private limite: number | null = null
  private ordem: { col: string; asc: boolean } | null = null
  private retornaRepresentacao = false
  // ⚠️ NÃO renomear de volta pra `single`: a propriedade de instância SOMBREIA o método
  //    `single()` do protótipo, e a chamada morre com "single is not a function" — que
  //    parece bug do código sob teste e é do dublê. Custou uma investigação.
  private unico = false

  constructor(
    private db: FakeDb,
    private tabela: string,
    private consumirFalha: (t: string, op: string) => string | null,
    private log: Array<{ tabela: string; op: string; patch?: Row }>,
  ) {}

  select(_cols?: string) { if (this.op !== "select") this.retornaRepresentacao = true; return this }
  update(patch: Row)     { this.op = "update"; this.patch = patch; return this }
  insert(linhas: Row | Row[]) { this.op = "insert"; this.inserindo = Array.isArray(linhas) ? linhas : [linhas]; return this }
  delete()               { this.op = "delete"; return this }

  eq(col: string, val: unknown)    { this.filtros.push((r) => r[col] === val); return this }
  neq(col: string, val: unknown)   { this.filtros.push((r) => r[col] !== val); return this }
  in(col: string, vals: unknown[]) { this.filtros.push((r) => vals.includes(r[col])); return this }
  lt(col: string, val: string)     { this.filtros.push((r) => String(r[col] ?? "") < val); return this }
  gt(col: string, val: string)     { this.filtros.push((r) => String(r[col] ?? "") > val); return this }
  is(col: string, val: null)       { this.filtros.push((r) => (r[col] ?? null) === val); return this }
  not(col: string, _op: "is", val: null) { this.filtros.push((r) => (r[col] ?? null) !== val); return this }
  order(col: string, opts?: { ascending?: boolean }) { this.ordem = { col, asc: opts?.ascending !== false }; return this }
  limit(n: number) { this.limite = n; return this }
  maybeSingle()    { this.unico = true; return this }
  // ⚠️ Mesmo comportamento do `maybeSingle` no dublê, de propósito. O `.single()` real
  //    ERRA quando não vem exatamente 1 linha, mas o código sob teste sempre checa o
  //    `error` do retorno — então a diferença não muda nenhum caminho aqui, e simular a
  //    semântica estrita esconderia o cenário em vez de revelá-lo.
  //    Existe porque `insert().select().single()` (billing.ts) não tinha suporte no dublê.
  single()         { this.unico = true; return this }

  /**
   * `or("a.eq.1,b.eq.2,and(c.eq.3,d.lt.x)")` — só o suficiente pro `reconcile`.
   * ⚠️ Parser deliberadamente burro: formato diferente do esperado **lança**, em vez de
   *    casar tudo em silêncio — que é o pior desfecho possível num dublê.
   */
  or(expr: string) {
    const partes = dividirTopo(expr)
    this.filtros.push((r) => partes.some((p) => avaliar(p, r)))
    return this
  }

  then<R1 = Resultado, R2 = never>(
    ok?:  ((v: Resultado) => R1 | PromiseLike<R1>) | null,
    err?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.executar()).then(ok, err)
  }

  private executar(): Resultado {
    const falha = this.consumirFalha(this.tabela, this.op)
    if (falha) return { data: null, error: { message: falha } }

    const todas = this.db.tabelas.get(this.tabela) ?? []

    if (this.op === "insert") {
      const criadas: Row[] = []
      for (const nova of this.inserindo) {
        // PK duplicada = 23505, o caminho que o reconcile trata como normal.
        if (nova.id != null && todas.some((r) => r.id === nova.id)) {
          const e = { message: "duplicate key value violates unique constraint", code: "23505" }
          return { data: null, error: e as unknown as { message: string } }
        }
        // ⚠️ Id sintético quando o insert não traz um: no Postgres o default é
        //    `gen_random_uuid()`, e sem isso `insert().select().single()` devolveria uma
        //    linha sem `id` — o chamador crasharia num campo que em produção sempre existe.
        const linha = { ...nova, id: nova.id ?? `fake_${this.tabela}_${todas.length + 1}` }
        todas.push(linha)
        criadas.push(linha)
      }
      this.db.tabelas.set(this.tabela, todas)
      this.log.push({ tabela: this.tabela, op: "insert" })
      // `.select()` depois de `.insert()` = `returning` do PostgREST.
      if (!this.retornaRepresentacao) return { data: null, error: null }
      return { data: this.unico ? (criadas[0] ?? null) : criadas, error: null }
    }

    if (this.op === "delete") {
      const sobrando = todas.filter((r) => !this.filtros.every((f) => f(r)))
      const apagadas = todas.length - sobrando.length
      this.db.tabelas.set(this.tabela, sobrando)
      this.log.push({ tabela: this.tabela, op: "delete" })
      // 🔑 CASCATA. O dublê precisa dela porque `invoice_items` tem
      //    `on delete cascade` no schema real — sem simular, o teste da compensação do
      //    H-06 passaria deixando itens órfãos que em produção não existiriam.
      if (this.tabela === "invoices" && apagadas > 0) {
        const vivos = new Set(sobrando.map((r) => r.id))
        this.db.tabelas.set("invoice_items",
          (this.db.tabelas.get("invoice_items") ?? []).filter((i) => vivos.has(i.invoice_id)))
      }
      return { data: null, error: null }
    }

    let casadas = todas.filter((r) => this.filtros.every((f) => f(r)))

    if (this.ordem) {
      const { col, asc } = this.ordem
      casadas = [...casadas].sort((a, b) => {
        const x = String(a[col] ?? ""), y = String(b[col] ?? "")
        return asc ? x.localeCompare(y) : y.localeCompare(x)
      })
    }
    if (this.limite != null) casadas = casadas.slice(0, this.limite)

    if (this.op === "update") {
      for (const r of casadas) Object.assign(r, this.patch)
      this.log.push({ tabela: this.tabela, op: "update", patch: this.patch ?? undefined })
      return { data: this.retornaRepresentacao ? casadas : null, error: null }
    }

    this.log.push({ tabela: this.tabela, op: "select" })
    if (this.unico) return { data: casadas[0] ?? null, error: null }
    return { data: casadas, error: null }
  }
}

/** Divide por vírgulas de topo, respeitando `and(...)`/`or(...)` aninhados. */
function dividirTopo(expr: string): string[] {
  const out: string[] = []
  let nivel = 0, atual = ""
  for (const ch of expr) {
    if (ch === "(") nivel++
    if (ch === ")") nivel--
    if (ch === "," && nivel === 0) { out.push(atual); atual = ""; continue }
    atual += ch
  }
  if (atual) out.push(atual)
  return out
}

function avaliar(parte: string, r: Row): boolean {
  const p = parte.trim()
  if (p.startsWith("and(")) {
    return dividirTopo(p.slice(4, -1)).every((sub) => avaliar(sub, r))
  }
  const i = p.indexOf(".")
  const j = p.indexOf(".", i + 1)
  const col   = p.slice(0, i)
  const op    = p.slice(i + 1, j)
  const val   = p.slice(j + 1)
  const atual = r[col]
  if (op === "eq") return String(atual ?? "") === val
  if (op === "lt") return String(atual ?? "") < val
  if (op === "gt") return String(atual ?? "") > val
  if (op === "is") return (atual ?? null) === (val === "null" ? null : val)
  throw new Error(`operador não suportado no fake: ${op} (em "${parte}")`)
}
