#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// GATE DE BUILD — erro descartado nos caminhos de dinheiro
// ═══════════════════════════════════════════════════════════════
//
// 🔴 O QUE ELE IMPEDE: `const { data } = await supabaseAdmin…` — o `error` cai no chão e
//    uma indisponibilidade do banco vira "não existe". Foi a causa-raiz de 17 defeitos
//    catalogados no pentest de 10/08 (C-03 inteiro nasce disso: um timeout de leitura
//    virava "não há assinatura" e o cancelamento devolvia sucesso sem cancelar nada).
//
// ⚠️ POR QUE UM SCRIPT E NÃO SÓ O ESLINT: o lint da CI roda **só nos arquivos do diff e só
//    em PR** (.github/workflows/ci.yml) — ele não protege o passivo nem o que sobe sem PR.
//    Este roda no `prebuild`, mesmo padrão de `check-server-actions.mjs`.
//
// 🔑 ESCOPO DELIBERADAMENTE ESTREITO: só os arquivos onde uma leitura errada vira decisão
//    ERRADA DE DINHEIRO. Ampliar sem necessidade produziria ruído, e gate ruidoso é gate
//    que alguém desliga.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RAIZ = process.cwd()

/** Arquivos e diretórios sob vigilância. */
const ALVOS = [
  "src/lib/asaas",
  "src/lib/billing",
  "src/lib/billing.ts",
  "src/lib/trial-housekeeping.ts",
  "src/lib/actions/admin-billing.ts",
]

/** Não vigiar: testes (dublês fingem falha de propósito) e o portão. */
const IGNORAR = /\.(test|spec|gate\.test)\.ts$/

function arquivos(alvo) {
  const full = join(RAIZ, alvo)
  let st
  try { st = statSync(full) } catch { return [] }
  if (st.isFile()) return IGNORAR.test(full) ? [] : [full]
  return readdirSync(full).flatMap((f) => arquivos(join(alvo, f)))
}

// `const { … } = await …` cujo padrão desestruturado NÃO contém `error`.
// Casa em uma linha ou em várias (o `await` costuma quebrar linha nesta base).
const DESESTRUTURA_AWAIT = /const\s*\{([^}]*)\}\s*=\s*await\b/gs

const achados = []

for (const alvo of ALVOS) {
  for (const arq of arquivos(alvo)) {
    const src = readFileSync(arq, "utf8")
    const linhas = src.split("\n")

    for (const m of src.matchAll(DESESTRUTURA_AWAIT)) {
      const dentro = m[1]
      if (/\berror\b/.test(dentro)) continue
      // `await` de coisa que não é query (Promise.all, import, fetch…) não interessa:
      // só acusa quando a mesma sentença fala com o banco.
      const trecho = src.slice(m.index, m.index + 400)
      if (!/supabaseAdmin|\.from\(|\.rpc\(/.test(trecho)) continue
      const linha = src.slice(0, m.index).split("\n").length
      achados.push({
        arquivo: relative(RAIZ, arq).replace(/\\/g, "/"),
        linha,
        trecho: (linhas[linha - 1] ?? "").trim().slice(0, 90),
      })
    }
  }
}

// ── CATRACA ────────────────────────────────────────────────────────────────
//
// 🔑 POR QUE CATRACA E NÃO GATE SECO: em 11/08 (fase F1) foram corrigidas as **17
//    ocorrências Classe A** — aquelas em que a falha de leitura vira decisão ERRADA DE
//    DINHEIRO (creditar duas vezes, quitar fatura com valor menor, cortar acesso de quem
//    pagou, cancelar sem cancelar). As que sobram são **Classe B**: o sistema recusa
//    (fail-closed) com uma mensagem que mente, ou faz nada em silêncio. São dívida real,
//    mas não movem dinheiro errado — e reprovar o build por elas hoje só faria alguém
//    desligar o gate.
//
// ⚠️ A CONTAGEM É POR ARQUIVO, não por linha: número de linha envelhece a cada edição e a
//    lista viraria mentira. Aqui, refatorar não quebra o gate — só ACRESCENTAR quebra.
//
// 📉 A catraca só gira para baixo: ao corrigir uma, ABAIXE o número. O gate passa a
//    proteger o que você acabou de consertar. Zerou o arquivo? Tire a linha daqui.
const PASSIVO_CONHECIDO = {
  "src/lib/asaas/customers.ts":          2,
  "src/lib/asaas/reconcile.ts":          1,
  "src/lib/asaas/subscriptions.ts":      3,
  "src/lib/trial-housekeeping.ts":       3,
  "src/lib/actions/admin-billing.ts":    1,
}

const porArquivo = {}
for (const a of achados) porArquivo[a.arquivo] = (porArquivo[a.arquivo] ?? 0) + 1

const novos = []
for (const [arq, qtd] of Object.entries(porArquivo)) {
  const teto = PASSIVO_CONHECIDO[arq] ?? 0
  if (qtd > teto) novos.push({ arq, qtd, teto })
}

const folgas = []
for (const [arq, teto] of Object.entries(PASSIVO_CONHECIDO)) {
  const qtd = porArquivo[arq] ?? 0
  if (qtd < teto) folgas.push({ arq, qtd, teto })
}

if (novos.length > 0) {
  console.error("\n🔴 CAMINHO DE DINHEIRO COM `error` DESCARTADO — ocorrência NOVA\n")
  console.error("   Falha de consulta NÃO é ausência de dado. Capture `error` e decida com ele:")
  console.error("   sem certeza, o código para — nunca segue como se o dado não existisse.\n")
  for (const { arq, qtd, teto } of novos) {
    console.error(`   ${arq} — ${qtd} ocorrência(s), passivo congelado em ${teto}`)
    for (const a of achados.filter((x) => x.arquivo === arq)) {
      console.error(`      :${a.linha}  ${a.trecho}`)
    }
  }
  console.error("")
  process.exit(1)
}

if (folgas.length > 0) {
  console.error("\n📉 CATRACA DESATUALIZADA — dívida foi paga e o teto não desceu.\n")
  for (const { arq, qtd, teto } of folgas) {
    console.error(`   ${arq}: ${qtd} agora (teto ${teto}) — abaixe para ${qtd} em scripts/check-money-io.mjs`)
  }
  console.error("\n   Teto que não desce deixa a porta aberta para a dívida voltar.\n")
  process.exit(1)
}

const total = achados.length
console.log(total === 0
  ? "✅ Caminhos de dinheiro OK — nenhuma consulta com `error` descartado."
  : `✅ Caminhos de dinheiro OK — 0 ocorrências novas (${total} de dívida Classe B congelada).`)
process.exit(0)
