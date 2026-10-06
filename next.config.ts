import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Saída otimizada pra Docker: copia só o necessário (não o node_modules inteiro).
  output: "standalone",

  // Não anunciar o framework (remove header `X-Powered-By: Next.js` — reduz
  // fingerprint pro atacante). Auditoria 2026-07-24.
  poweredByHeader: false,

  // @react-pdf/renderer (fontkit, etc.) não deve ser empacotado pelo bundler —
  // roda como dep externa no server (gera a fatura em PDF).
  serverExternalPackages: ["@react-pdf/renderer"],

  experimental: {
    // 🔴 Com o proxy (src/proxy.ts) ativo, o Next guarda em memória só os primeiros 10MB do
    //    corpo de cada requisição e SEGUE EM FRENTE com o resto cortado — sem erro. Era a
    //    causa de todo upload acima de ~10MB falhar com 500 "Unexpected end of form" (medido
    //    em 30/09/2026; mesma classe do webhook cortado de 05/08, que saiu do matcher).
    //    Este teto precisa cobrir o maior arquivo aceito (32MB em media-validation.ts) mais
    //    a folga do formulário. ⚠️ Custa memória: o corpo fica em buffer aqui E na action.
    proxyClientMaxBodySize: "36mb",
    serverActions: {
      // Default do Next é 1MB. Mesmo teto do proxy acima: os dois andam juntos com o maior
      // limite de @/lib/chat/media-validation.ts (32MB) — o armazenamento recusa >50MB.
      bodySizeLimit: "36mb",
    },
  },
};

export default nextConfig;
