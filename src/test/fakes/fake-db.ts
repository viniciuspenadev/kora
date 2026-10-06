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
  op:     "select" | "update" | "insert" | "rpc"
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

  /**
   * Zera as falhas programadas que sobraram.
   *
   * 🔴 Sem isto, `falharEm({ vezes: N })` cujo N não é totalmente consumido **vaza pros
   *    testes seguintes** — e o sintoma é o pior possível: o teste passa sozinho e falha
   *    na suíte, apontando pro módulo errado. Chame no `beforeEach` junto com o seed.
   */
  limparFalhas(): this {
    this.falhas = []
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

  /**
   * RPC financeira atômica exigida pela F2. A semântica relevante fica no fake para que os
   * testes continuem sem rede, mas falhem alto se produção chamar uma porta não modelada.
   */
  async rpc(nome: string, args: Record<string, unknown> = {}): Promise<Resultado> {
    const falha = this.consumirFalha(nome, "rpc")
    this.log.push({ tabela: nome, op: "rpc", patch: { ...args } })
    if (falha) return { data: null, error: { message: falha } }

    if (nome === "registrar_e_aplicar_fato_gateway") {
      // Contrato futuro exigido pelo gate de segurança: registrar + aplicar são UMA
      // transação. O fake restaura o snapshot se a etapa interna de projeção falhar.
      const fatosAntes = this.linhas("invoice_payments").map((row) => ({ ...row }))
      const faturasAntes = this.linhas("invoices").map((row) => ({ ...row }))
      const eventosAntes = this.linhas("asaas_webhook_events").map((row) => ({ ...row }))
      const registrado = this.registrarFatoFinanceiro(args)
      if (registrado.error) {
        this.tabelas.set("invoice_payments", fatosAntes)
        this.tabelas.set("invoices", faturasAntes)
        this.tabelas.set("asaas_webhook_events", eventosAntes)
        return registrado
      }

      const retorno = Array.isArray(registrado.data)
        ? registrado.data[0] as Record<string, unknown> | undefined
        : undefined
      const chave = String(retorno?.chave ?? "")
      const fato = this.linhas("invoice_payments")
        .find((row) => row.provider === "asaas" && row.event_key === chave)
      if (!fato) {
        this.tabelas.set("invoice_payments", fatosAntes)
        this.tabelas.set("invoices", faturasAntes)
        this.tabelas.set("asaas_webhook_events", eventosAntes)
        return { data: null, error: { message: "fato aplicado não foi reencontrado" } }
      }

      const alvoSolicitado = this.linhas("invoices").find((row) => row.id === args.p_invoice)
      const identidadeDivergente = alvoSolicitado != null && (
        (alvoSolicitado.gateway_charge_id != null && alvoSolicitado.gateway_charge_id !== args.p_payment_id)
        || (alvoSolicitado.gateway_ref != null && alvoSolicitado.gateway_ref !== args.p_payment_id)
      )
      const referenciaCanonica = alvoSolicitado != null
        && args.p_external_reference === `kora:inv:${String(alvoSolicitado.id)}`
      if (identidadeDivergente && !referenciaCanonica) {
        this.tabelas.set("invoice_payments", fatosAntes)
        this.tabelas.set("invoices", faturasAntes)
        this.tabelas.set("asaas_webhook_events", eventosAntes)
        return { data: null, error: { message: "identidade da fatura pertence a outra cobranca" } }
      }
      // A RPC real decide excesso antes do carimbo. Um fato suspenso não pode deixar uma
      // identidade órfã na invoice que ele deliberadamente não aplicou.
      if (alvoSolicitado && fato.invoice_id === alvoSolicitado.id && !identidadeDivergente) {
        alvoSolicitado.gateway_charge_id = args.p_payment_id
        alvoSolicitado.gateway_ref = args.p_payment_id
      }

      const falhaProjecao = this.consumirFalha("registrar_e_aplicar_fato_gateway:projection", "rpc")
      if (falhaProjecao) {
        this.tabelas.set("invoice_payments", fatosAntes)
        this.tabelas.set("invoices", faturasAntes)
        this.tabelas.set("asaas_webhook_events", eventosAntes)
        return { data: null, error: { message: falhaProjecao } }
      }

      const projetado = this.recalcularPagamento({ p_invoice: fato.invoice_id ?? null })
      if (projetado.error) {
        this.tabelas.set("invoice_payments", fatosAntes)
        this.tabelas.set("invoices", faturasAntes)
        this.tabelas.set("asaas_webhook_events", eventosAntes)
        return projetado
      }
      const fatura = fato?.invoice_id == null
        ? null
        : this.linhas("invoices").find((row) => row.id === fato.invoice_id) ?? null
      const metodo = typeof fato.method === "string" ? fato.method.trim().toLowerCase() : ""
      if (fato?.invoice_id != null && metodo !== "") {
        if (fatura == null || fatura.id !== fato.invoice_id || fatura.tenant_id !== args.p_tenant) {
          this.tabelas.set("invoice_payments", fatosAntes)
          this.tabelas.set("invoices", faturasAntes)
          this.tabelas.set("asaas_webhook_events", eventosAntes)
          return { data: null, error: { message: "alvo do paid_method não foi comprovado" } }
        }
        fatura.paid_method = metodo

        // Falha depois da projeção e da mutação do método: restaura as três superfícies,
        // provando no dublê o rollback que uma única transação PostgreSQL oferece.
        const falhaPaidMethod = this.consumirFalha("registrar_e_aplicar_fato_gateway:paid_method", "rpc")
        if (falhaPaidMethod) {
          this.tabelas.set("invoice_payments", fatosAntes)
          this.tabelas.set("invoices", faturasAntes)
          this.tabelas.set("asaas_webhook_events", eventosAntes)
          return { data: null, error: { message: falhaPaidMethod } }
        }
      }
      const total = fatura == null ? null : Number(fatura.total_cents ?? 0)
      const pago = fatura == null ? null : Number(fatura.paid_cents ?? 0)
      return {
        data: [{
          id_lancamento: fato?.id ?? null,
          chave,
          inserido: retorno?.inserido === true,
          aplicado: fato?.invoice_id != null,
          invoice_id: fato?.invoice_id ?? null,
          paid_cents: pago,
          total_cents: total,
          invoice_status: fatura?.status ?? null,
          quitou: total != null && pago != null ? total > 0 && pago >= total : false,
          suspenso: fato?.invoice_id == null,
        }],
        error: null,
      }
    }

    if (nome === "aplicar_plano_atomico") {
      const tenant = this.linhas("tenants").find((row) => row.id === args.p_tenant)
      if (!tenant) return { data: [{ aplicado: false, motivo: "tenant não encontrado" }], error: null }

      const mudou =
        (args.p_expected_billing_mode != null && tenant.billing_mode !== args.p_expected_billing_mode)
        || (args.p_check_subscription === true && (tenant.asaas_subscription_id ?? null) !== (args.p_expected_subscription ?? null))
        || (args.p_check_status === true && (tenant.subscription_status ?? null) !== (args.p_expected_status ?? null))
        || (args.p_check_lifecycle === true && (tenant.lifecycle_state ?? null) !== (args.p_expected_lifecycle ?? null))
        || (args.p_require_current_plan === true && tenant.plan_id !== args.p_plan)
      if (mudou) {
        return { data: [{ aplicado: false, motivo: "estado do tenant mudou" }], error: null }
      }

      // Os testes atuais exercitam o ramo de conflito. Se o contrato passar a precisar da
      // projeção completa, o fake deve falhar alto em vez de fingir entitlements aplicados.
      return { data: [{ aplicado: true, motivo: null }], error: null }
    }

    throw new Error(`RPC não suportada no fake: ${nome}`)
  }

  private registrarFatoFinanceiro(args: Record<string, unknown>): Resultado {
    const tenantId = args.p_tenant
    const kind = args.p_kind
    const provider = "asaas"
    const paymentId = args.p_payment_id ?? null
    let invoiceId = args.p_invoice ?? null
    const valor = args.p_valor
    const ocorrido = args.p_occurred_at
    const source = args.p_source
    const sourceEventId = args.p_source_event_id ?? null
    const dados: Row = {
      method: args.p_method ?? null,
      gateway_due_date: args.p_gateway_due_date ?? null,
      subscription_id: args.p_subscription_id ?? null,
      provider_ref: args.p_provider_ref ?? null,
      external_reference: args.p_external_reference ?? null,
      source,
      source_event_id: sourceEventId,
    }

    if (typeof tenantId !== "string" || !tenantId) return erroRpc("tenant é obrigatório")
    const tenant = this.linhas("tenants").find((row) => row.id === tenantId)
    if (!tenant) return erroRpc("tenant desconhecido")
    if (tenant.billing_mode !== "gateway") return erroRpc("tenant não usa billing gateway")
    if (!["pagamento", "estorno", "chargeback", "ajuste"].includes(String(kind))) {
      return erroRpc(`kind inválido: ${String(kind)}`)
    }
    if (!["webhook", "reconcile"].includes(String(source))) {
      return erroRpc("source deve ser webhook ou reconcile")
    }
    if (typeof ocorrido !== "string" || !ocorrido) return erroRpc("occurred_at é obrigatório")

    if (typeof sourceEventId !== "string" || !sourceEventId) {
      return erroRpc("webhook/reconcile exige source_event_id")
    }
    const idDeReconcile = sourceEventId.startsWith("reconcile_")
    if ((source === "reconcile") !== idDeReconcile) {
      return erroRpc("source e prefixo do evento divergem")
    }
    const evento = this.linhas("asaas_webhook_events").find((row) => row.id === sourceEventId)
    if (!evento) return erroRpc("source_event_id não existe")
    if (evento.tenant_id != null && evento.tenant_id !== tenantId) return erroRpc("evento pertence a outro tenant")
    if (evento.payment_id !== paymentId) return erroRpc("evento e payment_id divergem")
    const permitidos: Record<string, string[]> = {
      pagamento: ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"],
      estorno: ["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"],
      chargeback: ["PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"],
    }
    if (!(permitidos[String(kind)] ?? []).includes(String(evento.event_type))) {
      return erroRpc(`event_type ${String(evento.event_type)} não autoriza kind ${String(kind)}`)
    }
    if (evento.tenant_id == null) evento.tenant_id = tenantId

    const fatos = this.linhas("invoice_payments")
    if (typeof paymentId === "string") {
      const outroDono = fatos.find((f) => f.payment_id === paymentId && f.tenant_id !== tenantId)
      if (outroDono) return erroRpc(`payment_id ${paymentId} já pertence a outro tenant`)
    }

    if (kind !== "pagamento") {
      // Estorno/chargeback são adicionados quando o contrato correspondente estiver fechado.
      // O fake recusa por enquanto, para um teste não passar simulando semântica inventada.
      return erroRpc(`kind ${String(kind)} ainda não modelado no fake`)
    }
    if (typeof paymentId !== "string" || !paymentId) {
      return erroRpc("pagamento de gateway sem payment_id")
    }
    if (typeof valor !== "number" || !Number.isInteger(valor) || valor <= 0) {
      return erroRpc("pagamento exige valor inteiro positivo")
    }

    const chave = `pagamento:${String(paymentId)}`
    const existente = fatos.find((f) => f.provider === provider && f.event_key === chave)
    if (existente) {
      if (existente.amount_cents !== valor) return erroRpc("replay diverge do valor original")
      if (invoiceId !== null && existente.invoice_id !== invoiceId) {
        return erroRpc("replay aponta para fatura diferente do fato original")
      }
      const metodoExistente = typeof existente.method === "string" ? existente.method.trim().toLowerCase() : ""
      const metodoRecebido = typeof dados.method === "string" ? dados.method.trim().toLowerCase() : ""
      if (metodoExistente !== "" && metodoRecebido !== "" && metodoExistente !== metodoRecebido) {
        return erroRpc("replay diverge do método imutável do pagamento")
      }
      return { data: [{ id_lancamento: existente.id, chave, inserido: false }], error: null }
    }

    if (invoiceId !== null) {
      const fatura = this.linhas("invoices").find((i) => i.id === invoiceId)
      if (!fatura) return erroRpc(`fatura ${String(invoiceId)} não existe`)
      if (fatura.tenant_id !== tenantId) return erroRpc("fatura pertence a outro tenant")
      if (["void", "draft"].includes(String(fatura.status))) return erroRpc("dinheiro não pousa em fatura inativa")
    }

    // O fato integral nunca é capado. Se ultrapassaria o total, fica suspenso para
    // conciliação humana e a projeção da fatura permanece intocada.
    if (invoiceId !== null) {
      const fatura = this.linhas("invoices").find((row) => row.id === invoiceId)!
      const recebido = fatos
        .filter((row) => row.invoice_id === invoiceId)
        .reduce((total, row) => total + Number(row.amount_cents ?? 0), 0)
      if (recebido + valor > Number(fatura.total_cents ?? 0)) invoiceId = null
    }

    const id = `fake_invoice_payments_${fatos.length + 1}`
    fatos.push({
      id,
      tenant_id: tenantId,
      invoice_id: invoiceId,
      provider,
      event_key: chave,
      payment_id: paymentId,
      kind,
      amount_cents: valor,
      occurred_at: ocorrido,
      method: dados.method ?? null,
      card_brand: dados.card_brand ?? null,
      card_last4: dados.card_last4 ?? null,
      receipt_url: dados.receipt_url ?? null,
      external_reference: dados.external_reference ?? null,
      gateway_due_date: dados.gateway_due_date ?? null,
      subscription_id: dados.subscription_id ?? null,
      provider_ref: dados.provider_ref ?? null,
      source,
      source_event_id: sourceEventId,
      note: dados.note ?? null,
      created_by: dados.created_by ?? null,
      reverses_id: dados.reverses_id ?? null,
    })
    this.tabelas.set("invoice_payments", fatos)
    return { data: [{ id_lancamento: id, chave, inserido: true }], error: null }
  }

  private recalcularPagamento(args: Record<string, unknown>): Resultado {
    const invoiceId = args.p_invoice
    const fatura = this.linhas("invoices").find((i) => i.id === invoiceId)
    if (!fatura || ["void", "draft"].includes(String(fatura.status))) return { data: null, error: null }

    const soma = this.linhas("invoice_payments")
      .filter((p) => p.invoice_id === invoiceId)
      .reduce((total, p) => total + Number(p.amount_cents ?? 0), 0)
    const devido = Number(fatura.total_cents ?? 0)
    const statusAnterior = String(fatura.status ?? "open")
    fatura.paid_cents = Math.max(soma, 0)
    fatura.status = soma >= devido && devido > 0
      ? "paid"
      : soma > 0
        ? "partial"
        : ["paid", "partial"].includes(statusAnterior) ? "open" : statusAnterior
    fatura.paid_at = soma >= devido && devido > 0
      ? (fatura.paid_at ?? "2026-08-14T00:00:00.000Z")
      : null
    return { data: null, error: null }
  }
}

