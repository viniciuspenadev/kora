#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Guardrail: Server Actions sem gate (auditoria 2026-07-30, críticos C-01..C-04)
// ═══════════════════════════════════════════════════════════════════════════
// No Next, TODA função exportada de um arquivo "use server" vira Server Action
// PÚBLICA chamável via RSC — mesmo "helper interno". Se ela recebe tenantId/
// createdBy/actorId por parâmetro e NÃO valida (auth/require*/guard), um atacante
// forja a chamada com tenant/ator alheio → operação cross-tenant.
//
// Este check FALHA o build se aparecer uma export nesse padrão. Regra: helper
// interno NÃO se exporta de "use server" (mover pra módulo server-only), OU
// chama um guard (assertSessionTenant) na primeira linha. Ver skill database-rules §2.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const cand = execSync(`grep -rl '"use server"' src --include=*.ts --include=*.tsx`, { encoding: "utf8" })
  .split("\n").filter(Boolean);
// Só arquivos cuja 1ª linha não-vazia é a diretiva "use server" (não comentário).
const actionFiles = cand.filter((f) => {
  const first = readFileSync(f, "utf8").split("\n").map((l) => l.trim()).find((l) => l.length);
  return first === '"use server"' || first === "'use server'";
});

// Gates reconhecidos (uma função é "gateada" se o corpo referencia algum destes).
// ⚠️ Também reconhece HELPERS que fazem o gate um nível abaixo — senão o check acusa
// falso positivo e o time aprende a ignorá-lo, que é pior que não ter check.
// `tenantMetaProvider` faz auth() + papel + `.eq("tenant_id", session.user.tenantId)`.
const GATE = /\bauth\s*\(\)|\brequire[A-Z]\w*\s*\(|getViewerScope\s*\(|assertSessionTenant\s*\(|agendaScope\s*\(|session\.user|tenantMetaProvider\s*\(/;
// Sinal de "helper interno perigoso": recebe tenant/ator LITERAL por parâmetro.
// (Preciso, 0 falso-positivo. Blind spot conhecido: tenantId DENTRO de um type nomeado
// `input: XType` — não dá pra detectar aqui de forma confiável; é revisão MANUAL, ver
// database-rules §2. Broadenar pra `input:` deu 11 FP em 2026-07-30, todos gateados.)
// ⚠️ AMPLIADO no QA de 2026-08-01: `recordIgSubscription(externalAccountId, …)` era uma
// action pública que escrevia em qualquer tenant, e passou batido porque o nome do
// parâmetro não estava nesta lista. O furo era de NOME, não de lógica — então qualquer
// identificador de recurso vindo do chamador entra aqui.
const TAKES = /\btenantId\b|\bbyUserId\b|\bcreatedBy\b|\bactorId\b|\bactorEmail\b|\bexternalAccountId\b|\baccountId\b|\bconnectionId\b|\binstanceId\b/;

// Lista de parâmetros REAL: balanceia parênteses (não trunca em callback `() =>`).
function paramList(src, fromIdx) {
  const open = src.indexOf("(", fromIdx);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open, open + 200);
}
// Remove comentários pro teste de gate (um gate só em comentário não conta).
const stripComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const flagged = [];
for (const f of actionFiles) {
  const src = readFileSync(f, "utf8");
  const re = /export\s+(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async)/g;
  let m; const marks = [];
  while ((m = re.exec(src))) marks.push({ name: m[1] || m[2], idx: m.index });
  for (let i = 0; i < marks.length; i++) {
    const body = src.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : src.length);
    const header = paramList(body, 0);
    if (TAKES.test(header) && !GATE.test(stripComments(body))) {
      flagged.push(`${f.replace(/\\/g, "/")} :: ${marks[i].name}()`);
    }
  }
}

if (flagged.length) {
  console.error(`\n❌ ${flagged.length} Server Action(s) recebem tenantId/ator SEM gate (cross-tenant):\n`);
  for (const x of flagged) console.error(`   ${x}`);
  console.error(`\nFix: mover o helper pra módulo server-only (sem "use server") OU chamar`);
  console.error(`assertSessionTenant(tenantId) na 1ª linha. Ver .claude/skills/database-rules/SKILL.md §2.\n`);
  process.exit(1);
}
console.log(`✅ Server Actions OK — ${actionFiles.length} módulos "use server", 0 helpers expostos sem gate.`);
