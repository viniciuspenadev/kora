import { defineConfig, configDefaults } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    // ⚠️ `*.gate.test.ts` fica FORA da suíte normal de propósito. São os testes que afirmam
    //    a REGRA dos 4 críticos de dinheiro e por isso ficam VERMELHOS até a refundação do
    //    núcleo estar de pé (docs/billing-core-refoundation-design.md). Suíte que convive
    //    com vermelho deixa de ser sinal — então eles rodam por `npm run test:gate`, que é
    //    o critério de aceite de cada fase. Quando os 4 ficarem verdes (fim da F5), esta
    //    linha sai e eles passam a rodar sempre.
    exclude: [...configDefaults.exclude, "src/**/*.gate.test.ts"],
    environment: "node",
  },
})
