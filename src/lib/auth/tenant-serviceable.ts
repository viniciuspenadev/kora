import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase"
import {
  isTenantBlockedForAccess, isTenantBlockedForSpend,
  SPEND_BLOCKED_LIFECYCLE, normalizeState,
} from "@/lib/lifecycle-shared"

// ═══════════════════════════════════════════════════════════════
// GUARDA DE STATUS DO CLIENTE — "este tenant ainda pode CONSUMIR?"
// ═══════════════════════════════════════════════════════════════
// docs/entitlements-design.md §3 · docs/security.md §0.1
//
//   A licença é verificada onde a AÇÃO acontece, nunca onde ela é configurada.
//   EXECUÇÃO para na hora. LEITURA degrada.
//
// Este módulo responde SÓ à primeira metade. Ele existe pros caminhos que GASTAM —
// mandar mensagem, chamar LLM, baixar mídia pro Storage, disparar template pago —
// e que rodam FORA de uma sessão de usuário: webhook, cron, motor de fundo, widget
// público. Esses eram os quatro pontos cegos da auditoria (C-1): `tenants.active` e
// `lifecycle_state` só eram olhados no login, então suspender um cliente o deslogava
// mas não desligava o produto dele (medido: *Bernardo Concept*, suspenso, ingeriu
// 7 mensagens em 7 dias).
//
// 🔴 NÃO use isto pra gatear LEITURA (inbox, mídia, relatório, CSV). Um cliente
//    `past_due` que não consegue nem ver o histórico pra decidir se paga é churn
//    garantido — é erro de produto, não de código.
//
// 🔴 NÃO mova o gate pra ANTES do ACK de um webhook. Os três webhooks respondem 200
//    antes de processar (o trabalho vai em `after()`); a Meta re-tenta em não-2xx e,
//    com falha persistente, **desabilita a inscrição do app inteiro** — um
//    inadimplente derrubaria o canal oficial de TODOS os outros clientes.

// ── O predicado de bloqueio ────────────────────────────────────
//
// 🔒 FONTE ÚNICA: `isTenantBlocked` (lifecycle-shared.ts) — o MESMO predicado que o login
//    e a revalidação de sessão usam. A cópia temporária que morava aqui foi apagada na
//    junção (2026-08-03). Não reintroduzir uma segunda: quem decide acesso em dois lugares
//    diverge, e foi exatamente o que aconteceu enquanto as duas existiram.
//
// ⚠️ AS DUAS DIVERGIAM, e a divergência resolveu a favor da definitiva. Fica registrado
//    porque o ponto é contra-intuitivo:
//
//    • lifecycle desconhecido → BLOQUEIA nas duas. `normalizeState` é fail-CLOSED desde
//      2026-08-03 (desconhecido → `suspended`). `null`/"" segue SERVÍVEL: é o legado
//      pré-coluna, e é o estado real da *Blue Digital Hub* em produção — fechar esse ramo
//      tranca um cliente pagante (e o dono) pra fora.
//
//    • assinatura desconhecida → a cópia daqui BLOQUEAVA; a definitiva SERVE e grita no
//      log. A definitiva está certa, e a assimetria tem motivo: `lifecycle_state` é máquina
//      NOSSA — vocabulário fechado, desconhecido = corrupção, nega. `subscription_status` é
//      ESPELHO de gateway externo. Fail-closed ali significa que um status não mapeado —
//      escrito pelo webhook do gateway ANTES do deploy que o entende — corta cliente
//      adimplente sem ninguém ter decidido isso. Errar servindo um inadimplente por
//      algumas horas custa centavos; errar bloqueando quem paga derruba o WhatsApp da
//      operação dele e ninguém percebe do nosso lado.
//      Medido em 2026-08-03: os 4 tenants de produção têm `subscription_status = active`,
//      então a escolha **não muda comportamento nenhum hoje**. Ela muda no dia em que
//      plugarmos Stripe/Asaas — que é justamente quando o erro seria caro.

// ── A consulta ─────────────────────────────────────────────────

