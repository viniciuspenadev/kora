import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MAX_FILE_SIZE, SIZE_LIMITS } from "./media-validation"

// Guarda da CLASSE "upload cortado em silêncio" (medido em 30/09/2026): com o proxy ativo, o Next
// guarda só os primeiros N MB do corpo e segue com o resto cortado — a action recebia arquivo pela
// metade e respondia 500. Três números precisam andar juntos; este teste reprova se um deles fugir.
const MB = 1024 * 1024
const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8")
const configMb = (key: string): number | null => {
  const m = new RegExp(`${key}:\\s*"(\\d+)mb"`).exec(config)
  return m ? Number(m[1]) : null
}
const biggestMb = Math.max(...Object.values(SIZE_LIMITS)) / MB
const STORAGE_LIMIT_MB = 50   // limite global do armazenamento (config do projeto, conferido em 30/09/2026)
const FORM_SLACK_MB = 1       // legenda + cabeçalhos do formulário

describe("limites de upload andam juntos", () => {
  it("o teto do proxy existe e cobre o maior arquivo aceito (sem ele o Next corta em 10 MB)", () => {
    const proxy = configMb("proxyClientMaxBodySize")
    expect(proxy).not.toBeNull()
    expect(proxy!).toBeGreaterThanOrEqual(biggestMb + FORM_SLACK_MB)
  })

  it("o teto das actions cobre o maior arquivo e não passa do que o proxy entrega inteiro", () => {
    const action = configMb("bodySizeLimit")
    expect(action).not.toBeNull()
    expect(action!).toBeGreaterThanOrEqual(biggestMb + FORM_SLACK_MB)
    expect(action!).toBeLessThanOrEqual(configMb("proxyClientMaxBodySize")!)
  })

  it("nenhum limite prometido passa do que o armazenamento aceita", () => {
    expect(MAX_FILE_SIZE).toBe(Math.max(...Object.values(SIZE_LIMITS)))
    expect(biggestMb).toBeLessThanOrEqual(STORAGE_LIMIT_MB)
  })
})
