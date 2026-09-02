#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Gate de vulnerabilidades de dependências (H-16, auditoria 2026-07-30)
// ═══════════════════════════════════════════════════════════════
// Eleva o gate de `critical` → `high`: falha o CI em QUALQUER advisory high/critical
// que NÃO esteja na allowlist. A allowlist aceita — de forma DOCUMENTADA, com data de
// revisão — os advisories transitivos que só somem quando o upstream (Next/ESLint) publicar
// patch (o "fix" do npm é `next@9`, um downgrade catastrófico).
//
// Diferença pro `npm audit --audit-level=high` cru: aquele falharia HOJE nos 4 residuais e
// obrigaria a manter o gate em `critical` (cego pra highs NOVOS). Este pega qualquer high
// NOVO (dep nova, CVE novo) e deixa o baseline conhecido explícito e auditável.
//
// Manutenção: nas datas `reviewBy`, rodar `npm audit` — se o upstream corrigiu, o script
// avisa "entrada obsoleta" e você remove daqui. Advisory novo → aparece como ofensor: ou
// corrige a dep, ou adiciona aqui com motivo + reviewBy (aceite consciente).

import { execSync } from "node:child_process"

/**
 * Advisories high/critical aceitos conscientemente. Chave = `source` (id numérico do npm).
 *
 * 🔑 VAZIA EM 2026-08-08, e isso é uma boa notícia: os 4 aceites que moravam aqui
 *    (brace-expansion/ESLint, postcss ×2 e sharp, todos transitivos do Next) foram
 *    resolvidos por `npm audit fix --package-lock-only` — só versões semver-compatíveis,
 *    sem tocar no `package.json`. O próprio script já os marcava como obsoletos.
 * ⚠️ Aceite novo entra com `reason` **e** `reviewBy`. A data agora é COBRADA (ver o fim do
 *    arquivo): vencida, o gate fecha. Aceitar risco com prazo é gestão; sem prazo é
 *    esquecer com estilo.
 */
const ALLOW = new Map([])

function readAudit() {
  // npm audit sai com código != 0 quando ACHA vulnerabilidades — o JSON vem no stdout mesmo assim.
  try {
    return execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20 * 1024 * 1024 })
  } catch (e) {
    if (e.stdout) return e.stdout
    console.error("check-audit: falha ao rodar `npm audit --json`:", e.message)
    process.exit(2)
  }
}

let audit
try {
  audit = JSON.parse(readAudit())
} catch {
  console.error("check-audit: não consegui parsear a saída de `npm audit --json`.")
  process.exit(2)
}

// Coleta advisories high/critical distintos (por `source`) em toda a árvore.
const found = new Map()
for (const v of Object.values(audit.vulnerabilities || {})) {
  for (const via of v.via || []) {
    if (via && typeof via === "object" && via.source && (via.severity === "high" || via.severity === "critical")) {
      found.set(via.source, { source: via.source, sev: via.severity, name: via.name, title: via.title, url: via.url })
    }
  }
}

const offenders = [...found.values()].filter((a) => !ALLOW.has(a.source))
const stale = [...ALLOW.keys()].filter((k) => !found.has(k))

if (stale.length) {
  console.log("ℹ️  Allowlist com entradas OBSOLETAS (upstream já corrigiu — pode remover de scripts/check-audit.mjs):")
  for (const k of stale) console.log(`   - ${k} (${ALLOW.get(k).pkg})`)
  console.log("")
}

if (offenders.length) {
  console.error(`❌ ${offenders.length} vulnerabilidade(s) high/critical NÃO allowlisted:\n`)
  for (const o of offenders) {
    console.error(`   • [${o.sev}] ${o.name} — ${o.title ?? "(sem título)"}`)
    console.error(`     ${o.url ?? ""}  (source ${o.source})\n`)
  }
  console.error("Corrija a dependência OU, se for aceite consciente, adicione o `source` à ALLOW")
  console.error("em scripts/check-audit.mjs com `reason` + `reviewBy`.")
  process.exit(1)
}

// ── O `reviewBy` passa a VALER ─────────────────────────────────────────────
//
// 🔴 ERA SÓ COMENTÁRIO (achado do pentest de 08/08). Não existia nenhuma lógica de data
//    neste arquivo — e mesmo assim a linha de sucesso dizia *"documentados com reviewBy"*,
//    anunciando um controle que não existia. Um aceite consciente virava aceite ETERNO, em
//    silêncio: ninguém revisava porque nada cobrava a revisão.
// 🔑 Aceitar risco com prazo é gestão; aceitar sem prazo é esquecer com estilo. Vencido o
//    prazo, o gate fecha — a saída é reavaliar e renovar a data conscientemente, ou corrigir.
const hoje = new Date().toISOString().slice(0, 10)
const vencidos = [...ALLOW.entries()].filter(([, v]) => !v.reviewBy || v.reviewBy < hoje)

if (vencidos.length) {
  console.error(`❌ ${vencidos.length} aceite(s) da allowlist com prazo VENCIDO:\n`)
  for (const [k, v] of vencidos) {
    console.error(`   • ${v.pkg} (source ${k}) — reviewBy ${v.reviewBy ?? "AUSENTE"}`)
  }
  console.error("\nReavalie: o upstream corrigiu? dá pra remover a dependência? Se o risco")
  console.error("segue aceitável, renove o `reviewBy` em scripts/check-audit.mjs — com data nova.")
  process.exit(1)
}

const proximo = [...ALLOW.values()].map((v) => v.reviewBy).sort()[0]
console.log(`✅ Audit OK — 0 high/critical fora da allowlist (${ALLOW.size} aceitos; próxima revisão em ${proximo ?? "—"}).`)
