import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { revokeTenantAccess, type RevokeTenantAccessResult } from "@/lib/auth/revoke-tenant-access"
import { pausarCanaisDoTenant, canaisDerrubados, type ResultadoPausa } from "@/lib/channels/pause"
import { TRANSITIONS, normalizeState, type LifecycleAction, type LifecycleState } from "@/lib/lifecycle-shared"
import { cancelSubscriptionForTenant } from "@/lib/asaas/subscriptions"

const DAY = 86_400_000

/**
 * CORE da transição de ciclo de vida — server-only, **NÃO é Server Action** (de propósito).
 *
 * ⚠️ Corrigido 2026-07-30 (crítico C-01): antes esta lógica vivia numa Server Action
 * exportada (`transitionLifecycle`) com um flag `opts.system` que PULAVA o gate de platform
 * admin. Como toda export de "use server" é chamável publicamente, qualquer um forjava a
 * chamada com `{system:true}` + tenantId alheio → suspendia/desativava qualquer cliente.
 *
 * Agora o `system` (usado pelo cron de trial) vive AQUI, num módulo server-only que só código
 * do servidor importa — inalcançável por RSC. A action pública ([lifecycle-admin.ts]) é um
 * wrapper que SEMPRE exige platform admin antes de chamar isto. (ver database-rules §2)
 *
 * @param opts.system  chamado pelo cron (sem sessão) — relaxa a máquina de estados p/ 'suspend'.
 * @param opts.actorId/actorEmail  identidade pro audit (admin no caminho UI; null/cron no system).
 */
