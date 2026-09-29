// ═══════════════════════════════════════════════════════════════
// Datas de agendamento — formatador ÚNICO voltado pro CLIENTE
// ═══════════════════════════════════════════════════════════════
// docs/agenda-node-redesign.md §7 (estudo de limites/formatos com o owner,
// 2026-07-23). Régua: quanto menos espaço, menos enfeite ("às", traço) — mas o
// dia da semana NUNCA vira sigla ("qui" morreu). Três variantes:
//
//   fmtFull       "Quinta-feira, 23/07 às 08h00"  → corpos, sucesso, lembrete
//   fmtTitleSlot  "Quinta 23/07 08h00"  (máx 19)  → título de opção COM hora
//   fmtTitleDay   "Quinta - 23/07" / "Hoje - 23/07" (máx 15) → título de DIA
//
// Consumidores: nó Agendar, interceptor 3d (confirmação), lembretes,
// notificação interna do agendamento. Toda superfície nova importa daqui.

const TZ = "America/Sao_Paulo"

/** "quinta-feira" → "Quinta-feira" (Intl entrega minúsculo em pt-BR). */
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

/** Dia da semana por extenso: "Quinta-feira" / "Sábado". */
export function weekdayFull(iso: string): string {
  return cap(new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long" }))
}

/** Palavra curta SEM sigla: "Quinta" / "Sábado" / "Domingo" (tira o "-feira"). */
export function weekdayWord(iso: string): string {
  return weekdayFull(iso).replace(/-feira$/i, "")
}

function dm(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
}

function hm(iso: string): string {
  const d = new Date(iso)
  const h = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
  return h.replace(":", "h")
}

function dayKeyTZ(d: Date): string { return d.toLocaleDateString("en-CA", { timeZone: TZ }) }

/** Completo, pra CORPO de mensagem (sem limite): "Quinta-feira, 23/07 às 08h00". */
export function fmtFull(iso: string): string {
  return `${weekdayFull(iso)}, ${dm(iso)} às ${hm(iso)}`
}

/** Título de opção COM hora (cabe no botão de 20): "Quinta 23/07 08h00" (pior caso 19). */
export function fmtTitleSlot(iso: string): string {
  return `${weekdayWord(iso)} ${dm(iso)} ${hm(iso)}`
}

/** Título de DIA (formato do owner): "Quinta - 23/07"; Hoje/Amanhã quando for o caso. */
export function fmtTitleDay(iso: string): string {
  const k = dayKeyTZ(new Date(iso))
  if (k === dayKeyTZ(new Date())) return `Hoje - ${dm(iso)}`
  if (k === dayKeyTZ(new Date(Date.now() + 86_400_000))) return `Amanhã - ${dm(iso)}`
  return `${weekdayWord(iso)} - ${dm(iso)}`
}

/** Dia completo pra CORPO (sem hora): "Quinta-feira, 23/07". */
export function fmtFullDay(iso: string): string {
  return `${weekdayFull(iso)}, ${dm(iso)}`
}

/** Só a hora: "08h00" (títulos do passo da hora — o dia já foi escolhido). */
export function fmtTime(iso: string): string { return hm(iso) }

/** Período do dia pra AGRUPAR horários em seções: "Manhã" | "Tarde" | "Noite". */
export function periodOf(iso: string): "Manhã" | "Tarde" | "Noite" {
  const h = Number(new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", hour12: false }))
  if (h < 12) return "Manhã"
  if (h < 18) return "Tarde"
  return "Noite"
}
