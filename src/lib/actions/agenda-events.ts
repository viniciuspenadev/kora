"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { requireModule } from "@/lib/modules"

// ═══════════════════════════════════════════════════════════════
// Agenda — EVENTO INTERNO da equipe (docs/agenda-design.md · pedido 2026-08-20)
// ═══════════════════════════════════════════════════════════════
// Evento = compromisso da EQUIPE (reunião, treinamento, almoço): título livre,
// hora e responsável. Sem cliente e sem serviço — por isso não é `appointment`
// (aquela exige contato + catálogo, tem status de confirmação e lembrete que
// FALA COM O CLIENTE).
//
// Visibilidade: tenant-wide, de propósito — é compromisso da equipe. A escada de
// níveis da agenda protege compromisso DE CLIENTE; esta tabela não tem cliente.
//
// Todo acesso: tenant da SESSÃO, `requireModule("agenda")`, allow-list de colunas.

export interface EventRow {
  id:          string
  title:       string
  starts_at:   string
  ends_at:     string
  owner_id:    string | null
  resource_id: string | null
  notes:       string | null
  blocks_overlap: boolean
  created_by:  string | null
}

const TITULO_MAX = 120
const NOTA_MAX   = 500

/** Escopo + gate de módulo. `requireModule` lança se o tenant não tem `agenda` —
 *  action é endpoint POST e precisa barrar sozinha, não basta a página barrar. */
async function escopoDaAgenda() {
  const s = await getViewerScope()
  await requireModule("agenda")
  return s
}

/** Anti-IDOR: o recurso é deste tenant? (null = evento sem coluna dona, ok) */
async function recursoValido(tenantId: string, resourceId: string | null): Promise<boolean> {
  if (!resourceId) return true
  const { data } = await supabaseAdmin
    .from("tenant_resources").select("id")
    .eq("tenant_id", tenantId).eq("id", resourceId).maybeSingle()
  return !!data
}

/** Anti-IDOR: o responsável é membro ATIVO deste tenant? (null = sem dono, ok) */
async function membroValido(tenantId: string, userId: string | null): Promise<boolean> {
  if (!userId) return true
  const { data } = await supabaseAdmin
    .from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true).maybeSingle()
  return !!data
}

function validar(input: { title: string; startsAt: string; endsAt: string; notes?: string | null }): string | null {
  if (!input.title.trim())            return "Dê um título ao evento"
  if (input.title.length > TITULO_MAX) return `O título passa de ${TITULO_MAX} caracteres`
  const ini = new Date(input.startsAt).getTime()
  const fim = new Date(input.endsAt).getTime()
  if (Number.isNaN(ini) || Number.isNaN(fim)) return "Data inválida"
  if (fim <= ini)                     return "O fim tem que ser depois do início"
  if (fim - ini > 30 * 86_400_000)    return "Evento longo demais (máximo 30 dias)"
  if ((input.notes ?? "").length > NOTA_MAX) return `A descrição passa de ${NOTA_MAX} caracteres`
  return null
}

/** Eventos internos da janela — o quadro e o "Meu dia" leem daqui. */
export async function listEvents(input: { rangeStart: string; rangeEnd: string }): Promise<EventRow[]> {
  const s = await escopoDaAgenda()
  const { data } = await supabaseAdmin
    .from("tenant_events")
    .select("id, title, starts_at, ends_at, owner_id, resource_id, notes, blocks_overlap, created_by")
    .eq("tenant_id", s.tenantId)
    .lt("starts_at", input.rangeEnd)
    .gt("ends_at", input.rangeStart)
    .order("starts_at")
  return (data ?? []) as EventRow[]
}

