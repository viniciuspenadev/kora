// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nó AGENDAR (determinístico, ZERO token)
// ═══════════════════════════════════════════════════════════════
// Mesma espinha do nó Menu (oferta → espera → resume → ramifica), mas as
// opções são DINÂMICAS (horários reais do motor) e o "escolher" tem efeito
// colateral (marca de fato + re-valida anti-double-book). Reusa o núcleo
// server-less da agenda (booking.ts) → roteamento idêntico ao da IA.
// Dual-stack: lista nativa no Meta (a janela está aberta — o cliente está no
// fluxo) / numerado no Baileys. Doc: docs/agenda-design.md §5 + agenda-routing.md.

import "server-only"
import { sendBotText, sendBotInteractive } from "../outbound"
import type { ExecCtx } from "../capabilities/types"
import type { ScheduleNodeConfig } from "./types"
import { resolveAgendaTargets, availabilityPool, pickFreeInPool, bookAppointment } from "@/lib/agenda/booking"

const TZ = "America/Sao_Paulo"
const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]
const NONE_ID = "schedule:none"
const NONE_LABEL = "Nenhum desses"

const HORIZON_DEFAULT = 21
const MAXSLOTS_DEFAULT = 6
const MAXSLOTS_CAP = 9          // +1 "nenhum" ≤ 10 (limite de rows da lista Meta)

/** "sex 12/06 às 14h00" — legível e ≤24 chars (cabe no title da row Meta). */
export function fmtSlot(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
  return `${wd} ${dm} às ${hm}`
}

function numberedText(intro: string, slots: string[]): string {
  return [
    intro,
    "",
    ...slots.map((s, i) => `${NUM_EMOJI[i] ?? `${i + 1}.`} ${fmtSlot(s)}`),
    `0️⃣ ${NONE_LABEL}`,
  ].join("\n")
}

/** Envia a oferta de horários pelo veículo do canal (interativo nativo → fallback texto). */
export async function sendScheduleOffer(ctx: ExecCtx, intro: string | undefined, slots: string[]): Promise<void> {
  const body = (intro?.trim()) || "Escolha o melhor horário:"
  const text = numberedText(body, slots)
  const rows = slots.map((s, i) => ({ id: `schedule:slot:${i}`, title: fmtSlot(s) }))
  const all = [...rows, { id: NONE_ID, title: NONE_LABEL }]
  const payload = all.length <= 3
    ? { body, buttons: all }
    : { body, list: { buttonText: "Ver horários", sections: [{ rows: all }] } }
  const sent = await sendBotInteractive(ctx, payload, text, {
    studio_schedule: true, interactive_kind: all.length <= 3 ? "button" : "list",
  })
  if (!sent) await sendBotText(ctx, text, { studio_schedule: true })
}

export type SchedulePick = { kind: "slot"; index: number } | { kind: "none" }

/** Casa a resposta → horário escolhido. Tap (título exato) > "nenhum"/0 > número digitado. */
export function parseSchedulePick(reply: string, slots: string[]): SchedulePick | null {
  const r = reply.trim().toLowerCase()
  if (!r) return null
  // 1) tap exato no título (Meta) — prioridade: evita colidir com o número da data.
  for (let i = 0; i < slots.length; i++) if (r === fmtSlot(slots[i]).toLowerCase()) return { kind: "slot", index: i }
  // 2) "nenhum"/0/outro/não.
  if (/\b0\b/.test(r) || /(nenhum|nenhuma|outro|outra|outros|mais|n[aã]o)/.test(r)) return { kind: "none" }
  // 3) número digitado (1-based).
  const num = r.match(/\d+/)
  if (num) { const idx = parseInt(num[0], 10) - 1; if (idx >= 0 && idx < slots.length) return { kind: "slot", index: idx } }
  return null
}

export interface ScheduleOffer { slots: string[]; serviceId: string | null; pool: string[] }

/** Resolve destino + calcula a UNIÃO de horários do pool (ou null se sem destino). */
export async function prepareScheduleOffer(ctx: ExecCtx, cfg: ScheduleNodeConfig): Promise<ScheduleOffer | null> {
  const t = cfg.target
  const res = await resolveAgendaTargets(ctx.tenantId, {
    mode:           t?.mode === "owner" ? "owner" : "fixed",
    serviceId:      t?.serviceId ?? null,
    resourceId:     t?.resourceId ?? null,
    conversationId: ctx.conversationId,
  })
  if (res.error || res.pool.length === 0) return null   // fail-closed → ramo "sem_horario"
  const now = Date.now()
  const horizon = Math.max(1, cfg.horizonDays ?? HORIZON_DEFAULT)
  const merged = await availabilityPool(ctx.tenantId, {
    pool: res.pool, serviceId: res.serviceId,
    rangeStart: new Date(now).toISOString(),
    rangeEnd:   new Date(now + horizon * 86_400_000).toISOString(),
  })
  const max = Math.min(Math.max(1, cfg.maxSlots ?? MAXSLOTS_DEFAULT), MAXSLOTS_CAP)
  return { slots: merged.slice(0, max).map((s) => s.start), serviceId: res.serviceId, pool: res.pool }
}

/** Re-valida o slot no pool e MARCA. `taken` = encheu agora (re-oferecer); `id` = sucesso. */
export async function bookSchedulePick(
  ctx: ExecCtx, input: { iso: string; serviceId: string | null; pool: string[] },
): Promise<{ id?: string; taken?: boolean; error?: string }> {
  const resourceId = await pickFreeInPool(ctx.tenantId, { pool: input.pool, serviceId: input.serviceId, startsAt: input.iso })
  if (!resourceId) return { taken: true }
  if (ctx.dryRun) return {}   // simulador: valida disponibilidade, não escreve
  const r = await bookAppointment(ctx.tenantId, {
    contactId: ctx.contact.id, conversationId: ctx.conversationId,
    resourceId, serviceId: input.serviceId, startsAt: input.iso,
    source: "manual", createdBy: null, conversationalConfirm: true,
  })
  if (r.error) return /preenchido|lotado|bloqueado/i.test(r.error) ? { taken: true } : { error: r.error }
  return { id: r.id }
}
