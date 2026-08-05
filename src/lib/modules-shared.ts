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

/**
 * Rótulos das categorias do catálogo — **fonte ÚNICA**.
 *
 * ⚠️ Vivia só em `admin/planos/client.tsx`. Quando a tela do CLIENTE passou a agrupar por
 *    categoria (2026-08-05), copiar o mapa criaria duas verdades sobre o nome de cada
 *    grupo — e um dia o god mode diria "Automação e IA" enquanto o cliente lia outra coisa.
 */
export const CATEGORIA_LABEL: Record<string, string> = {
  core:         "Essencial",
  atendimento:  "Atendimento",
  crm:          "Comercial",
  agenda:       "Agenda",
  campanhas:    "Campanhas",
  studio:       "Automação e IA",
  multichannel: "Canais",
  operational:  "Operacional",
  billing:      "Faturamento",
  deprecated:   "Descontinuado",
}

/**
 * Canal de comunicação que o módulo implica — pro card do plano mostrar, de relance, com
 * quais canais ele fala. `null` = o módulo não é de canal.
 *
 * ⚠️ Deriva do slug, não do nome: rótulo muda (acabou de mudar duas vezes), slug não.
 */
export const CANAL_DO_MODULO: Record<string, "whatsapp" | "instagram"> = {
  multi_instance:       "whatsapp",   // WhatsApp QR Code
  // ⚠️ Disparo em massa é WhatsApp por dependência REAL, não por afinidade: campanha em
  //    massa exige template aprovado da Meta, ou seja, **número oficial conectado**. O
  //    `/campanhas/nova` redireciona pra /integracoes/whatsapp-oficial quando não há um.
  //    O logo ao lado do nome diz isso ANTES de a pessoa contratar e descobrir depois.
  broadcasts:           "whatsapp",
  whatsapp_official:    "whatsapp",
  meta_cloud:           "whatsapp",
  instagram_direct:     "instagram",
  instagram_automation: "instagram",
}
