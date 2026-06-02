// ═══════════════════════════════════════════════════════════════
// Setup state — usado pelo banner de onboarding em /inbox
// ═══════════════════════════════════════════════════════════════
// Detecta o estado atual do setup do tenant pra guiar o owner
// nos passos essenciais antes de operar de verdade.
//
// Server-only (lê DB direto via supabaseAdmin).

import { supabaseAdmin } from "@/lib/supabase"

export interface SetupStep {
  id:         string
  label:      string
  description: string
  done:       boolean
  href:       string
  optional?:  boolean
}

export interface SetupState {
  tenantId:        string
  steps:           SetupStep[]
  completedCount:  number
  requiredCount:   number
  allDone:         boolean
  percentComplete: number
}

/**
 * Verifica o estado atual de setup do tenant. Roda em 5 queries paralelas.
 */
export async function getSetupState(tenantId: string): Promise<SetupState> {
  const [
    { data: instance },
    { count: teamCount },
    { data: pipeline },
    { data: widget },
    { count: openInvitesCount },
  ] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_instances")
      .select("status, phone_number")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_users")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabaseAdmin
      .from("pipelines")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("site_widget_config")
      .select("enabled, privacy_policy_url, dpo_email")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("invites")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("accepted_at", null),
  ])

  // Status "connected" é suficiente — phone_number pode estar vazio mas instância funciona
  const whatsappConnected = instance?.status === "connected"
  const teamInvited       = (teamCount ?? 0) > 1 || (openInvitesCount ?? 0) > 0
  const pipelineExists    = !!pipeline
  const widgetReady       = widget?.enabled
    ? !!widget.privacy_policy_url && !!widget.dpo_email
    : null  // null = não usa widget, opcional

  const steps: SetupStep[] = [
    {
      id:          "whatsapp",
      label:       "Conectar WhatsApp",
      description: whatsappConnected
        ? (instance?.phone_number ? `Conectado: +${instance.phone_number}` : "Conectado")
        : "Escaneie o QR code pra começar a receber mensagens",
      done:        whatsappConnected,
      href:        "/configuracoes/whatsapp",
    },
    {
      id:          "team",
      label:       "Convidar equipe",
      description: teamInvited
        ? "Pelo menos um atendente além do owner"
        : "Convide ao menos um atendente pra atender junto",
      done:        teamInvited,
      href:        "/configuracoes/equipe",
    },
    {
      id:          "pipeline",
      label:       "Configurar funil de vendas",
      description: pipelineExists
        ? "Pipeline ativo"
        : "Crie ao menos um pipeline pra organizar conversas no kanban",
      done:        pipelineExists,
      href:        "/kanban/configuracao",
    },
    {
      id:          "widget",
      label:       "Widget do site",
      description: widget?.enabled
        ? (widgetReady
            ? "Widget ativo, LGPD configurada"
            : "⚠️ Widget ativo SEM política LGPD — preencha URL + DPO")
        : "Capture leads do seu site",
      // Só "done" quando o widget está realmente ativo e configurado.
      // Widget desligado é estado neutro (não-feito, mas opcional — não trava o progresso).
      done:        widget?.enabled === true && widgetReady === true,
      href:        "/configuracoes/site",
      optional:    true,
    },
  ]

  const required       = steps.filter((s) => !s.optional)
  const completed      = required.filter((s) => s.done).length
  const allDone        = completed === required.length
  const percentComplete = Math.round((completed / required.length) * 100)

  return {
    tenantId,
    steps,
    completedCount:  completed,
    requiredCount:   required.length,
    allDone,
    percentComplete,
  }
}
