// ═══════════════════════════════════════════════════════════════
// God Mode — Helpers de módulos
// ═══════════════════════════════════════════════════════════════
// Source of truth: `module_catalog` (seed) + `tenant_modules` (overrides).
// Resolve via SQL function `tenant_has_module(uuid, text)`.
//
// Uso típico:
//
//   // Gate em server action
//   await requireModule("broadcasts")  // throws Error("Módulo não habilitado")
//
//   // Gate condicional (boolean)
//   if (await hasModule(tenantId, "ai_atendente")) { ... }
//
//   // Lista pra UI (filtrar sidebar)
//   const slugs = await getEnabledModuleSlugs(tenantId)
//
// IMPORTANTE:
//   - Core modules (is_core=true) sempre retornam true, mesmo sem linha em tenant_modules
//   - `expires_at` é respeitado pela função SQL (override temporário expira)

import "server-only"
import { cache } from "react"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

// Lista canônica de slugs — atualizar quando seed mudar
export type ModuleSlug =
  // Core
  | "inbox" | "contacts" | "tags"
  // Commercial
  | "kanban" | "pipelines" | "quick_replies" | "agenda" | "agenda_reminders" | "agenda_owner_routing"
  | "crm"
  // Lead gen
  | "widget_site" | "keyword_triggers" | "welcome_message" | "business_hours"
  // AI / Kora Studio
  | "ai_atendente" | "ai_suggestions" | "ai_knowledge_base" | "ai_studio" | "ai"
  // Automação do Instagram (comment-to-DM & cia) — FILHO de `ai_studio`.
  // ⚠️ É a AUTOMAÇÃO, não o canal: `instagram_direct` (inbox) segue sem pai, senão
  // desligar o Studio derrubaria o Direct do cliente junto.
  | "instagram_automation"
  // ⚠️ NÃO existe slug `*_pro`. O nível PRO mora em `tenant_modules.pro`, no próprio
  //    módulo (decisão do dono, 2026-08-01) — ver `hasModulePro`. Cheguei a criar
  //    `ai_studio_pro` e ele foi REMOVIDO na mesma tarde: um slug de PRO por área faria
  //    o catálogo virar metade sufixo quando chegarem Financeiro/CRM/Fiscal.
  // Engagement
  // ⚠️ `sequences` removido em 2026-08-05: não gateava nada e apontava pra rota
  //    inexistente. Sequência de follow-up, quando existir, mora dentro de `broadcasts`.
  | "broadcasts" | "chatbot_builder"
  // Multi-channel
  | "multi_instance" | "meta_cloud" | "instagram_direct"
  // Operational
  | "audit_log_ui" | "webhook_outbound" | "api_access" | "white_label" | "sso" | "inventory"
  // Billing
  // ⚠️ `usage_limits` FOI REMOVIDO do catálogo em 2026-08-05 (decisão do dono: *"isso é
  //    default do funcionamento do sistema"*). Era módulo MORTO — nenhuma página, action ou
  //    gate o consultava — e mesmo assim aparecia no plano Starter, sendo **vendido como
  //    recurso**. Saíram: a entrada do catálogo, a linha do array do plano e (via
  //    `ON DELETE CASCADE`) a única linha em `tenant_modules`, que já estava desabilitada.
  // ⚠️ `billing_panel` é o MESMO caso e continua aqui: também não gateia nada e não está
  //    ligado em ninguém. Fica à espera da mesma decisão — a tela de assinatura que ele
  //    "protegeria" é justamente a que não pode faltar pra ninguém.
  // ⚠️ `billing_panel` e `usage_limits` REMOVIDOS do catálogo em 2026-08-05, junto com
  //    `team` (decisão do dono: *"é default do funcionamento do sistema"*). Os três eram
  //    módulos MORTOS — nenhuma página, action ou gate os consultava — e ocupavam espaço
  //    no god mode e na vitrine do cliente fingindo ser recurso vendável.
  //    Equipe, inbox de cobrança e limites de uso são o produto funcionando, não add-on.

export interface ModuleCatalogEntry {
  slug:        string
  category:    string
  name:        string
  description: string | null
  is_core:     boolean
  default_on:  boolean
  position:    number
  parent_slug: string | null
}

export interface TenantModuleStatus {
  slug:        string
  category:    string
  name:        string
  description: string | null
  is_core:     boolean
  /** Chave PRÓPRIA (a linha em tenant_modules) — é o que o toggle do god mode escreve. */
  enabled:     boolean
  /** Nível PRO deste módulo. Mora NO módulo, não num slug `x_pro` — ver `hasModulePro`. */
  pro:         boolean
  reason:      string | null
  expires_at:  string | null
  set_at:      string | null
  parent_slug: string | null   // hierarquia pai/filho (null = raiz)
  /** Está ligado E o pai (recursivo) também? É o que `tenant_has_module` responde — o
   *  que o CLIENTE realmente tem. Sem isto o god vê "ligado" num filho que o gate nega. */
  effective:   boolean
}