export async function createEvent(input: {
  title:      string
  startsAt:   string
  endsAt:     string
  /** Responsável — default: quem está criando. */
  ownerId?:   string | null
  resourceId?: string | null
  notes?:     string | null
}): Promise<{ id: string } | { error: string }> {
  const s = await escopoDaAgenda()

  const invalido = validar(input)
  if (invalido) return { error: invalido }

  const ownerId    = input.ownerId ?? s.userId
  const resourceId = input.resourceId ?? null
  if (!(await recursoValido(s.tenantId, resourceId))) return { error: "Agenda inválida" }
  if (!(await membroValido(s.tenantId, ownerId)))     return { error: "Responsável não é deste time" }

  const { data, error } = await supabaseAdmin
    .from("tenant_events")
    .insert({
      tenant_id:   s.tenantId,
      title:       input.title.trim().slice(0, TITULO_MAX),
      starts_at:   new Date(input.startsAt).toISOString(),
      ends_at:     new Date(input.endsAt).toISOString(),
      owner_id:    ownerId,
      resource_id: resourceId,
      notes:       input.notes?.trim().slice(0, NOTA_MAX) || null,
      created_by:  s.userId,
    })
    .select("id")
    .single()

  if (error || !data) return { error: error?.message ?? "Não consegui criar o evento" }
  revalidatePath("/agenda")
  return { id: (data as { id: string }).id }
}

/** Editar: allow-list explícita de colunas (nunca espalha objeto do cliente). */
export async function updateEvent(
  id: string,
  patch: { title?: string; startsAt?: string; endsAt?: string; ownerId?: string | null; resourceId?: string | null; notes?: string | null },
): Promise<{ ok: true } | { error: string }> {
  const s = await escopoDaAgenda()

  const { data: atual } = await supabaseAdmin
    .from("tenant_events").select("id, title, starts_at, ends_at, owner_id, created_by")
    .eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  const cur = atual as { title: string; starts_at: string; ends_at: string; owner_id: string | null; created_by: string | null } | null
  if (!cur) return { error: "Evento não encontrado" }
  if (!podeMexer(s, cur)) return { error: "Só o responsável, quem criou ou um admin pode alterar" }

  const alvo = {
    title:    patch.title    ?? cur.title,
    startsAt: patch.startsAt ?? cur.starts_at,
    endsAt:   patch.endsAt   ?? cur.ends_at,
    notes:    patch.notes,
  }
  const invalido = validar(alvo)
  if (invalido) return { error: invalido }

  if (patch.resourceId !== undefined && !(await recursoValido(s.tenantId, patch.resourceId))) {
    return { error: "Agenda inválida" }
  }
  if (patch.ownerId !== undefined && !(await membroValido(s.tenantId, patch.ownerId))) {
    return { error: "Responsável não é deste time" }
  }

  const campos: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title      !== undefined) campos.title       = patch.title.trim().slice(0, TITULO_MAX)
  if (patch.startsAt   !== undefined) campos.starts_at   = new Date(patch.startsAt).toISOString()
  if (patch.endsAt     !== undefined) campos.ends_at     = new Date(patch.endsAt).toISOString()
  if (patch.ownerId    !== undefined) campos.owner_id    = patch.ownerId
  if (patch.resourceId !== undefined) campos.resource_id = patch.resourceId
  if (patch.notes      !== undefined) campos.notes       = patch.notes?.trim().slice(0, NOTA_MAX) || null

  const { error } = await supabaseAdmin
    .from("tenant_events").update(campos)
    .eq("id", id).eq("tenant_id", s.tenantId)
  if (error) return { error: error.message }

  revalidatePath("/agenda")
  return { ok: true }
}

export async function deleteEvent(id: string): Promise<{ ok: true } | { error: string }> {
  const s = await escopoDaAgenda()

  const { data } = await supabaseAdmin
    .from("tenant_events").select("owner_id, created_by")
    .eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  const cur = data as { owner_id: string | null; created_by: string | null } | null
  if (!cur) return { error: "Evento não encontrado" }
  if (!podeMexer(s, cur)) return { error: "Só o responsável, quem criou ou um admin pode excluir" }

  await supabaseAdmin.from("tenant_events").delete().eq("id", id).eq("tenant_id", s.tenantId)
  revalidatePath("/agenda")
  return { ok: true }
}

// ── interno ────────────────────────────────────────────────────
// Não exportado: função exportada de "use server" vira ação pública (C-01..C-04).
/** Todo mundo VÊ (é da equipe); mexer é de quem tem dono no assunto. */
function podeMexer(
  s: { userId: string; isAdmin: boolean },
  ev: { owner_id: string | null; created_by: string | null },
): boolean {
  return s.isAdmin || ev.owner_id === s.userId || ev.created_by === s.userId
}
