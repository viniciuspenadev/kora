// ═══════════════════════════════════════════════════════════════
// Follow-up de Atendimento — REGRAS PURAS (docs/atendimento-followup-design.md)
// ═══════════════════════════════════════════════════════════════
// Sem `server-only` e sem banco DE PROPÓSITO: a mesma regra é lida pelo servidor
// (varredura, ações) e pelo NAVEGADOR (chip da lista, cabeçalho da conversa).
//
// A tela precisa apagar o chip no instante em que o cliente responde — não daqui
// a 5 minutos, quando a varredura passar. Se cada lado tivesse a sua conta, elas
// divergiriam; e divergência de regra é o defeito que a casa já pagou caro.
// Quem materializa no banco é a varredura; aqui é a MESMA conta, sem efeito.

/** Teto da nota: é lembrete interno, não campo de texto livre sem fim. */
export const FOLLOW_UP_NOTE_MAX = 280

/** Horizonte máximo: promessa pra daqui a 1 ano é engano, não compromisso. */
export const FOLLOW_UP_MAX_DAYS = 365

/** Colunas do estado + as que decidem "o cliente já respondeu?". */
export interface FollowUpFields {
  follow_up_at:       string | null
  follow_up_by:       string | null
  follow_up_note:     string | null
  follow_up_set_at:   string | null
  follow_up_fired_at: string | null
  /** Carimbo de CUMPRIDO. A promessa não some — fica no dia dela, marcada. */
  follow_up_done_at:  string | null
  last_message_at:    string | null
  last_message_dir:   string | null
}

export const FOLLOW_UP_SELECT =
  "follow_up_at, follow_up_by, follow_up_note, follow_up_set_at, follow_up_fired_at, follow_up_done_at, last_message_at, last_message_dir"

/**
 * Estado da promessa — FONTE ÚNICA (UI, varredura e testes leem daqui).
 *
 *  none      → não há promessa
 *  answered  → o cliente falou DEPOIS de a promessa ser feita ⇒ cumpriu-se sozinha
 *  due       → deu a hora
 *  scheduled → prometido, ainda no prazo
 *
 * ⚠️ `answered` vem ANTES de `due` de propósito: cliente que voltou não vira cobrança.
 */
export type FollowUpState = "none" | "scheduled" | "due" | "answered" | "done"

export function followUpState(c: Partial<FollowUpFields>, nowMs: number = Date.now()): FollowUpState {
  if (!c.follow_up_at) return "none"
  // Cumprido vence tudo: já aconteceu, não é cobrança nem pendência — é histórico.
  if (c.follow_up_done_at) return "done"
  if (isAnsweredByContact(c)) return "answered"
  return new Date(c.follow_up_at).getTime() <= nowMs ? "due" : "scheduled"
}

/** Promessa VIVA = existe e ainda não foi cumprida. É o que conta em contador,
 *  fila e varredura — o cumprido continua VISÍVEL, mas não pendura mais nada. */
export function isFollowUpLive(c: Partial<FollowUpFields>): boolean {
  return !!c.follow_up_at && !c.follow_up_done_at
}

/** O cliente falou depois de a promessa ter sido feita? (a bola voltou pra gente) */
export function isAnsweredByContact(c: Partial<FollowUpFields>): boolean {
  if (!c.follow_up_set_at || !c.last_message_at) return false
  if (c.last_message_dir !== "in") return false
  return new Date(c.last_message_at).getTime() > new Date(c.follow_up_set_at).getTime()
}

/** Erro de validação da promessa (mensagem pronta pra UI, em PT-BR). */
export function validateFollowUpInput(dueAt: string, note?: string | null): string | null {
  const t = new Date(dueAt).getTime()
  if (!dueAt || Number.isNaN(t)) return "Data inválida"
  if (t <= Date.now()) return "Escolha um horário no futuro"
  if (t > Date.now() + FOLLOW_UP_MAX_DAYS * 86_400_000) return "Prazo longe demais (máximo 1 ano)"
  if ((note ?? "").length > FOLLOW_UP_NOTE_MAX) return `A nota passa de ${FOLLOW_UP_NOTE_MAX} caracteres`
  return null
}

// ── Apresentação ───────────────────────────────────────────────

const TZ = "America/Sao_Paulo"

