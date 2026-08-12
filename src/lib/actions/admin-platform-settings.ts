"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"
import { invalidatePlatformSettings } from "@/lib/platform-settings"

// ═══════════════════════════════════════════════════════════════
// Configuração GLOBAL — a alteração mais alavancada do produto
// ═══════════════════════════════════════════════════════════════
//
// 🔴 UM CLIQUE AQUI MUDA O COMPORTAMENTO DE TODOS OS CLIENTES DE UMA VEZ. Não existe outra
//    tela no god mode com esse alcance: as demais agem sobre UM tenant. Por isso esta action
//    é mais rígida que as vizinhas — valida tipo, valida faixa, e **audita sempre**, com o
//    antes e o depois. Numa disputa ("quem encurtou a carência?"), é esta linha que
//    alguém vai ler.
//
// ⚠️ O `tenant_id` do audit vai `null` de propósito: o alvo é a PLATAFORMA. Carimbar um
//    tenant qualquer faria a trilha dele mentir sobre uma mudança que não foi dele.

const MIN = 0
const MAX = 90

/** Aceita só inteiro dentro da faixa. `null`/vazio não é "usa o padrão" — aqui não há padrão acima. */
function valida(n: unknown, rotulo: string): { ok: number } | { error: string } {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    return { error: `${rotulo}: informe um número inteiro de dias.` }
  }
  if (n < MIN || n > MAX) {
    return { error: `${rotulo}: use um valor entre ${MIN} e ${MAX} dias.` }
  }
  return { ok: n }
}

export async function updatePlatformSettings(input: {
  pastDueGraceDays:    number
  trialEndedGraceDays: number
}): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) return { error: "Acesso restrito a platform admin." }

  const atraso = valida(input.pastDueGraceDays, "Carência do atraso")
  if ("error" in atraso) return { error: atraso.error }
  const teste = valida(input.trialEndedGraceDays, "Carência do fim do teste")
  if ("error" in teste) return { error: teste.error }

  // 🔴 O ESTADO ANTERIOR É PRÉ-CONDIÇÃO, não enfeite (mesma lição do `updateTenantBilling`,
  //    F1 de 11/08). Sem ele a trilha registra "mudou para 5" sem dizer de quanto — e a
  //    pergunta que se faz depois é sempre "mudou de QUANTO para quanto?".
  const { data: antes, error: erroAntes } = await supabaseAdmin
    .from("platform_settings")
    .select("past_due_grace_days, trial_ended_grace_days")
    .eq("id", true)
    .maybeSingle()

  if (erroAntes) {
    console.error(JSON.stringify({
      src: "platform-settings", kind: "estado-anterior-indisponivel-acao-abortada", msg: erroAntes.message,
    }))
    return { error: "Não foi possível ler a configuração atual. Nada foi alterado — tente de novo." }
  }

  const { error } = await supabaseAdmin
    .from("platform_settings")
    // ⚠️ Colunas explícitas, nunca spread do input: este objeto vem da tela, e um campo a
    //    mais no payload não pode virar coluna escrita (§2 da skill `database-rules`).
    .update({
      past_due_grace_days:    atraso.ok,
      trial_ended_grace_days: teste.ok,
      updated_at:             new Date().toISOString(),
      updated_by:             session.user.id ?? null,
      updated_by_email:       session.user.email ?? null,
    })
    .eq("id", true)

  if (error) return { error: error.message }

  // 🔑 Limpa o cache DESTE processo pra a mudança aparecer no próximo clique do operador —
  //    sem isso ele salvaria, recarregaria, veria o valor velho e salvaria de novo.
  // ⚠️ Outras instâncias seguem com o valor antigo até o TTL de 60s vencer. Para um prazo
  //    medido em DIAS isso é irrelevante, e dizer aqui é melhor que alguém supor
  //    propagação instantânea e caçar um fantasma.
  invalidatePlatformSettings()

  await logAudit({
    tenantId:   null,
    actorId:    session.user.id ?? null,
    actorEmail: session.user.email ?? null,
    action:     "platform.settings_alterado",
    targetType: "platform",
    targetId:   "settings",
    before:     antes ?? null,
    after:      { past_due_grace_days: atraso.ok, trial_ended_grace_days: teste.ok },
  })

  revalidatePath("/admin/financeiro")
  return {}
}
