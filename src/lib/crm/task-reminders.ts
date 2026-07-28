import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { createNotification } from "@/lib/notifications"
import { hasModule } from "@/lib/modules"

// ═══════════════════════════════════════════════════════════════
// CRM — varredura de lembretes de TAREFA (pg_cron)
// ═══════════════════════════════════════════════════════════════
// Uma tarefa é interna ("ligar pra confirmar a proposta"). No vencimento o
// lembrete CUTUCA O RESPONSÁVEL (notificação in-app — o sininho), não manda
// WhatsApp pro cliente. Idempotente por `reminded_at`. Best-effort: nunca lança.
//
// Gating: tasks só nascem com o módulo `crm` ligado; o sweep revalida por tenant.

const SWEEP_MAX = 500          // teto por varredura (a cada 5 min)
const GRACE_MS  = 0            // dispara assim que vence (sem janela de carência)

interface DueTask {
  id: string; tenant_id: string; title: string; due_at: string
  assigned_to: string | null; deal_id: string | null; contact_id: string | null
}

export async function runTaskReminderSweep(): Promise<{ notified: number; skipped: number }> {
  const now = Date.now()
  const { data } = await supabaseAdmin.from("tenant_tasks")
    .select("id, tenant_id, title, due_at, assigned_to, deal_id, contact_id")
    .eq("status", "pending")
    .is("reminded_at", null)
    .not("due_at", "is", null)
    .lte("due_at", new Date(now - GRACE_MS).toISOString())
    .order("due_at", { ascending: true })
    .limit(SWEEP_MAX)

  const tasks = (data ?? []) as DueTask[]
  let notified = 0, skipped = 0
  const moduleCache = new Map<string, boolean>()

  for (const tk of tasks) {
    // Idempotência: marca SEMPRE (mesmo quando não notifica) pra não re-varrer eternamente.
    await supabaseAdmin.from("tenant_tasks").update({ reminded_at: new Date().toISOString() }).eq("id", tk.id)

    if (!tk.assigned_to) { skipped++; continue }
    let on = moduleCache.get(tk.tenant_id)
    if (on === undefined) { on = await hasModule(tk.tenant_id, "crm"); moduleCache.set(tk.tenant_id, on) }
    if (!on) { skipped++; continue }

    try {
      await createNotification({
        tenantId: tk.tenant_id, recipientId: tk.assigned_to, type: "task_due",
        title: `Tarefa: ${tk.title}`,
        body: "Venceu agora — hora do follow-up.",
        payload: { task_id: tk.id, deal_id: tk.deal_id, contact_id: tk.contact_id },
      })
      notified++
    } catch (e) {
      console.error("[crm] task reminder:", e instanceof Error ? e.message : e)
      skipped++
    }
  }
  return { notified, skipped }
}