export interface TenantStatusRow {
  active:              boolean | null
  lifecycle_state:     string | null
  subscription_status: string | null
}

function serviceableFromRow(row: TenantStatusRow | null | undefined): boolean {
  if (!row) return false                    // tenant inexistente → fail-closed
  // `active` é o booleano legado, ANTERIOR à máquina de estados — o predicado não o cobre
  // de propósito (está documentado lá). Quem lê a linha do tenant checa os dois.
  // Verificado em produção (2026-08-03): nenhum tenant tem `active = null`; os dois `false`
  // são EVVICAMP e Bernardo Concept, ambos suspensos — exatamente o caso que este gate fecha.
  if (row.active !== true) return false
  // 💸 Pergunta de GASTO (inclui assinatura). O login usa a OUTRA (`...ForAccess`).
  return !isTenantBlockedForSpend(row.lifecycle_state, row.subscription_status)
}

/**
 * O tenant pode CONSUMIR agora? Uma consulta só, memoizada por request (React `cache`,
 * mesmo padrão de `hasModule` em modules.ts:93) — um cron que varre N tenants paga 1
 * SELECT por tenant DISTINTO, não por item da fila.
 *
 * **Fail-closed em tudo:** erro de banco, tenant inexistente, `active=false`, lifecycle
 * bloqueado (pending_approval/suspended/deactivated/desconhecido) ou assinatura
 * inadimplente (past_due/canceled/desconhecida) → `false`.
 *
 * ⚠️ A memoização é POR REQUEST. Num tick longo de cron, um tenant suspenso no meio da
 * execução continua servível até o próximo tick. Aceito: a janela é de um tick.
 */
export interface TenantStatusCheck {
  /** `true` = a consulta falhou. Não sabemos — não é "está bloqueado". */
  degraded: boolean
  /**
   * 🚪 "Ainda é nosso cliente?" — `active` + ciclo de vida, **sem assinatura**.
   * Suspenso/desativado ⇒ `false`. Inadimplente ⇒ **`true`** (ele continua sendo cliente).
   */
  canAccess: boolean
  /**
   * 💸 "Ainda podemos gastar por ele?" — inclui assinatura.
   * Inadimplente ⇒ `false`, mas veja `canAccess` antes de DESCARTAR qualquer coisa.
   */
  canSpend: boolean
}

/**
 * Uma consulta, **duas respostas** — porque as perguntas são duas (§2 do
 * access-revocation-design) e ter uma função só foi exatamente o defeito.
 *
 * 🔴 A ARMADILHA QUE ISTO DESARMA (achado da revisão adversarial, 2026-08-03). Os webhooks
 *    usavam a resposta de GASTO pra decidir DESCARTE. Com isso, marcar um cliente como
 *    inadimplente fazia a mensagem que o cliente final manda no WhatsApp ser **descartada e
 *    perdida pra sempre** — e a política ratificada diz o contrário: no degrau 3 *"o
 *    atendimento manual continua"*. **Não existe atendimento manual sem a mensagem chegar.**
 *    Pior: no degrau 5 (encerramento) o dado é RETIDO, e no degrau 3 ele era DESTRUÍDO — a
 *    escada invertida no degrau mais barato.
 *    Guardar a mensagem recebida é o PRODUTO, não o custo. O custo é mídia pro Storage, LLM,
 *    auto-resposta e automação — e é ISSO que `canSpend` deve podar, lá dentro.
 */
export const checkTenantStatus = cache(async (tenantId: string): Promise<TenantStatusCheck> => {
  if (!tenantId) return { degraded: false, canAccess: false, canSpend: false }
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("active, lifecycle_state, subscription_status")
    .eq("id", tenantId)
    .maybeSingle()

  if (error) {
    console.error("[tenant-status] consulta falhou:", tenantId, error.message)
    return { degraded: true, canAccess: false, canSpend: false }
  }
  const row = data as TenantStatusRow | null
  if (!row || row.active !== true) return { degraded: false, canAccess: false, canSpend: false }

  const canAccess = !isTenantBlockedForAccess(row.lifecycle_state)
  // ⚠️ `trial_ended` NÃO tira o acesso (o dono entra pra pagar) mas TIRA o gasto: campanha,
  //    IA e automação param. Sem isto o teste vencido viraria produto de graça enquanto
  //    durasse a carência — e é justamente esse custo que o prazo existe pra limitar.
  const trialAcabou = SPEND_BLOCKED_LIFECYCLE.has(normalizeState(row.lifecycle_state))
  return {
    degraded: false,
    canAccess,
    canSpend: canAccess && !trialAcabou && !isTenantBlockedForSpend(row.lifecycle_state, row.subscription_status),
  }
})

