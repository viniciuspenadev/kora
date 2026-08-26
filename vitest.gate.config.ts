import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// ═══════════════════════════════════════════════════════════════
// O PORTÃO — critério de aceite da refundação do núcleo de dinheiro
// ═══════════════════════════════════════════════════════════════
//
// Roda SÓ os `*.gate.test.ts`: os testes que afirmam a regra dos 4 críticos validados
// no pentest de 10/08 (docs/billing-core-refoundation-design.md).
//
// Os gates estão verdes desde a conclusão local de F2–F4 e rodam obrigatoriamente na CI.
// "Corrigido" deixa de ser opinião e continua sendo medida a cada push/PR.
//
// ⚠️ Nunca "consertar o teste" para ficar verde. Se um deles passar a incomodar, a
//    pergunta é se a REGRA mudou — e regra de dinheiro só muda por decisão do owner,
//    registrada no desenho. O repositório já tem um teste que consagrou um defeito
//    (`webhook-handler.test.ts:207-220`, o C-02); é o erro que este portão existe para
//    não repetir.

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.gate.test.ts"],
    environment: "node",
  },
})
