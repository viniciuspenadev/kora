import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Kora",
  description: "Inbox, funil e automação para o seu WhatsApp",
  applicationName: "Kora",
  // PWA instalável no iOS: capable + título da home + barra de status sólida
  // (statusBarStyle 'default' evita o conteúdo passar por baixo do relógio).
  appleWebApp: {
    capable: true,
    title: "Kora",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  // Legado: iOS < 16.4 não lê o `display` do manifest — esta tag garante
  // standalone ("abrir sem barra do navegador") nesses aparelhos.
  other: { "apple-mobile-web-app-capable": "yes" },
}

// viewport-fit=cover é o que habilita env(safe-area-inset-*) no iPhone (notch +
// barra de gestos). userScalable=false mata o zoom-on-focus do Safari iOS em
// inputs <16px — comportamento app-like, igual WhatsApp Web.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#004add",
  // Teclado virtual (Chrome Android): encolhe o LAYOUT junto com o teclado, em vez
  // de o teclado cobrir o conteúdo — mantém o composer visível acima dele. Sem isso,
  // `h-dvh` não reage ao teclado e a barra de digitação cai atrás dele.
  interactiveWidget: "resizes-content",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  )
}