/**
 * Atalho booleano de GASTO, **fail-closed** (erro de consulta ⇒ `false`).
 *
 * ✅ Use onde bloquear por engano é barato e reversível: rotas do widget (o visitante
 *    recarrega em segundos), gates de leitura, qualquer caminho que o cliente repete.
 * 🔴 **NUNCA** use onde o "não" descarta trabalho que não volta — webhook de mensagem,
 *    evento único, qualquer coisa que ninguém re-entrega. Lá use `checkTenantStatus` e
 *    trate `degraded` (não sei ≠ está bloqueado) **e** `canAccess` (deixou de ser cliente
 *    ≠ está devendo) separadamente.
 */
export const isTenantServiceable = async (tenantId: string): Promise<boolean> =>
  (await checkTenantStatus(tenantId)).canSpend

/** Erro tipado — o chamador distingue "cliente bloqueado" de falha real de execução. */
export class TenantNotServiceableError extends Error {
  readonly tenantId: string
  readonly code = "tenant_not_serviceable" as const
  constructor(tenantId: string) {
    super("Conta indisponível.")
    this.name = "TenantNotServiceableError"
    this.tenantId = tenantId
  }
}

/**
 * Versão que lança. Use onde a continuação do caminho é um `throw`/try natural
 * (server action, handler que já tem catch). Em cron/webhook prefira o booleano:
 * lá o certo é PULAR e seguir a fila, não abortar o tick inteiro.
 */
export async function assertTenantServiceable(tenantId: string): Promise<void> {
  if (!(await isTenantServiceable(tenantId))) throw new TenantNotServiceableError(tenantId)
}

export interface ServiceableBatch {
  /** Ids que podem consumir. Quem não está aqui **não** pode. */
  serviceable: Set<string>
  /**
   * `true` = a consulta FALHOU (blip de banco), não "todos bloqueados".
   *
   * 🔴 O chamador é obrigado a distinguir: fail-closed manda pular o trabalho (e isso é
   * seguro — nada é gasto), mas **nunca** tomar decisão persistente/destrutiva em cima de
   * um resultado degradado. "Não mando a mensagem agora" é reversível; "pauso a campanha"
   * ou "adio o lote em 15min" em cima de um erro de leitura pune cliente adimplente.
   */
  degraded: boolean
}

/**
 * Versão em lote pro cron que varre muitos tenants: **uma** consulta por bloco de 200
 * (teto do tamanho da URL do PostgREST) em vez de uma por linha da fila.
 *
 * Fail-closed: qualquer erro → `serviceable` vazio + `degraded: true`.
 */
export async function filterServiceableTenants(tenantIds: Iterable<string>): Promise<ServiceableBatch> {
  const ids = [...new Set([...tenantIds].filter(Boolean))]
  const serviceable = new Set<string>()
  if (ids.length === 0) return { serviceable, degraded: false }

  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from("tenants")
      .select("id, active, lifecycle_state, subscription_status")
      .in("id", ids.slice(i, i + CHUNK))

    if (error) {
      console.error("[tenant-serviceable] lote falhou:", error.message)
      return { serviceable: new Set<string>(), degraded: true }
    }
    for (const row of (data ?? []) as Array<TenantStatusRow & { id: string }>) {
      if (serviceableFromRow(row)) serviceable.add(row.id)
    }
    // Id sem linha correspondente simplesmente não entra no Set → fail-closed de graça.
  }
  return { serviceable, degraded: false }
}
