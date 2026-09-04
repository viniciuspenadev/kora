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
    // Fallback. ⚠️ `VERCEL_*` saiu: não usamos Vercel, então a variável nunca existe e
    //    a linha só sugeria uma plataforma que não é a nossa. No container o
    //    `.next/BUILD_ID` sempre existe; este ramo é para `next dev` e testes.
    cache = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"
  }
  return cache
}
