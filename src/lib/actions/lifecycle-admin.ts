"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { transitionLifecycleCore } from "@/lib/lifecycle-core"
import type { LifecycleAction, LifecycleState } from "@/lib/lifecycle-shared"

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

/**
 * Server Action da transição de ciclo de vida (god mode UI). SEMPRE exige platform admin.
 *
 * ⚠️ A lógica (e o flag `system` do cron) vive em `transitionLifecycleCore` (server-only,
 * não-action) — corrigido 2026-07-30 (crítico C-01): antes o `opts.system` pulava o gate
 * NUMA action pública, deixando qualquer um suspender/desativar qualquer tenant. O cron
 * NÃO chama esta action; chama o core direto. Aqui NÃO existe `system`, de propósito.
 *
 * @param opts.days  só pra `extend`/`start_trial` — dias de trial.
 */
export async function transitionLifecycle(
  tenantId: string,
  action: LifecycleAction,
  opts?: { days?: number },
): Promise<{ error?: string; to?: LifecycleState }> {
  const session = await requirePlatformAdmin()
  const r = await transitionLifecycleCore(tenantId, action, {
    days:       opts?.days,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
  })
  if (!r.error) {
    revalidatePath("/admin/tenants")
    revalidatePath(`/admin/tenants/${tenantId}`)
  }
  return r
}
