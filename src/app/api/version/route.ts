import { NextResponse } from "next/server"
import { readBuildId } from "@/lib/build-id"

/**
 * GET /api/version
 *
 * Retorna a versão atual do deploy. Cliente compara contra a versão que pegou
 * no mount; se mudou, mostra banner "Nova versão disponível".
 *
 * Fonte: `.next/BUILD_ID` — arquivo que o Next.js gera automaticamente a cada
 * `next build`. Hash único por build. Funciona em qualquer host (Vercel,
 * EasyPanel, Docker, VPS) sem env var nem CI/CD especial.
 *
 * Em dev (`next dev`), BUILD_ID é a string "development" (estática) → não
 * dispara banner com HMR.
 *
 * 🔑 A leitura saiu daqui para [lib/build-id.ts](../../../lib/build-id.ts) porque o livro
 *    de execuções dos crons (`cron_runs.meta.build`) precisa do MESMO número — é ele que
 *    faz "o job quebrou às 14:03" casar com "deployamos às 14:02".
 */

export const dynamic   = "force-dynamic"
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    { version: readBuildId() },
    {
      headers: {
        "Cache-Control": "no-store, must-revalidate",
      },
    },
  )
}
