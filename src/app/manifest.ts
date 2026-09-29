import type { MetadataRoute } from "next"

// PWA manifest — Kora instalável na tela inicial (iOS/Android).
// Habilita standalone (sem barra do navegador) + ícone próprio; pré-requisito
// do Web Push no iOS (só funciona em PWA instalado, iOS 16.4+).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kora — WhatsApp + IA",
    short_name: "Kora",
    description: "Atenda e venda pelo WhatsApp com IA, do seu celular.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#004add",
    lang: "pt-BR",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