// ── API ────────────────────────────────────────────────────────

/**
 * Verifica se o tenant tem o módulo habilitado.
 * Core modules sempre retornam true.
 * Memoizado POR REQUEST (React cache): page + actions + gates repetidos na mesma
 * renderização custam 1 RPC só — corte direto de latência de navegação.
 */
export const hasModule = cache(async (tenantId: string, slug: ModuleSlug): Promise<boolean> => {
  const { data, error } = await supabaseAdmin
    .rpc("tenant_has_module", { p_tenant_id: tenantId, p_slug: slug })

  if (error) {
    console.error("[modules] hasModule failed:", error.message)
    return false
  }
  return !!data
})

/**
 * O tenant tem o módulo **no nível PRO**?
 *
 * 🔴 O PRO mora NO módulo (`tenant_modules.pro`), não num slug `x_pro` separado —
 *    decisão do dono, 2026-08-01. Assim qualquer módulo (Studio hoje; Financeiro, CRM e
 *    Fiscal amanhã) ganha um nível avançado sem nascer linha nova no catálogo, e o estado
 *    sem sentido "PRO ligado com módulo desligado" deixa de ser exprimível.
 *
 * 🔴 **Fail-closed em tudo:** sem linha, módulo desligado, override vencido ou erro de
 *    banco → `false`. Recurso pago não pode vazar por falha de leitura.
 *
 * ⚠️ Checa o módulo ANTES (via `hasModule`, que já respeita a hierarquia pai/filho e o
 *    `expires_at`): PRO de um módulo que o cliente não tem é sempre `false`.
 */
export const hasModulePro = cache(async (tenantId: string, slug: ModuleSlug): Promise<boolean> => {
  if (!(await hasModule(tenantId, slug))) return false

  const { data, error } = await supabaseAdmin
    .from("tenant_modules")
    .select("pro")
    .eq("tenant_id", tenantId)
    .eq("module_slug", slug)
    .eq("enabled", true)
    .maybeSingle()

  if (error) { console.error("[modules] hasModulePro failed:", error.message); return false }
  return !!data?.pro
})

/**
 * Throws se o tenant da sessão atual NÃO tem o módulo. Use em server actions.
 *
 * @example
 *   export async function createBroadcast(...) {
 *     await requireModule("broadcasts")  // throws antes de qualquer DB write
 *     ...
 *   }
 */
export async function requireModule(slug: ModuleSlug): Promise<void> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  const ok = await hasModule(session.user.tenantId, slug)
  if (!ok) {
    throw new Error(`Módulo "${slug}" não habilitado pra este tenant. Fale com o suporte.`)
  }
}

/**
 * Lista todos os slugs habilitados pra um tenant (incluindo core).
 * Usado no layout/sidebar pra filtrar itens visíveis.
 */
export async function getEnabledModuleSlugs(tenantId: string): Promise<Set<string>> {
  const [{ data: catalog }, { data: tm }] = await Promise.all([
    supabaseAdmin
      .from("module_catalog")
      .select("slug, is_core, parent_slug"),
    supabaseAdmin
      .from("tenant_modules")
      .select("module_slug, expires_at")
      .eq("tenant_id", tenantId)
      .eq("enabled", true),
  ])

  const rows   = (catalog ?? []) as { slug: string; is_core: boolean; parent_slug: string | null }[]
  // Slug fora do catálogo = fail-closed (mesma regra do `tenant_has_module`).
  const parent = new Map(rows.map((r) => [r.slug, r.parent_slug] as const))
  const now    = Date.now()
  const own    = new Set<string>()
  rows.filter((r) => r.is_core).forEach((r) => own.add(r.slug))
  ;(tm ?? []).forEach((r) => {
    if (!r.expires_at || new Date(r.expires_at).getTime() > now) {
      own.add(r.module_slug)
    }
  })

  // 🔴 PARIDADE com `tenant_has_module` (recursivo desde 2026-07-18): filho só vale com o
  // PAI ligado. Sem isto o gate por Set (sidebar + páginas de integração) ficaria mais
  // FROUXO que o gate por RPC — o mesmo módulo diria "sim" numa porta e "não" na outra.
  const resolved = new Map<string, boolean>()
  const has = (slug: string, seen = new Set<string>()): boolean => {
    const cached = resolved.get(slug)
    if (cached !== undefined) return cached
    if (seen.has(slug)) return false                 // ciclo no catálogo = fail-closed
    seen.add(slug)
    if (!parent.has(slug)) return false              // slug fora do catálogo = fail-closed
    const p  = parent.get(slug) ?? null
    const ok = own.has(slug) && (!p || has(p, seen))
    resolved.set(slug, ok)
    return ok
  }
  return new Set([...own].filter((s) => has(s)))
}