/** "hoje 14:30" · "amanhã 09:00" · "seg, 25 ago" — a hora que a pessoa prometeu. */
export function formatFollowUpMoment(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso)
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
  const dia = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ })
  const hoje = dia(new Date(nowMs))
  const amanha = dia(new Date(nowMs + 86_400_000))
  if (dia(d) === hoje)   return `hoje ${hora}`
  if (dia(d) === amanha) return `amanhã ${hora}`
  const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: TZ })
  // Dentro da semana o dia da semana ajuda mais que a data ("sex" > "22 ago").
  if (d.getTime() - nowMs < 7 * 86_400_000) {
    const semana = d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: TZ }).replace(".", "")
    return `${semana} ${hora}`
  }
  return data
}

/** "há 2 dias" / "há 3h" — o tamanho do atraso, que é o que dá urgência ao chip. */
export function formatOverdue(iso: string, nowMs: number = Date.now()): string {
  const min = Math.max(1, Math.floor((nowMs - new Date(iso).getTime()) / 60_000))
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return d === 1 ? "há 1 dia" : `há ${d} dias`
}

/** "daqui a 2 horas" · "amanhã" · "daqui a 3 dias" — a distância, que é o que a
 *  pessoa confere antes de confirmar ("tão cedo assim?" / "tão longe?"). */
export function formatFollowUpDistance(iso: string, nowMs: number = Date.now()): string {
  const diff = new Date(iso).getTime() - nowMs
  const min = Math.round(diff / 60_000)
  if (min < 60)  return `daqui a ${Math.max(1, min)} min`
  const h = Math.round(min / 60)
  if (h < 24)    return h === 1 ? "daqui a 1 hora" : `daqui a ${h} horas`
  const d = Math.round(h / 24)
  if (d === 1)   return "amanhã"
  if (d < 7)     return `daqui a ${d} dias`
  const sem = Math.round(d / 7)
  return sem === 1 ? "daqui a 1 semana" : `daqui a ${sem} semanas`
}

/** Sugestões de nota — o que um atendente escreve de verdade. Clicar preenche. */
export const FOLLOW_UP_NOTE_SUGGESTIONS = [
  "Confirmar se o orçamento passou",
  "Ver se conseguiu decidir",
  "Retomar o contato",
  "Cobrar o retorno prometido",
]

export interface FollowUpChip {
  label: string
  tone:  "scheduled" | "due" | "answered" | "done"
  title: string      // tooltip: a frase inteira, pra quando o chip trunca
}

/** O que a linha da lista e o cabeçalho mostram. `null` = não há promessa. */
export function followUpChip(c: Partial<FollowUpFields>, nowMs: number = Date.now()): FollowUpChip | null {
  const state = followUpState(c, nowMs)
  if (state === "none" || !c.follow_up_at) return null
  if (state === "done") {
    const quando = formatFollowUpMoment(c.follow_up_at, nowMs)
    return { label: "cumprido", tone: "done", title: `Follow-up de ${quando}, cumprido` }
  }
  if (state === "answered") {
    return { label: "cliente respondeu", tone: "answered", title: "O cliente voltou a falar — o follow-up já se cumpriu" }
  }
  if (state === "due") {
    const atraso = formatOverdue(c.follow_up_at, nowMs)
    return { label: `atrasado ${atraso}`, tone: "due", title: `O follow-up venceu ${atraso}` }
  }
  const quando = formatFollowUpMoment(c.follow_up_at, nowMs)
  return { label: `volta ${quando}`, tone: "scheduled", title: `Follow-up marcado pra ${quando}` }
}

// ── Atalhos do "Adiar até…" ────────────────────────────────────

export interface FollowUpPreset { key: string; label: string; at: () => Date }

/** Próxima ocorrência de `hour` (0-23) em `days` dias, no fuso do tenant. */
function emDias(days: number, hour: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d
}

/**
 * Atalhos da rotina de atendimento (owner delegou a escolha, 2026-08-20).
 * "Em 2 horas" cobre o *ainda hoje*; "amanhã" e "3 dias" são a cadência natural
 * de quem espera resposta; "segunda" é o que se promete numa sexta à tarde.
 */
export const FOLLOW_UP_PRESETS: FollowUpPreset[] = [
  { key: "2h",     label: "Em 2 horas",  at: () => new Date(Date.now() + 2 * 3_600_000) },
  { key: "amanha", label: "Amanhã 9h",   at: () => emDias(1, 9) },
  { key: "3d",     label: "Em 3 dias",   at: () => emDias(3, 9) },
  { key: "seg",    label: "Segunda 9h",  at: () => {
      const d = new Date()
      const falta = (8 - d.getDay()) % 7 || 7      // sempre a PRÓXIMA segunda
      d.setDate(d.getDate() + falta)
      d.setHours(9, 0, 0, 0)
      return d
    } },
]

/** `value` de <input type="datetime-local"> a partir de uma data (hora local). */
export function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
