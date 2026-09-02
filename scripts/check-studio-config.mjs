#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Guardrail: a ficha de Persona (studio_config) tem UMA fonte só
// ═══════════════════════════════════════════════════════════════════════════
// Contexto (defeito de produção, 2026-08-17): a pergunta "existe ficha de Persona?"
// era feita em DOIS lugares com respostas DIFERENTES. A porta de entrada do motor
// (`doStudioRun`) já caía em padrões neutros quando a ficha não existia; o despertar
// (`doResume`) ainda tratava ausência como "Studio desligado" e ENCERRAVA o run.
//
// Resultado medido em produção: todo fluxo com um nó **Esperar** morria no Esperar
// para todo tenant que nunca salvou uma Persona — ou seja, exatamente quem NÃO usa IA.
// E morria marcado como `done`, então nada acusava a falha. 12 dias sem ninguém ver.
//
// A correção foi `loadStudioConfig()` em src/lib/ai-v2/run.ts. Este check existe pra
// que a SEGUNDA CÓPIA não volte: quem precisar da ficha chama a função. Arquivo novo
// que leia a tabela direto FALHA O BUILD — e aí a pessoa decide conscientemente entre
// usar a fonte única ou se acrescentar à lista abaixo.
//
// 🔴 SEM `grep` — mesma lição de check-server-actions.mjs: o build roda em
//    `node:22-alpine`, cujo grep é o do BusyBox e não aceita as opções do GNU.
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const ALVO = "studio_config";

/**
 * Quem PODE tocar a tabela direto, e por quê. Acrescentar aqui é uma decisão
 * consciente — que é exatamente o ponto deste arquivo.
 */
const PERMITIDOS = new Map([
  ["src/lib/ai-v2/studio-config.ts",           "🔑 A FONTE ÚNICA (loadStudioConfig). É daqui que todo mundo lê."],
  ["src/lib/actions/studio/config.ts",        "Actions que GRAVAM a ficha (a tela da Persona salvando)."],
  ["src/app/(app)/studio/persona/page.tsx",   "A tela da Persona lendo a própria ficha pra preencher o formulário."],
  ["src/lib/ai-v2/dispatch.ts",               "Leitura estreita de ai_control_decoupled, com `?.` — ausência nunca vira 'desligado'."],
  ["src/lib/conversation-dedup.ts",           "Idem: só ai_control_decoupled, com `?.`."],
  ["src/lib/ai-v2/copilot.ts",                "Idem: só ai_model, com `?.`."],
]);

function varrer(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...varrer(p)); continue; }
    // Teste NÃO é leitor de produção: ele nomeia a tabela justamente pra provar que a
    // fonte única consulta a tabela certa. (Este check pegou o próprio teste dela.)
    if (e.name.includes(".test.")) continue;
    if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const infratores = [];
for (const arquivo of varrer("src")) {
  const rel = arquivo.split(sep).join("/");
  if (PERMITIDOS.has(rel)) continue;
  const linhas = readFileSync(arquivo, "utf8").split("\n");
  linhas.forEach((linha, i) => {
    // Só a leitura/escrita de verdade — menção em comentário não conta.
    const semComentario = linha.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (semComentario.includes(ALVO)) infratores.push(`${rel}:${i + 1}  ${linha.trim()}`);
  });
}

if (infratores.length) {
  console.error("\n❌ studio_config lido fora da fonte única:\n");
  for (const l of infratores) console.error("   " + l);
  console.error(`
   A ficha de Persona é SÓ da IA. Um fluxo determinístico (Mensagem/Menu/Coletar
   dado/Esperar) não precisa dela em momento nenhum do ciclo — nem pra começar,
   nem pra acordar. Tratar ficha ausente como "Studio desligado" foi o defeito de
   2026-08-17, que matou todo fluxo com nó Esperar de quem não usa IA.

   ✅ Use:  import { loadStudioConfig } from "@/lib/ai-v2/studio-config"
            const config = await loadStudioConfig(tenantId)

   Se a sua leitura é legitimamente diferente (estreita, com \`?.\`, e que NUNCA
   trata ausência como desligado), acrescente o arquivo a PERMITIDOS aqui — com
   o motivo escrito.
`);
  process.exit(1);
}

console.log(`✅ studio_config: fonte única preservada (${PERMITIDOS.size} leitores autorizados).`);
