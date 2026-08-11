import "server-only"
import fs from "node:fs"
import path from "node:path"

/**
 * Qual build está rodando agora.
 *
 * 🔑 EXISTIA DENTRO DE `/api/version` e virou compartilhado porque o livro de execuções
 *    (`cron_runs.meta.build`) precisa do mesmo número. Sem ele, "o job quebrou às 14:03"
 *    e "deployamos às 14:02" são dois fatos soltos que alguém tem que casar de cabeça,
 *    num momento em que ninguém está com a cabeça boa.
 *
 * Fonte: `.next/BUILD_ID`, que o Next gera a cada build. Em `next dev` é a string
 * estática "development" — então em desenvolvimento todas as corridas carimbam igual, e
 * está certo assim.
 */
let cache: string | null = null

export function readBuildId(): string {
  if (cache) return cache
  try {
    cache = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim()
  } catch {
    // Fallback — envs opcionais (Vercel + CI custom). `dev` quando nada responde.
    cache = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"
  }
  return cache
}
