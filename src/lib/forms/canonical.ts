// Kora Formulários — texto canônico da definição (puro). O mesmo conteúdo sempre dá o mesmo
// texto: o servidor tira o carimbo (sha256) da versão publicada a partir dele, e o editor usa
// a mesma regra para saber se há "alterações não publicadas". Uma regra só para os dois.

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`
  }
  return JSON.stringify(v ?? null)
}