/**
 * Lista TODOS os módulos do catálogo com status pra um tenant — usado
 * na página do god mode pra mostrar tudo (habilitado, desabilitado, core).
 */
export async function listAllModulesForTenant(tenantId: string): Promise<TenantModuleStatus[]> {
  const [{ data: catalog }, { data: tm }] = await Promise.all([
    supabaseAdmin
      .from("module_catalog")
      .select("slug, category, name, description, is_core, default_on, position, parent_slug")
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("tenant_modules")
      .select("module_slug, enabled, pro, reason, expires_at, set_at")
      .eq("tenant_id", tenantId),
  ])

  const tmMap = new Map<string, { enabled: boolean; pro: boolean; reason: string | null; expires_at: string | null; set_at: string | null }>()
  ;(tm ?? []).forEach((r) => tmMap.set(r.module_slug, {
    enabled:    r.enabled,
    pro:        !!r.pro,
    reason:     r.reason,
    expires_at: r.expires_at,
    set_at:     r.set_at,
  }))

  const now = Date.now()
  const rows = (catalog ?? []).map((c) => {
    const override = tmMap.get(c.slug)
    const enabled =
      c.is_core ? true :
      override
        ? (override.enabled && (!override.expires_at || new Date(override.expires_at).getTime() > now))
        : false

    return {
      slug:        c.slug,
      category:    c.category,
      name:        c.name,
      description: c.description,
      is_core:     c.is_core,
      enabled,
      // PRO cru; o EFETIVO é resolvido junto com `effective` logo abaixo (o pai manda).
      pro:         enabled && !!override?.pro,
      reason:      override?.reason ?? null,
      expires_at:  override?.expires_at ?? null,
      set_at:      override?.set_at ?? null,
      parent_slug: (c.parent_slug ?? null) as string | null,
      effective:   false,   // resolvido abaixo (precisa do mapa completo)
    }
  })

  // ⚠️ `pro` também depende do PAI (QA 2026-08-01): `hasModulePro` chama `hasModule`, que
  //    é recursivo. Sem alinhar aqui, o painel mostrava o selo PRO marcado numa linha com
  //    "sem efeito · ligue Kora Studio" — e o servidor negava. Duas verdades na mesma tela.
  // Efetivo = próprio ligado E pai (recursivo) ligado — espelha `tenant_has_module`.
  const byslug = new Map(rows.map((r) => [r.slug, r] as const))
  const memo   = new Map<string, boolean>()
  const eff = (slug: string, seen = new Set<string>()): boolean => {
    const cached = memo.get(slug)
    if (cached !== undefined) return cached
    if (seen.has(slug)) return false
    seen.add(slug)
    const r  = byslug.get(slug)
    const ok = !!r && r.enabled && (!r.parent_slug || eff(r.parent_slug, seen))
    memo.set(slug, ok)
    return ok
  }
  for (const r of rows) {
    r.effective = eff(r.slug)
    // ⚠️ PRO acompanha o EFETIVO (QA 2026-08-01). Sem isto o painel mostrava o selo PRO
    //    marcado numa linha que já exibia "sem efeito · ligue o pai" — e `hasModulePro`,
    //    que é recursivo, negava. Uma tela não pode afirmar duas coisas contrárias.
    r.pro = r.pro && r.effective
  }
  return rows
}

/**
 * Seed inicial: ao criar tenant novo, popular tenant_modules com tudo
 * que é default_on. Chamado por createTenant.
 *
 * ⚠️ DEPENDE DA COLUNA `tenant_modules.source` — não deployar antes da migration
 *    `20260821000100_tenant_modules_source_foundation.sql`. Sem a coluna, este
 *    upsert falha. (Mesma dependência de `setTenantModule` em modules-admin.ts.)
 */
export async function applyDefaultModules(tenantId: string): Promise<void> {
  const { data: defaults } = await supabaseAdmin
    .from("module_catalog")
    .select("slug")
    .eq("default_on", true)
    .eq("is_core", false)  // core não precisa de linha

  if (!defaults?.length) return

  const rows = defaults.map((m) => ({
    tenant_id:   tenantId,
    module_slug: m.slug,
    enabled:     true,
    reason:      "Default ao criar tenant",
    // 🔴 `source` decide se a troca de plano PODE mexer nesta linha. Concessão do
    //    SISTEMA (seed de criação) é reconciliável → 'plan'. Se ficasse no default
    //    'manual', ela viraria "cortesia do operador" e NENHUMA troca de plano
    //    futura conseguiria desligá-la: o tenant carregaria os 8 módulos default_on
    //    pra sempre, fora de qualquer plano, sem ninguém ter decidido isso.
    //    'manual' é só pra quem um humano ligou na mão (ver setTenantModule).
    source:      "plan",
  }))

  await supabaseAdmin
    .from("tenant_modules")
    .upsert(rows, { onConflict: "tenant_id,module_slug" })
}