type Filtro = (r: Row) => boolean
/**
 * ⚠️ `data` é `Row[] | Row | null`, não `unknown`. Com `unknown`, o `?.[0]` de um teste
 *    estreita para `{}` e indexar `{}` vira erro de tipo (TS7053) — o que deixava
 *    `npx tsc --noEmit` vermelho e, como o CI roda o typecheck ANTES dos testes, a
 *    suíte verde nunca chegava a rodar no pipeline.
 *    Espelha o retorno real: array no select/update-com-select, objeto no `maybeSingle`,
 *    `null` em update sem `.select()` e no delete.
 */
type Resultado = { data: Row[] | Row | null; error: { message: string } | null }

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

  eq(col: string, val: unknown)    { this.filtros.push((r) => valorDaColuna(r, col) === val); return this }
  neq(col: string, val: unknown)   { this.filtros.push((r) => valorDaColuna(r, col) !== val); return this }
  in(col: string, vals: unknown[]) { this.filtros.push((r) => vals.includes(valorDaColuna(r, col))); return this }
  lt(col: string, val: string)     { this.filtros.push((r) => String(r[col] ?? "") < val); return this }
  gt(col: string, val: string)     { this.filtros.push((r) => String(r[col] ?? "") > val); return this }
  // Inclusivos. Comparação por string igual aos irmãos acima: serve pra ISO-8601,
  // que é o único uso (datas). Linha SEM o campo não casa — em SQL, NULL nunca
  // satisfaz <=/>=, e o dublê tem que errar do mesmo lado que o banco.
  lte(col: string, val: string)    { this.filtros.push((r) => r[col] != null && String(r[col]) <= val); return this }
  gte(col: string, val: string)    { this.filtros.push((r) => r[col] != null && String(r[col]) >= val); return this }
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

    // Espelha a trava append-only do schema: correção financeira é uma nova linha negativa,
    // nunca UPDATE/DELETE do fato original. O vínculo tardio permitido acontece pela RPC.
    if (this.tabela === "invoice_payments" && (this.op === "update" || this.op === "delete")) {
      return { data: null, error: { message: "invoice_payments é append-only" } }
    }

    if (this.op === "insert") {
      const criadas: Row[] = []
      for (const nova of this.inserindo) {
        // Índice parcial `uq_audit_log_dedupe_key`: retries do mesmo efeito recebem 23505
        // e o helper de auditoria trata isso como sucesso idempotente.
        if (this.tabela === "audit_log" && nova.dedupe_key != null
          && todas.some((r) => r.dedupe_key === nova.dedupe_key)) {
          const e = { message: "duplicate key value violates unique constraint", code: "23505" }
          return { data: null, error: e as unknown as { message: string } }
        }
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
      if (!this.retornaRepresentacao) return { data: null, error: null }
      // 🔴 `unico` VALE AQUI TAMBÉM (achado 10/08). O dublê devolvia sempre um ARRAY, e o
      //    PostgREST devolve OBJETO com `.maybeSingle()`. A divergência é traiçoeira: um
      //    array **vazio** é truthy, então o padrão `if (!data) return` — que é a base do
      //    claim atômico (`UPDATE ... RETURNING`, 0 linhas = não é meu) — nunca dispararia
      //    no teste. O dublê aprovaria um código que, em produção, processa um evento que
      //    não reivindicou.
      return { data: this.unico ? (casadas[0] ?? null) : casadas, error: null }
    }

    this.log.push({ tabela: this.tabela, op: "select" })
    if (this.unico) return { data: casadas[0] ?? null, error: null }
    return { data: casadas, error: null }
  }
}

/**
 * Resolve o nome da coluna OU o caminho JSON `coluna->>chave` — o operador do PostgREST
 * usado, por exemplo, pra filtrar `metadata->>kind`. Sem isto o dublê procuraria uma
 * coluna chamada literalmente "metadata->>kind", não acharia, e o filtro devolveria
 * VAZIO — o teste passaria por engano achando que a contagem estava certa.
 * `->>` devolve TEXTO no Postgres; a conversão aqui espelha isso.
 */
function valorDaColuna(r: Row, col: string): unknown {
  const i = col.indexOf("->>")
  if (i < 0) return r[col]
  const base = r[col.slice(0, i)] as Record<string, unknown> | null | undefined
  const v = base?.[col.slice(i + 3)]
  return v == null ? undefined : String(v)
}

function erroRpc(message: string): Resultado {
  return { data: null, error: { message } }
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