export async function transitionLifecycleCore(
  tenantId: string,
  action: LifecycleAction,
  opts?: {
    days?: number
    system?: boolean
    actorId?: string | null
    actorEmail?: string | null
    /** CAS de modalidade para automações que só podem agir em um tipo de cobrança. */
    expectedBillingMode?: "gateway" | "manual"
  },
): Promise<{ error?: string; to?: LifecycleState }> {
  const tenantQuery = supabaseAdmin
    .from("tenants")
    .select("id, name, lifecycle_state, active, trial_ends_at, activated_at, plan_id, billing_mode, plans:plan_id ( trial_days )")
    .eq("id", tenantId)
  const { data: t } = opts?.expectedBillingMode
    ? await tenantQuery.eq("billing_mode", opts.expectedBillingMode).maybeSingle()
    : await tenantQuery.maybeSingle()
  if (!t) return { error: "Cliente não encontrado." }

  const from = normalizeState(t.lifecycle_state as string | null)
  const def  = TRANSITIONS[from].find((d) => d.action === action)
  // O cron usa 'suspend' (trial vencido) — permitido a partir de trialing/active.
  if (!def && !opts?.system) return { error: `Transição inválida: "${action}" a partir de "${from}".` }

  const planRel  = (t as { plans?: { trial_days?: number } | { trial_days?: number }[] | null }).plans
  const trialDays = (Array.isArray(planRel) ? planRel[0]?.trial_days : planRel?.trial_days) ?? 0
  const now    = Date.now()
  const nowIso = new Date(now).toISOString()
  const keepActivatedAt = (t.activated_at as string | null) ?? nowIso

  const patch: Record<string, unknown> = {}
  let to: LifecycleState

  switch (action) {
    case "approve": {
      const hasTrial = t.billing_mode === "gateway" && trialDays > 0
      to = hasTrial ? "trialing" : "active"
      patch.active = true
      patch.lifecycle_state = to
      patch.activated_at = keepActivatedAt
      patch.trial_ends_at = hasTrial ? new Date(now + trialDays * DAY).toISOString() : null
      break
    }
    case "activate":
      to = "active"
      patch.active = true; patch.lifecycle_state = "active"; patch.trial_ends_at = null
      patch.activated_at = keepActivatedAt
      break
    case "extend": {
      to = "trialing"
      const cur = t.trial_ends_at ? new Date(t.trial_ends_at).getTime() : 0
      const base = cur > now ? cur : now   // estende a partir do fim atual, ou de hoje se já venceu
      const days = Math.max(1, Math.min(365, Math.round(opts?.days ?? 7)))
      patch.active = true; patch.lifecycle_state = "trialing"
      patch.trial_ends_at = new Date(base + days * DAY).toISOString()
      break
    }
    case "start_trial": {
      // Coloca/reativa em trial com prazo a partir de HOJE (active/suspended/deactivated → trialing).
      to = "trialing"
      const days = Math.max(1, Math.min(365, Math.round(opts?.days ?? (trialDays > 0 ? trialDays : 7))))
      patch.active = true; patch.lifecycle_state = "trialing"; patch.activated_at = keepActivatedAt
      patch.trial_ends_at = new Date(now + days * DAY).toISOString()
      break
    }
    case "end_trial":
      // ⚠️ `active` continua TRUE: o tenant existe e o dono precisa entrar pra pagar.
      //    Quem barra o atendente é `isTenantBlockedForAccessAs`, pelo PAPEL — e quem
      //    corta campanha/IA/automação é `SPEND_BLOCKED_LIFECYCLE`.
      // ⚠️ `trial_ends_at` **NÃO é limpo**: ele vira o carimbo de quando o teste venceu,
      //    e é o relógio que o housekeeping usa pra suspender depois da carência.
      to = "trial_ended"; patch.active = true; patch.lifecycle_state = "trial_ended"
      break
    case "suspend":
      to = "suspended"; patch.active = false; patch.lifecycle_state = "suspended"
      break
    case "reactivate":
      to = "active"; patch.active = true; patch.lifecycle_state = "active"
      patch.activated_at = keepActivatedAt
      break
    case "reject":
    case "deactivate":
      to = "deactivated"; patch.active = false; patch.lifecycle_state = "deactivated"
      break
    default:
      return { error: "Ação desconhecida." }
  }

  if (opts?.expectedBillingMode) {
    const { data: updated, error } = await supabaseAdmin.from("tenants")
      .update(patch)
      .eq("id", tenantId)
      .eq("billing_mode", opts.expectedBillingMode)
      .select("id")
      .maybeSingle()
    if (error) return { error: error.message }
    if (!updated) return { error: "Modalidade de cobrança mudou durante a transição." }
  } else {
    const { error } = await supabaseAdmin.from("tenants").update(patch).eq("id", tenantId)
    if (error) return { error: error.message }
  }

  // ── Cascata de revogação (2026-08-03) ──────────────────────────────────────
  // 🔴 DEPOIS da escrita do estado, nunca antes. O estado é a verdade — é ele que barra o
  //    login novo e que a revalidação de 5min consulta. A cascata só encurta a janela.
  //    Invertido, uma falha no meio deixaria "todos desconectados + conta ATIVA": todo
  //    mundo loga de volta no minuto seguinte e a trilha registra uma revogação que não
  //    aconteceu.
  // ⚠️ `revokeTenantAccess` não lança de propósito: se a limpeza falhar, o cliente segue
  //    desativado e o relógio termina o serviço. Falha vai pro audit, não pro retorno —
  //    devolver erro aqui faria a UI dizer "não consegui desativar" sobre algo já feito.
  // ⚠️ Confiança de dispositivo NÃO entra aqui (`includeDeviceTrust` fica falso): ela é por
  //    USUÁRIO, e quem atende dois clientes nossos perderia o "dispositivo confiável" no
  //    outro, que está em dia. Ela só dispensa o 2º fator — não é acesso. O botão de
  //    emergência (conta comprometida) é que liga essa parte.
  const REVOKING: ReadonlySet<LifecycleAction> = new Set(["suspend", "deactivate", "reject"])
  let revoked: RevokeTenantAccessResult | null = null
  let canais:  ResultadoPausa | null = null
  if (REVOKING.has(action)) {
    revoked = await revokeTenantAccess(tenantId)

    // 📡 E PAUSA O CANAL (12/08). A cascata cortava tudo que dá ACESSO e tudo que gera
    //    COBRANÇA — e deixava o FIO LIGADO. Medido em produção no mesmo dia: *Bernardo
    //    Concept*, `suspended` + `active=false`, com a instância baileys **conectada**.
    //    Clientes finais mandavam mensagem para um número que atendia, o webhook descartava
    //    por `canAccess`, e a mensagem sumia — o remetente via "entregue" e ninguém era
    //    avisado. A instância seguia custando na Evolution.
    // 🔑 Suspender é dizer "não presto mais serviço". Enquanto o canal responde, o produto
    //    ainda está prometendo atendimento em nome de alguém que não tem mais atendimento —
    //    e quem paga essa conta é o cliente FINAL, que não deve nada.
    // ⚠️ Best-effort, como o resto da cascata e pelo mesmo motivo. Falha vai pra trilha, não
    //    pro retorno: o estado já foi escrito e devolver erro faria a UI dizer "não consegui
    //    suspender" sobre algo já feito.
    canais = await pausarCanaisDoTenant(tenantId, action === "suspend" ? "suspensao" : "encerramento")
    if (canais.falhas.length || canais.pendentes.length) {
      console.error(JSON.stringify({
        src: "lifecycle", kind: "CANAL-NAO-PAUSADO-CONFERIR", tenant: tenantId, action,
        falhas: canais.falhas, pendentes: canais.pendentes,
      }))
    }

    // 💳 E CANCELA A COBRANÇA (05/08/2026). A cascata revogava sessão, token e push — tudo
    //    que dá ACESSO — e deixava a assinatura recorrente viva no gateway. O cliente
    //    perdia o produto e **continuava sendo debitado todo mês, indefinidamente**.
    //    Cobrar sem entregar é o pior lado possível pra errar, e não havia nenhuma chamada
    //    de cancelamento no repositório inteiro (auditoria de 05/08).
    // ⚠️ Best-effort, como o resto da cascata: o estado já foi escrito e o acesso já caiu.
    //    Falha aqui NÃO desfaz a transição — grita no log pra cancelamento manual, porque
    //    manter o cliente com acesso só porque o gateway não respondeu seria pior.
    if (t.billing_mode === "gateway") {
      const cancel = await cancelSubscriptionForTenant(tenantId)
      if ("error" in cancel) {
        console.error(JSON.stringify({
          src: "lifecycle", kind: "assinatura-NAO-cancelada", tenant: tenantId, action,
        }))
      }
    }

    // 🧾 Faturas ficam em quarentena visível. Lifecycle não conhece o ledger nem o
    // estado de cobranças externas e, portanto, não tem prova para escrever `void`.
    // Especialmente `partial` contém dinheiro real e nunca pode ser rasurada por uma cascata
    // administrativa. A anulação segura será feita por RPC sob lock, somente depois de
    // provar zero fatos financeiros e zero cobrança pagável. Até lá, aberto é mais honesto
    // e reparável que um `void` falso.
  }

  // ── O caminho de VOLTA (12/08) ─────────────────────────────────────────────
  // 🔴 CONSERTA UMA REGRESSÃO QUE A PAUSA CRIOU. Sem isto: suspende → canal derrubado →
  //    reativa → conta ativa, tela dizendo "tudo certo", e **nenhuma mensagem chegando**.
  //    Um silêncio trocado por outro.
  // 🔑 NÃO religa sozinho, de propósito: `status='disconnected'` não diz QUEM desligou, e
  //    religar sem distinguir faria a Kora se re-autorizar na conta de quem pediu pra sair.
  //    A volta automática espera o motivo carimbado (item 3 do desenho). Até lá, avisa.
  const VOLTANDO: ReadonlySet<LifecycleAction> = new Set(["reactivate", "approve", "activate", "start_trial", "extend"])
  let canaisFora: Awaited<ReturnType<typeof canaisDerrubados>> | null = null
  if (VOLTANDO.has(action)) {
    canaisFora = await canaisDerrubados(tenantId)
    if (canaisFora.length) {
      console.warn(JSON.stringify({
        src: "lifecycle", kind: "CANAL-FORA-APOS-REATIVACAO", tenant: tenantId, action,
        canais: canaisFora,
        nota: "a conta voltou mas o canal está desconectado — precisa reconectar em Integrações",
      }))
    }
  }

  await logAudit({
    tenantId,
    actorId:    opts?.actorId ?? null,
    actorEmail: opts?.actorEmail ?? (opts?.system ? "system:cron" : null),
    action:     `tenant.lifecycle.${action}`,
    targetType: "tenant",
    targetId:   tenantId,
    metadata:   {
      from, to, name: t.name, days: opts?.days ?? null, trial_ends_at: patch.trial_ends_at ?? null,
      // A contagem entra na trilha: numa disputa, "desativei" e "os acessos caíram" são
      // afirmações diferentes, e antes disto só a primeira era demonstrável.
      revoked: revoked
        ? {
            sessions:            revoked.sessions,
            extension_tokens:    revoked.extensionTokens,
            push_subscriptions:  revoked.pushSubscriptions,
            device_trust:        revoked.deviceTrust,
            errors:              revoked.errors.length ? revoked.errors : null,
          }
        : null,
      // 📡 O canal entra na trilha pelo mesmo motivo que a contagem de sessões entrou:
      //    "suspendi" e "o canal parou de receber" são afirmações diferentes, e sem isto
      //    só a primeira seria demonstrável. `pendentes` fica visível de propósito — um
      //    canal que ninguém sabe pausar não pode desaparecer do registro.
      canais: canais
        ? {
            pausados:  canais.pausados,
            falhas:    canais.falhas.length    ? canais.falhas    : null,
            pendentes: canais.pendentes.length ? canais.pendentes : null,
          }
        : null,
      // Na volta: quais canais seguem fora. Sem isto, "reativei" e "o cliente voltou a
      // receber" ficariam indistinguíveis na trilha — e são coisas diferentes.
      canais_fora: canaisFora?.length ? canaisFora : null,
    },
  })

  return { to }
}
