/** Texto de produto compartilhado pela lista e pela ficha da equipe. Sem dados do servidor. */
export function teamAccessSummary(input: {
  role: string; viewAll: boolean; seePool: boolean; departmentName?: string | null;
  supervisedNames: string[]; numberNames: string[];
}): string[] {
  if (input.role === "owner" || input.role === "admin") return ["Vê todas as conversas e administra a empresa."]
  if (input.viewAll) return ["Vê todas as conversas, de todos os departamentos e números."]
  const lines = ["Vê as conversas atribuídas a si e aquelas em que participa."]
  if (input.seePool) lines.push("Pode ver e assumir a fila geral: conversas sem atendente e sem departamento.")
  else lines.push("Não acessa a fila geral.")
  if (input.departmentName) lines.push(`Pode ver e assumir a fila de ${input.departmentName}.`)
  if (input.supervisedNames.length) lines.push(`Supervisiona todas as conversas de: ${input.supervisedNames.join(", ")}.`)
  lines.push(input.numberNames.length ? `Nas filas, atende os números: ${input.numberNames.join(", ")}.` : "Nas filas, atende todos os números.")
  if (input.numberNames.length) lines.push("Atribuições, participações e supervisão mantêm o acesso mesmo em outro número. Site e Instagram não dependem dessa seleção.")
  return lines
}
