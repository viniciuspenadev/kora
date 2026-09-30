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
    // `*.gate.test.ts` fica em uma suíte separada para manter o portão financeiro
    // explícito e rápido. Ele está verde e roda obrigatoriamente na CI por
    // `npm run test:gate`; não é uma exclusão de cobertura.
    exclude: [...configDefaults.exclude, "src/**/*.gate.test.ts"],
    environment: "node",
  },
})
