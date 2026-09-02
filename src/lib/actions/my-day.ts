"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, applyVisibilityFilter } from "@/lib/visibility"
import { hasModule } from "@/lib/modules"
import { listAppointments } from "@/lib/actions/agenda"
import { followUpState, type FollowUpFields } from "@/lib/atendimento/followup-rules"

// ═══════════════════════════════════════════════════════════════
// "Meu dia" — o painel do ícone de agenda na topbar (§5 S4 do doc)
// ═══════════════════════════════════════════════════════════════
// UMA lista com os dois tipos de compromisso do atendente:
//   • follow-up  = promessa de voltar a falar com o cliente (compromisso INTERNO)
//   • agendamento = compromisso COM o cliente (módulo Agenda)
//
// 🔑 União na LEITURA, não no banco (§2.3 do doc). Follow-up não vira `appointment`:
//    aquela tabela exige recurso + contato, entra em disponibilidade e tem lembrete
//    que fala com o cliente. E `agenda` é licenciável enquanto o inbox é core — o
//    follow-up não pode depender dela pra existir. Aqui elas só se encontram na tela.
//
// Visibilidade: cada fonte usa a régua da SUA casa. Follow-up passa por
// `applyVisibilityFilter` (regra por-atendente da conversa); agendamento vem de
// `listAppointments`, que já aplica a escada de níveis da agenda (inclusive
// reduzir a "Ocupado" quando o viewer só tem livre/ocupado). Nenhuma regra nova.

/** Janela padrão do painel: o que já venceu + os próximos 7 dias. O painel pede
 *  mais (30) pra dar horizonte — sem isso a pessoa não enxerga o que vem depois
 *  desta semana, que foi a queixa do dono ("não tem nem questão de ver futuros"). */
const HORIZONTE_DIAS = 7
const HORIZONTE_MAX  = 90
const MAX_FOLLOWUPS  = 200

export interface DayItem {
  kind:      "followup" | "appointment"
  /** conversationId (follow-up) ou appointmentId (agendamento). */
  id:        string
  /** Quando acontece / venceu. ISO. */
  at:        string
  title:     string
  subtitle:  string | null
  /** Dono do compromisso — usado no modo Equipe. */
  ownerId:   string | null
  ownerName: string | null
  /** Destino do clique (caminho interno). */
  href:      string
  /** Foto do contato — a linha mostra QUEM é, não um ícone genérico. */
  avatarUrl?: string | null
  /** Só follow-up: o cliente já respondeu antes da hora. */
  answered?: boolean
  /** Só follow-up: já foi CUMPRIDO. Continua na lista como histórico — riscado,
   *  fora dos contadores. Some da lista só quando uma promessa nova nasce. */
  done?:     boolean
}

export interface MyDay {
  items: DayItem[]
  /** O viewer enxerga a aba Equipe? (admin/owner, supervisor geral ou de setor) */
  canSeeTeam: boolean
  /** A Agenda está ligada pra este tenant? (senão a lista é só de follow-ups) */
  agendaOn: boolean
}

interface ContatoEmbed {
  custom_name: string | null; push_name: string | null; phone_number: string | null
  profile_pic_url?: string | null
}
interface ConvRow extends FollowUpFields {
  id: string
  chat_contacts?: ContatoEmbed | ContatoEmbed[] | null
}

const contatoDe = (row: ConvRow): ContatoEmbed | null =>
  (Array.isArray(row.chat_contacts) ? row.chat_contacts[0] : row.chat_contacts) ?? null

function nomeDoContato(row: ConvRow): string {
  const c = contatoDe(row)
  return c?.custom_name?.trim() || c?.push_name?.trim() || c?.phone_number || "Conversa"
}

/** Linha crua de agendamento: os embeds existem, mas o tipo público não os declara. */
interface ApptRaw {
  id: string; starts_at: string; status: string; busy_only?: boolean
  conversation_id: string | null; created_by: string | null
  chat_contacts?: { push_name?: string | null; custom_name?: string | null; profile_pic_url?: string | null }
                | { push_name?: string | null; custom_name?: string | null; profile_pic_url?: string | null }[] | null
  tenant_services?: { name?: string | null } | { name?: string | null }[] | null
  tenant_resources?: { name?: string | null; assigned_agent_id?: string | null } | { name?: string | null; assigned_agent_id?: string | null }[] | null
}
const um = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

/**
 * Follow-ups do viewer numa janela — pra a página /agenda mostrá-los como
 * **compromissos internos**, ao lado dos agendamentos (§6.4 do doc).
 *
 * Só os DELE, de propósito: a promessa é compromisso pessoal, e despejar as de
 * todo mundo afogaria o calendário de quem supervisiona. Quem quer a visão da
 * equipe tem a aba Equipe no "Meu dia".
 */
export async function getDayFollowUps(input: { rangeStart: string; rangeEnd: string }): Promise<DayItem[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const s = await getViewerScope()

  let q = supabaseAdmin
    .from("chat_conversations")
    .select("id, follow_up_at, follow_up_by, follow_up_note, follow_up_set_at, follow_up_fired_at, follow_up_done_at, last_message_at, last_message_dir, chat_contacts ( custom_name, push_name, phone_number, profile_pic_url )")
    .eq("tenant_id", s.tenantId)
    .eq("is_group", false)
    .is("archived_at", null)
    .eq("follow_up_by", s.userId)
    .not("follow_up_at", "is", null)
    .gte("follow_up_at", input.rangeStart)
    .lte("follow_up_at", input.rangeEnd)
  q = applyVisibilityFilter(q, s)
  const { data } = await q.order("follow_up_at", { ascending: true }).limit(MAX_FOLLOWUPS)

  const agora = Date.now()
  return ((data ?? []) as unknown as ConvRow[]).map((r) => ({
    kind:      "followup" as const,
    id:        r.id,
    at:        r.follow_up_at!,
    title:     nomeDoContato(r),
    subtitle:  r.follow_up_note,
    ownerId:   r.follow_up_by,
    ownerName: null,
    href:      `/inbox?conversation=${r.id}`,
    avatarUrl: contatoDe(r)?.profile_pic_url ?? null,
    done:      !!r.follow_up_done_at,
    answered:  followUpState(r, agora) === "answered",
  }))
}

