// ═══════════════════════════════════════════════════════════════
// Módulos — metadados PUROS (safe pra client)
// ═══════════════════════════════════════════════════════════════
// `modules.ts` é `server-only` (fala com o banco). O que o navegador precisa saber sobre
// módulos mora aqui — mesmo arranjo de `limits-shared.ts` e `lifecycle-shared.ts`.

/**
 * Os módulos que têm um nível PRO **de verdade** — isto é, existe código que chama
 * `hasModulePro` e muda de comportamento por causa dele.
 *
 * 🔴 POR QUE ESTA LISTA EXISTE (2026-08-04). O checkbox "PRO" do god mode aparecia em
 *    **todo módulo não-core habilitado** — cerca de 30. Só que `hasModulePro` era
 *    consultado em UM módulo. Ou seja: dava pra marcar PRO em `kanban`, `contatos`,
 *    `broadcasts`… e não acontecia nada, para sempre. A interface prometia um controle
 *    que 29 dos 30 não honravam.
 *    Medido em produção no mesmo dia: de **3** concessões de PRO existentes, **2 eram
 *    inertes** (`ai` na Blue, vindo de um backfill de julho; `agenda_reminders` na Calla,
 *    vindo de um plano que nem tem mais PRO configurado).
 *
 * ⚠️ REGRA DE MANUTENÇÃO: entrar aqui **junto** com o gate. Slug nesta lista sem
 *    `hasModulePro` no servidor é a mesma promessa vazia de antes, só que menor. E gate
 *    sem entrada aqui é pior: o recurso fica travado e o god mode não tem como liberar.
 *
 * 🔑 `recurso` é o texto que o cliente lê — não o nome do módulo. Ele responde
 *    "o que exatamente eu ganho pagando?", que é a pergunta que vende.
 */
export const MODULOS_COM_PRO: Record<string, { recurso: string; descricao: string }> = {
  instagram_automation: {
    recurso:   "Curtir a resposta automaticamente",
    descricao: "Quando alguém responde seu story, a Kora curte a resposta na hora — sem você abrir o Instagram.",
  },
  agenda_reminders: {
    recurso:   "Enviar lembretes automáticos",
    descricao: "A Kora avisa seu cliente antes do horário marcado e pede a confirmação, sozinha.",
  },
}

/** Este módulo tem nível PRO? Usado pelo god mode pra só oferecer o que existe. */
export function temNivelPro(slug: string): boolean {
  return Object.hasOwn(MODULOS_COM_PRO, slug)
}
