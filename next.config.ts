import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Saída otimizada pra Docker: copia só o necessário (não o node_modules inteiro).
  output: "standalone",

  experimental: {
    serverActions: {
      // Default do Next é 1MB. Subimos pra 100MB pra suportar documentos do
      // WhatsApp (que tem limite oficial de 100MB pra docs). Caps por tipo
      // ficam em @/lib/chat/media-validation.ts.
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