export async function getMyDay(input?: { scope?: "me" | "team"; horizonDays?: number }): Promise<MyDay> {
  const session = await auth()
  if (!session?.user?.tenantId) return { items: [], canSeeTeam: false, agendaOn: false }

  const s = await getViewerScope()
  const canSeeTeam = s.isAdmin || s.viewAll || s.supervisesDepartments.length > 0
  // Fail-closed: pedir "equipe" sem ser supervisor devolve a SUA lista, não a de todos.
  const team = input?.scope === "team" && canSeeTeam

  // Horizonte pedido pelo painel, com teto — janela vem do cliente, então limita.
  const dias  = Math.min(HORIZONTE_MAX, Math.max(1, Math.floor(input?.horizonDays ?? HORIZONTE_DIAS)))
  const agora = Date.now()
  const ate   = new Date(agora + dias * 86_400_000).toISOString()
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)

  // ── 1. Follow-ups (promessas) ────────────────────────────────
  let q = supabaseAdmin
    .from("chat_conversations")
    .select("id, follow_up_at, follow_up_by, follow_up_note, follow_up_set_at, follow_up_fired_at, follow_up_done_at, last_message_at, last_message_dir, chat_contacts ( custom_name, push_name, phone_number, profile_pic_url )")
    .eq("tenant_id", s.tenantId)
    .eq("is_group", false)
    .is("archived_at", null)
    .not("follow_up_at", "is", null)
    .lte("follow_up_at", ate)
  if (!team) q = q.eq("follow_up_by", s.userId)
  // A régua da conversa vale mesmo pro supervisor: ele vê o que ele já veria no inbox.
  q = applyVisibilityFilter(q, s)
  const { data: convs } = await q.order("follow_up_at", { ascending: true }).limit(MAX_FOLLOWUPS)

  const rows = (convs ?? []) as unknown as ConvRow[]

  // Nome de QUEM AGENDOU. Pedido do dono: a lista tem que dizer de quem é o
  // compromisso — o admin abre o painel e vê promessas de várias pessoas.
  // Só o SEU nome é omitido (dizer "Ana" na lista da Ana é ruído).
  const nomes = new Map<string, string>()
  const ids = Array.from(new Set(rows.map((r) => r.follow_up_by).filter((id) => id && id !== s.userId))) as string[]
  if (ids.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) nomes.set(p.id, p.full_name ?? "—")
  }

  const items: DayItem[] = rows.map((r) => ({
    kind:      "followup" as const,
    id:        r.id,
    at:        r.follow_up_at!,
    title:     nomeDoContato(r),
    subtitle:  r.follow_up_note,
    ownerId:   r.follow_up_by,
    ownerName: r.follow_up_by ? nomes.get(r.follow_up_by) ?? null : null,
    href:      `/inbox?conversation=${r.id}`,
    avatarUrl: contatoDe(r)?.profile_pic_url ?? null,
    done:      !!r.follow_up_done_at,
    answered:  followUpState(r, agora) === "answered",
  }))

  // ── 2. Agendamentos (só se o tenant tem o módulo) ────────────
  const agendaOn = await hasModule(s.tenantId, "agenda")
  if (agendaOn) {
    try {
      const appts = (await listAppointments({
        rangeStart: hoje0.toISOString(),
        rangeEnd:   ate,
      })) as unknown as ApptRaw[]

      for (const a of appts) {
        if (a.status === "canceled" || a.status === "done") continue
        const recurso = um(a.tenant_resources)
        // Modo "meu": o compromisso é meu se o recurso é meu ou se eu o criei.
        // (O que eu POSSO ver já foi decidido pela escada de níveis da agenda.)
        if (!team && recurso?.assigned_agent_id !== s.userId && a.created_by !== s.userId) continue

        const contato = um(a.chat_contacts)
        const servico = um(a.tenant_services)
        items.push({
          kind:      "appointment",
          id:        a.id,
          at:        a.starts_at,
          // `busy_only` = o servidor já removeu a PII; não reconstituir nada aqui.
          title:     a.busy_only ? "Ocupado" : (contato?.custom_name?.trim() || contato?.push_name?.trim() || "Compromisso"),
          subtitle:  a.busy_only ? null : (servico?.name ?? recurso?.name ?? null),
          // `busy_only` = PII removida no servidor; não reconstituir nem a foto.
          avatarUrl: a.busy_only ? null : (contato?.profile_pic_url ?? null),
          ownerId:   recurso?.assigned_agent_id ?? null,
          // Idem: de quem é a agenda — omitido quando é a sua.
          ownerName: recurso?.assigned_agent_id === s.userId ? null : (recurso?.name ?? null),
          href:      a.conversation_id ? `/inbox?conversation=${a.conversation_id}` : "/agenda",
        })
      }
    } catch (e) {
      // Agenda indisponível não derruba o painel — os follow-ups continuam valendo.
      console.error("[my-day] agenda:", e instanceof Error ? e.message : e)
    }
  }

  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return { items, canSeeTeam, agendaOn }
}
