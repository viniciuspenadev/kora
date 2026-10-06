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
    { data: cadastro },
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
    // Cadastro fiscal — mesma régua de `getTitularParaCobranca` e do wizard.
    supabaseAdmin
      .from("tenant_billing_profile")
      .select("legal_name, tax_id, billing_email, zip, number")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ])

  // Status "connected" é suficiente — phone_number pode estar vazio mas instância funciona
  const whatsappConnected = instance?.status === "connected"
  const teamInvited       = (teamCount ?? 0) > 1 || (openInvitesCount ?? 0) > 0
  const pipelineExists    = !!pipeline
  const widgetReady       = widget?.enabled
    ? !!widget.privacy_policy_url && !!widget.dpo_email
    : null  // null = não usa widget, opcional

  // ── Cadastro do cliente ───────────────────────────────────────────────────
  // 🔑 PASSO DAQUI, não banner novo. Este checklist já é a superfície de "o que falta
  //    fazer" — um segundo banner disputando o mesmo topo de tela ensinaria a ignorar os
  //    dois. Entra em PRIMEIRO porque é o único passo que, faltando, impede o cliente de
  //    virar cliente pagante: sem ele o gate de assinatura barra a contratação.
  // 🔴 "FEITO" OLHA O DADO, NUNCA O CARIMBO DO WIZARD. A primeira versão disto era
  //    `cadastroCompleto || wizardConcluido` — e isso mente em um caso real, não
  //    hipotético: a pessoa conclui o wizard (carimbo gravado), depois apaga o CEP em
  //    Configurações. O checklist continuaria dizendo "pronto pra faturamento" enquanto o
  //    gate de assinatura barra a contratação. Duas telas discordando sobre o mesmo fato,
  //    e a que o cliente lê primeiro é a que está errada.
  // ⚠️ A leitura de `tenants.onboarding_profile_at` SAIU daqui junto: ela só servia pra
  //    escolher o destino do link, e o destino passou a ser sempre a tela de edição. Era
  //    uma consulta a mais em TODA navegação de owner/admin pra decidir nada.
  const c = (cadastro ?? {}) as Record<string, string | null>
  const cadastroCompleto = Boolean(c.legal_name && c.tax_id && c.billing_email && c.zip && c.number)

  const steps: SetupStep[] = [
    {
      id:          "cadastro",
      label:       "Completar cadastro",
      description: cadastroCompleto
        ? "Dados da empresa e endereço prontos pra faturamento"
        : "Faltam dados que a gente precisa pra emitir sua cobrança",
      done:        cadastroCompleto,
      // 🔑 SEMPRE a tela de edição, nunca o wizard. O wizard é a experiência de PRIMEIRO
      //    ACESSO — quem chega aqui pelo checklist já está usando o produto, e ser recebido
      //    com "Prazer, bem-vindo!" no meio do trabalho é o sistema fingindo que não te
      //    conhece. Os campos são os mesmos e o autofill de CNPJ/CEP também; o que muda é
      //    só o enquadramento. (A 1ª versão mandava pro `/bem-vindo?editar=1` — e o efeito
      //    apareceu ao vivo com a Blue, cliente desde maio.)
      href:        "/configuracoes/empresa",
    },
    {
      id:          "whatsapp",
      label:       "Conectar WhatsApp",
      description: whatsappConnected
        ? (instance?.phone_number ? `Conectado: ${instance.phone_number.startsWith("+") ? instance.phone_number : "+" + instance.phone_number}` : "Conectado")
        : "Conecte seu WhatsApp — número oficial ou QR Code",
      done:        whatsappConnected,
      href:        "/integracoes",
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
