import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Design system: `<select>` cru é proibido — use <SimpleSelect> (ou o compound
  // <Select*>) de @/components/ui/select, que traz a lista animada padrão do Kora
  // (hover, check, abertura). A lista nativa do <select> é desenhada pelo navegador
  // e não dá pra estilizar/animar — por isso o componente é a fonte única.
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: "Não use <select> cru. Use <SimpleSelect> de @/components/ui/select (lista animada do design system). Caso raríssimo que precise do picker nativo do SO: <NativeSelect>.",
        },
      ],
    },
  },
  // A ÚNICA exceção: o próprio componente encapsula o <select> nativo (NativeSelect).
  {
    files: ["src/components/ui/select.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
