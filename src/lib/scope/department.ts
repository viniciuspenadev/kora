// ═══════════════════════════════════════════════════════════════
// "Este membro alcança este setor?" — predicado PURO, casa única
// ═══════════════════════════════════════════════════════════════
// 🔴 Mora aqui, e não em `visibility.ts`, por um motivo mecânico: `visibility.ts` é
//    `server-only` e o roteador (`lib/routing`) precisa ser puro pra ser lido e testado
//    sem banco. Importar de lá contaminaria o módulo — e foi assim que nasceu uma
//    SEGUNDA cópia da regra, em silêncio, um dia depois de o comentário de
//    `visibility.ts` dizer que ela devia morar num lugar só.
//
// ⚠️ Quem muda a regra de setor muda AQUI. `visibility.ts` (fan-out/permissão) e
//    `routing/decide.ts` (escala) consomem os dois deste arquivo.
//
// ⚠️ Isto responde ALCANCE de setor. NÃO responde:
//    • permissão de ver conversa → `canViewConversation` (fonte única, espelhada na RLS)
//    • quem descobre o não-atribuído → `memberSeesUnassigned` (inclui `see_pool`)
//    • quem pode RECEBER trabalho → o chamador soma `active`, pausa e número.

/** O mínimo que o predicado precisa. Cada chamador mapeia sua linha pra isto. */
export interface DepartmentReach {
  role:                   string
  viewAll:                boolean | null
  departmentId:           string | null
  supervisesDepartments:  string[] | null
}

/**
 * Sem setor na conversa (Triagem, que é como todo inbound nasce) → todo mundo alcança.
 * Com setor → pertence a ele, supervisiona ele, ou tem alcance amplo (admin/view_all).
 */
export function reachesDepartment(m: DepartmentReach, departmentId: string | null | undefined): boolean {
  if (!departmentId) return true
  if (["owner", "admin"].includes(m.role) || m.viewAll === true) return true
  const sup = m.supervisesDepartments
  if (Array.isArray(sup) && sup.includes(departmentId)) return true
  return m.departmentId === departmentId
}
