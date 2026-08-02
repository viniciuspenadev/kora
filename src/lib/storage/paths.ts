import "server-only"

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTRATO DE CAMINHOS DO STORAGE — leia antes de subir arquivo novo
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **O CAMINHO É A FONTE DA VERDADE.** No Kora, quanto o cliente usa de armazenamento,
 *    de onde vem e de quem é NÃO saem de coluna nenhuma — saem do **caminho do arquivo**.
 *    Duas funções no banco leem `storage.objects` e derivam tudo do path:
 *      • `tenant_storage_usage(tenant)`   → o número que o cliente vê (e a cota)
 *      • `reconcile_storage_objects()`    → preenche o ledger `tenant_storage_objects`
 *
 *    Isso foi decisão consciente (docs/tenant-storage-foundation-design.md §1): medir pelo
 *    bucket dá **0% de deriva** e bate com o que a Supabase COBRA — enquanto contar por
 *    ponteiro já nascia errado (medido: 59 objetos sem ponteiro, 118 ponteiros sem objeto).
 *
 * 🔴 **CONSEQUÊNCIA PRA QUEM VAI CRIAR UPLOAD NOVO:** você não precisa gravar nada em
 *    tabela nenhuma. **Mas o caminho tem que seguir o formato abaixo** — senão o arquivo
 *    do seu cliente não entra na cota dele, e ninguém percebe por meses.
 *
 *    FORMATO OBRIGATÓRIO:  <prefixo>/<tenantId>/<donoId>[-sufixo].<ext>
 *
 *    O `<tenantId>` no 2º segmento é o que atribui o gasto. O `<donoId>` (uuid no começo
 *    do 3º segmento) é o que permite apagar o arquivo junto do dono e cumprir LGPD.
 *    Exceção histórica: mídia de conversa usa `<tenantId>/<conversaId>/<arquivo>`.
 *
 * ⚠️ **BUCKET NOVO = TRÊS LUGARES, e o terceiro é traiçoeiro.** Além dos dois abaixo, as duas
 *    funções SQL filtram `bucket_id IN ('chat-attachments','widget-assets')` **fixo**. Bucket
 *    que não estiver nessa lista não cai em "Outros" — fica **INVISÍVEL**: o cliente sobe
 *    centenas de MB e o número na tela dele não muda. Prefira **prefixo novo em bucket que já
 *    existe** (foi o que se fez com `card-images/`, 2026-08-01) — aí valem os dois lugares.
 *
 * ⚠️ **PREFIXO NOVO = MEXER EM DOIS LUGARES**, sempre juntos:
 *      1. `STORAGE_PREFIXES` aqui embaixo;
 *      2. o `CASE` de `reconcile_storage_objects()` e de `tenant_storage_usage()`
 *         (supabase/migrations/20260731_storage_reconcile.sql).
 *    Esquecer o (2) faz o arquivo cair em `kind='other'` → aparece como **"Outros"** na
 *    tela de uso do cliente. É de propósito: falha visível em vez de silenciosa.
 *
 * ⚠️ **NÃO existe hoje**: quem subiu (`uploaded_by`). O caminho não carrega isso e
 *    ninguém pediu — se virar requisito, aí sim vale instrumentar os 13 pontos de upload.
 */

/** Prefixo → natureza + de que entidade o arquivo é. Espelho do CASE no SQL. */
export const STORAGE_PREFIXES = {
  "avatars":      { kind: "avatar",      ref: "contact"      },
  // ⚠️ ATIVO, não histórico: imagem que o cliente subiu e que automação EM PRODUÇÃO usa.
  //    **Nunca** entra em política de retenção por tempo (§7 do desenho) — a Meta re-busca
  //    a imagem do card e, sem ela, o card degrada em SILÊNCIO.
  "card-images":  { kind: "card_image",  ref: null           },
  "catalog":      { kind: "catalog",     ref: "catalog_item" },
  "documents":    { kind: "document",    ref: "document"     },
  "ig-thumbs":    { kind: "ig_thumb",    ref: null           },
  "unit-logos":   { kind: "unit_logo",   ref: "unit"         },
  "user-avatars": { kind: "user_avatar", ref: null           },  // ⚠️ sem tenant no path
  "templates":    { kind: "template",    ref: null           },  // ⚠️ nunca é apagado hoje
} as const

