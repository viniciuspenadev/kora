import { NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"

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
 */

export const dynamic   = "force-dynamic"
export const revalidate = 0

let cachedVersion: string | null = null

function readVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const buildIdPath = path.join(process.cwd(), ".next", "BUILD_ID")
    cachedVersion = fs.readFileSync(buildIdPath, "utf8").trim()
  } catch {
    // Fallback — env vars opcionais (compatibilidade com Vercel + custom CI)
    cachedVersion = process.env.VERCEL_GIT_COMMIT_SHA
                 ?? process.env.NEXT_PUBLIC_BUILD_ID
                 ?? "dev"
  }
  return cachedVersion
}

export async function GET() {
  return NextResponse.json(
    { version: readVersion() },
    {
      headers: {
        "Cache-Control": "no-store, must-revalidate",
      },
    },
  )
}