export type StoragePrefix = keyof typeof STORAGE_PREFIXES

/** Entidades que podem ser DONAS de um arquivo (o `ref` acima). */
export type StorageOwnerRef = NonNullable<(typeof STORAGE_PREFIXES)[StoragePrefix]["ref"]>

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 EXCLUSÃO DIRIGIDA PELO REGISTRY — declare o dono, a exclusão vem de graça
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TODOS os caminhos de arquivo cujo dono é `ref`, prontos pra `storage.remove()`.
 *
 * **Por que isto existe.** Até 2026-08-01 este registry era só documentação: descrevia a
 * medição e ninguém o consumia. A exclusão de LGPD tinha o caminho do avatar **escrito à
 * mão** — e foi exatamente assim que 18 fotos de rosto de contatos apagados sobreviveram
 * meses no bucket (medido em prod no QA de 2026-07-31). O prefixo existia, a exclusão não
 * sabia dele, e nada denunciava.
 *
 * **A inversão:** em vez de "lembrar de apagar", basta **declarar o dono** em
 * `STORAGE_PREFIXES`. Quem exclui percorre o registry — prefixo novo com
 * `ref: "contact"` entra na exclusão de contato **sem ninguém tocar no código de LGPD**.
 *
 * ⚠️ `ref: null` é declaração CONSCIENTE de "não tem dono individual" (ativo do tenant,
 *    derivado, cache). Se o arquivo carrega PII de uma pessoa, ele **precisa** de `ref` —
 *    senão o pedido de eliminação (LGPD Art. 18 VI) não o alcança.
 *
 * ⚠️ Extensões em leque de propósito: a extensão vem do mime da ORIGEM, então o mesmo
 *    dono pode ter deixado `.jpeg` hoje e `.png` amanhã.
 */
export function storagePathsForOwner(
  ref: StorageOwnerRef, tenantId: string, ownerId: string,
): string[] {
  const out: string[] = []
  for (const [prefix, meta] of Object.entries(STORAGE_PREFIXES)) {
    if (meta.ref !== ref) continue
    out.push(...storagePathVariants(prefix as StoragePrefix, tenantId, ownerId))
  }
  return out
}

/** Prefixos que guardam arquivo de um tenant — usado na saída/limpeza do tenant inteiro. */
export function storagePrefixesForTenant(): StoragePrefix[] {
  // `user-avatars` fora: é o ÚNICO caminho sem tenant no path (dívida conhecida) — varrer
  // por `<prefixo>/<tenant>/` não o alcança, e incluí-lo aqui daria falsa sensação de
  // cobertura. Ver o aviso no topo deste arquivo.
  return (Object.keys(STORAGE_PREFIXES) as StoragePrefix[]).filter((p) => p !== "user-avatars")
}

/**
 * Monta o caminho no formato que as funções de medição entendem.
 *
 * Use SEMPRE isto em vez de interpolar string na mão — é o que garante que o arquivo
 * entre na cota do cliente certo.
 */
export function storagePath(
  prefix: StoragePrefix, tenantId: string, ownerId: string, ext: string,
): string {
  const clean = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin"
  return `${prefix}/${tenantId}/${ownerId}.${clean}`
}

/** Mídia de conversa: formato histórico `<tenant>/<conversa>/<timestamp>_<nome>`. */
export function conversationMediaPath(tenantId: string, conversationId: string, fileName: string): string {
  return `${tenantId}/${conversationId}/${Date.now()}_${fileName.replace(/[^\w.-]/g, "_")}`
}

/**
 * Todos os caminhos possíveis de um arquivo de dono único, pra REMOÇÃO.
 *
 * ⚠️ A extensão vem do mime da ORIGEM: o mesmo contato pode ter deixado `.jpeg` hoje e
 *    `.png` amanhã. Apagar só a registrada no `metadata` deixa a outra pra trás — foi
 *    assim que 18 fotos de rosto de contatos apagados sobreviveram (LGPD, 2026-07-31).
 */
export function storagePathVariants(prefix: StoragePrefix, tenantId: string, ownerId: string): string[] {
  return ["jpeg", "jpg", "png", "webp", "gif", "pdf"].map((e) => `${prefix}/${tenantId}/${ownerId}.${e}`)
}
