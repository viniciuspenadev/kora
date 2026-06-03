# Plano de execução pós-MVP — Kora

> Documento mestre do que falta construir até launch. Última revisão: 2026-05-20.
> Fila lightweight: [ROADMAP.md](ROADMAP.md). Convenções: [CLAUDE.md](CLAUDE.md). Decisões estratégicas: [memory/strategic-decisions.md](~/.claude/projects/c--apps-whatsapp/memory/strategic-decisions.md).

---

## 0. Onde estamos

✅ MVP funcional ponta-a-ponta:
- Auth (NextAuth + Supabase + JWT custom RLS)
- Super-admin `/admin` (tenants, invites, convites)
- Tenant app shell `/(app)` com sidebar hover-expand
- Inbox completo (lista + thread + composer + mídia + grupos + quick replies + emoji + qualify/unfit)
- Kanban com drag-and-drop, multi-funil, CRUD de estágios
- Contatos + tags
- `/configuracoes/whatsapp` (Evolution config + Health card + tabs)
- Webhook Evolution API
- Bucket Storage `chat-attachments`

❌ Não tem ainda:
- Provider abstraction (tudo tied a Baileys/Evolution)
- Automação (auto-reply, palavras-chave, atribuição)
- Meta Cloud API
- Cobrança / planos / quotas
- Broadcasts e templates oficiais
- Sequências/drips
- AI copilot
- Chatbot builder visual
- Deploy

---

## 1. Decisões estratégicas (referência)

| Eixo | Decisão |
|---|---|
| **Posicionamento** | Premium com IA, acessível. Diferenciação por qualidade + IA copiloto. |
| **Stack WhatsApp** | Dual-stack: Baileys (atendimento, sem broadcast) + Meta Cloud (campanhas, oficial). Cliente escolhe por instância. |
| **Regra de número** | Globalmente único: 1 número = 1 instância, qualquer provider. Migração Baileys→Meta exige delete do app no celular. |
| **Cobrança Meta msgs** | V1: passa-through (cliente conecta conta Meta dele). V2: wrap opcional em Enterprise. |
| **Onboarding Meta Cloud** | V1: assistido (tutorial + call de setup). V2: Embedded Signup após aprovação Tech Provider Meta. |
| **Monetização** | Planos com cota unificada (usuários + instâncias + features). Overage de usuário extra: R$ 49/mês. Sem modelo híbrido. |

Detalhes em [strategic-decisions.md](~/.claude/projects/c--apps-whatsapp/memory/strategic-decisions.md).

---

## 2. Visão das fases

| Fase | Sprints | Estimativa | Bloqueia |
|---|---|---|---|
| **2** | 2.0 → 2.4 | 1-2 sem | Tudo posterior |
| **3** | 3.0 → 3.2 | 2-3 sem | Broadcasts, cobrança |
| **4** | 4.0 → 4.1 | 2-3 sem | — |
| **5** | 5.0 → 5.1 | 3-4 sem | — |
| **Pre-launch** | smoke, deploy, docs | 1 sem | Go-live |

Total estimado: **10-13 semanas** de trabalho focado.

---

## Fase 2 — Provider Abstraction + Automação básica

### Sprint 2.0 — Provider Abstraction *(1-2 dias)*

**Goal:** Desacoplar código da Evolution API. Habilita Meta Cloud sem refactor massivo depois.

**Schema:**
```sql
ALTER TABLE whatsapp_instances
  ADD COLUMN provider text NOT NULL DEFAULT 'baileys'
    CHECK (provider IN ('baileys','meta_cloud'));

CREATE UNIQUE INDEX uq_whatsapp_instances_phone
  ON whatsapp_instances(phone_number)
  WHERE phone_number IS NOT NULL;
```

**Arquivos novos:**
- `src/lib/providers/types.ts` — interface `WhatsAppProvider` (sendText, sendMedia, getStatus, getQrCode, setWebhook, logout, restart, getMediaBase64, fetchProfilePictureUrl, fetchGroupMetadata)
- `src/lib/providers/evolution-provider.ts` — implementação Baileys (move conteúdo de `evolution-api.ts`)
- `src/lib/providers/meta-cloud-provider.ts` — **STUB**: cada método throw `"MetaCloudProvider not implemented (Sprint 3.0)"`
- `src/lib/providers/index.ts` — factory `getProvider(instance: WhatsAppInstance): WhatsAppProvider`

**Arquivos refatorados:**
- `src/lib/actions/chat.ts` — substituir `import * as evo from "@/lib/evolution-api"` por `getProvider(instance)`
- `src/app/api/webhooks/evolution/route.ts` — receber payload Baileys, normalizar, chamar lógica core (que vai ficar genérica)
- `src/lib/evolution-api.ts` — **deletar** após migração concluída

**Critério "pronto":**
- Typecheck limpo
- `npm run dev` carrega sem erro
- Manual smoke: enviar mensagem, ver no inbox, ver no Meta webhook log (não vai chegar nada mas precisa não dar 500)
- Webhook Evolution continua funcionando (sem regressão)

---

### Sprint 2.1 — Variáveis em mensagens *(4-6h)*

**Goal:** Helper de substituição reusável em todas as automações.

**Schema:** nenhum.

**Arquivos:**
- `src/lib/automation/variables.ts` — `renderTemplate(text: string, context: TemplateContext): string`
- `src/types/automation.ts` — type `TemplateContext` (contact, agent, tenant, conversation)

**Variáveis V1:** `{nome}`, `{primeiro_nome}`, `{telefone}`, `{empresa}`, `{agente}`, `{data}`, `{hora}`

**Critério:** Unit test mental: `renderTemplate("Olá {nome}", { contact: { push_name: "João" } })` retorna `"Olá João"`. Fallback se variável vazia.

---

### Sprint 2.2 — Boas-vindas + Horário comercial *(1-2 dias)*

**Goal:** 2 automações simples que cobrem 60% do caso de uso "responder automaticamente".

**Schema:**
```sql
ALTER TABLE tenant_config
  ADD COLUMN welcome_enabled         boolean NOT NULL DEFAULT false,
  ADD COLUMN welcome_message         text,
  ADD COLUMN welcome_trigger         text NOT NULL DEFAULT 'first_ever'
    CHECK (welcome_trigger IN ('first_ever', 'after_resolved', 'always')),
  ADD COLUMN welcome_reopen_days     int NOT NULL DEFAULT 30,

  ADD COLUMN business_hours_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN business_hours_message  text,
  ADD COLUMN business_hours_schedule jsonb NOT NULL DEFAULT '{
    "mon": { "start": "09:00", "end": "18:00" },
    "tue": { "start": "09:00", "end": "18:00" },
    "wed": { "start": "09:00", "end": "18:00" },
    "thu": { "start": "09:00", "end": "18:00" },
    "fri": { "start": "09:00", "end": "18:00" },
    "sat": null,
    "sun": null
  }'::jsonb,
  ADD COLUMN business_hours_timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
```

**Arquivos novos:**
- `src/lib/automation/welcome.ts` — `shouldSendWelcome(instance, contact, conversation): boolean` + `sendWelcome()`
- `src/lib/automation/business-hours.ts` — `isWithinBusinessHours(config): boolean` + `sendOutOfHoursReply()`
- `src/app/(app)/configuracoes/whatsapp/automation-tab.tsx` (nova aba)
- `src/lib/actions/automation.ts` — `updateAutomationConfig(formData)`

**Integração:** chamada em `webhook/route.ts` dentro do `handleMessageUpsert`, após persistir msg do contato (não do agente). Ordem: business_hours → welcome (se ambos triggers ativos, business_hours ganha).

**UI:** Nova aba "Automação" em `/configuracoes/whatsapp` com 2 seções (toggle + textarea + selector trigger).

**Cooldown:** marca `chat_conversations.metadata.auto_replied_at` pra não duplicar.

---

### Sprint 2.3 — Palavras-chave *(2-3 dias)*

**Goal:** Engine de gatilhos por keyword. Base do que vira chatbot builder no Sprint 5.1.

**Schema:**
```sql
CREATE TABLE keyword_triggers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  patterns        text[] NOT NULL,
  match_type      text NOT NULL DEFAULT 'contains'
    CHECK (match_type IN ('exact', 'contains', 'starts_with')),
  case_sensitive  boolean NOT NULL DEFAULT false,
  response_text   text,
  apply_tag_id    uuid REFERENCES tags(id) ON DELETE SET NULL,
  cooldown_min    int NOT NULL DEFAULT 60,
  enabled         boolean NOT NULL DEFAULT true,
  position        int NOT NULL DEFAULT 0,
  pause_when_assigned boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE keyword_trigger_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id  uuid NOT NULL REFERENCES keyword_triggers(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES chat_contacts(id) ON DELETE CASCADE,
  fired_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kw_runs_cooldown ON keyword_trigger_runs(trigger_id, contact_id, fired_at DESC);
```

**Arquivos novos:**
- `src/lib/automation/keyword-engine.ts` — `matchTrigger(text, trigger): boolean` + `evaluateTriggers(tenantId, contact, msg): TriggerMatch | null`
- `src/lib/actions/keyword-triggers.ts` — CRUD actions
- `src/app/(app)/configuracoes/whatsapp/keywords-tab.tsx` (nova sub-aba)

**Match engine:**
1. Itera triggers `ORDER BY position WHERE enabled`
2. Primeiro match vence
3. Skip se `pause_when_assigned && conversation.assigned_to`
4. Skip se rodou nos últimos `cooldown_min` (consulta `keyword_trigger_runs`)
5. Aplica `response_text` (com variáveis) + `apply_tag_id`
6. INSERT em `keyword_trigger_runs`

**UI:** Lista com drag-and-drop pra reordenar prioridade + form CRUD. Form tem: nome, patterns (chip input), match_type (radio), case_sensitive (checkbox), response_text (textarea + insert variável), apply_tag_id (select), cooldown_min (input num), pause_when_assigned (checkbox), enabled (toggle).

---

### Sprint 2.4 — Atribuição automática *(1 dia)*

**Schema:**
```sql
ALTER TABLE tenant_config
  ADD COLUMN auto_assign_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_assign_only_in_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_assign_last_user_id  uuid REFERENCES profiles(id) ON DELETE SET NULL;
```

**Arquivos:**
- `src/lib/automation/auto-assign.ts` — `assignNextAgent(tenantId, conversationId): Promise<void>`

**Estratégia:** round-robin alfabético sobre `tenant_users WHERE active = true AND role IN ('owner','admin','agent')`. Skip se fora de horário e `only_in_hours = true`.

**Integração:** webhook `findOrCreateConversation` quando cria nova → chama `assignNextAgent`.

**UI:** Seção "Atribuição automática" na aba Automação (toggle + sub-toggle "apenas em horário comercial").

V2 (depois): least-busy (conta conversas abertas por agente), skill-based.

---

## Fase 3 — Meta Cloud + Cobrança

### Sprint 3.0 — Meta Cloud Provider *(3-5 dias)*

**Goal:** Implementar 2º provider. Sem broadcasts ainda — só envio/recebimento normal.

**Schema:**
```sql
ALTER TABLE whatsapp_instances
  ADD COLUMN meta_phone_number_id    text,
  ADD COLUMN meta_business_account_id text,
  ADD COLUMN meta_access_token       text,
  ADD COLUMN meta_app_secret         text,
  ADD COLUMN meta_verify_token       text;

CREATE UNIQUE INDEX uq_meta_phone_number_id
  ON whatsapp_instances(meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;
```

**Arquivos:**
- `src/lib/providers/meta-cloud-provider.ts` — implementação real (substitui stub)
- `src/app/api/webhooks/meta/route.ts` — handler do payload Meta (estrutura totalmente diferente do Evolution)
- `src/app/api/webhooks/meta/verify/route.ts` — handshake GET com `hub.verify_token`
- `src/components/chat/meta-cloud-setup.tsx` — UI assistida de configuração
- `src/components/chat/instance-picker-modal.tsx` — modal "Baileys ou Meta?" ao adicionar instância
- Refactor: UI de instâncias vira multi-instância (lista em vez de instância única)

**Webhook handler crítico:**
- Verificar assinatura do payload com `meta_app_secret` (HMAC SHA-256)
- Normalizar payload Meta → estrutura interna (mesma que Evolution alimenta)
- Reusar lógica de `handleMessageUpsert` core

**UX da exclusividade do número:**
- Wizard "Adicionar instância" passo 1: escolhe provider
- Se escolher Meta Cloud: tela com aviso vermelho destacado + checkbox "Confirmo que este número NÃO está ativo no app WhatsApp"
- Tutorial inline: link pra "Como criar conta Meta Business" + botão "Agendar setup assistido"

**Critério "pronto":**
- Cliente consegue adicionar instância Meta Cloud manualmente (colando credenciais)
- Recebe mensagem via webhook Meta → aparece no inbox normal
- Envia mensagem do inbox → vai via Meta Cloud
- Multi-instância no mesmo tenant: 1 Baileys + 1 Meta Cloud coexistindo

---

### Sprint 3.1 — Plans + Billing *(1 semana)*

**Goal:** Permitir cobrar. Sem isso, Kora é grátis.

**Schema:**
```sql
CREATE TABLE plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  slug              text NOT NULL UNIQUE,
  description       text,
  price_monthly_brl numeric(10,2) NOT NULL,
  price_extra_user_brl numeric(10,2) NOT NULL DEFAULT 49.00,
  -- Cotas
  max_users          int NOT NULL,
  max_instances      int NOT NULL,
  allow_meta_cloud           boolean NOT NULL DEFAULT false,
  allow_broadcasts           boolean NOT NULL DEFAULT false,
  allow_ai_copilot           boolean NOT NULL DEFAULT false,
  allow_funnel_automations   boolean NOT NULL DEFAULT false,  -- automações stage/tag/SLA — gated pra Pro+ com Meta Cloud
  allow_chatbot      boolean NOT NULL DEFAULT false,
  -- Trial
  trial_days         int NOT NULL DEFAULT 14,
  -- Visibilidade
  active             boolean NOT NULL DEFAULT true,
  position           int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants
  ADD COLUMN plan_id            uuid REFERENCES plans(id) ON DELETE RESTRICT,
  ADD COLUMN trial_ends_at      timestamptz,
  ADD COLUMN subscription_id    text,   -- ID na Stripe/Pagar.me
  ADD COLUMN billing_status     text NOT NULL DEFAULT 'trial'
    CHECK (billing_status IN ('trial','active','past_due','canceled','suspended'));

-- Manter coluna `plan` text por compat (deprecate em V2)
```

**Decisão pendente:** Stripe vs Pagar.me. Recomendação: **Stripe** pela qualidade do SDK, dashboard, fraud detection. Pagar.me ganha em PIX nativo. Provavelmente Stripe na V1 e Pagar.me só se mercado brasileiro pedir muito PIX.

**Arquivos:**
- `src/lib/billing/stripe.ts` (ou pagarme.ts) — cliente da API
- `src/app/api/webhooks/stripe/route.ts` — recebe eventos (`subscription.updated`, `invoice.paid`, `invoice.payment_failed`, etc)
- `src/lib/billing/quota.ts` — funções `assertCanAddUser(tenantId)`, `assertCanAddInstance(tenantId)`, `getCurrentUsage(tenantId)`
- `src/app/(admin)/admin/plans/page.tsx` — super-admin CRUD de planos
- `src/app/(admin)/admin/plans/[id]/page.tsx` — editar plano
- `src/lib/actions/plans.ts` — CRUD actions
- `src/app/(app)/configuracoes/cobranca/page.tsx` — tenant vê plano atual, uso, link pra portal Stripe
- Integração em `admin.ts createTenant` — atribui plano

**Quota enforcement:**
- Criar usuário (invite ou owner): `assertCanAddUser(tenantId)` — throw se passa do limite
- Criar instância: `assertCanAddInstance(tenantId)` — idem
- Excedente de usuários: cobrança proporcional via Stripe subscription items

**UI super-admin:**
- `/admin/plans` lista planos com CRUD
- `/admin/tenants/[id]` mostra plano atual + ações pra mudar plano / cancelar / suspender

**Critério "pronto":**
- Super-admin cria/edita planos
- Tenant na criação recebe trial 14d no plano default
- Bloqueio quando tenta criar usuário acima do limite
- Webhook Stripe processa pagamento e atualiza `billing_status`

---

### Sprint 3.2 — Onboarding com plano *(2-3 dias)*

**Goal:** Fluxo completo de signup → trial → upgrade.

**Schema:** nenhum novo.

**Arquivos:**
- `src/app/(app)/onboarding/page.tsx` — wizard pós-signup (escolher plano, conectar WhatsApp)
- `src/components/billing/trial-banner.tsx` — topo da app durante trial (countdown)
- `src/components/billing/upgrade-modal.tsx` — modal de bloqueio quando trial expira

**Fluxo:**
1. Convite aceito → trial automático no plano `starter` (decidir qual é default)
2. App shell mostra banner "Restam X dias do trial"
3. D-3 antes do fim: notificação in-app
4. Trial expirado: redireciona pra `/configuracoes/cobranca`, app bloqueado até pagar

---

## Fase 4 — Broadcasts + Sequências

### Sprint 4.0 — Broadcasts/Campanhas *(1 semana)*

**Goal:** Disparo em massa via Meta Cloud (templates HSM). Receita real.

**Schema:**
```sql
CREATE TABLE broadcast_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id     uuid NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  name            text NOT NULL,
  template_name   text NOT NULL,  -- nome do template Meta aprovado
  template_params jsonb NOT NULL DEFAULT '{}',  -- variáveis injetadas
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','completed','canceled','failed')),
  scheduled_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  -- Segmentação
  segment_filters jsonb NOT NULL DEFAULT '{}',  -- { lifecycle, tags, source, custom }
  total_recipients int NOT NULL DEFAULT 0,
  -- Resultado
  delivered_count  int NOT NULL DEFAULT 0,
  read_count       int NOT NULL DEFAULT 0,
  failed_count     int NOT NULL DEFAULT 0,
  replied_count    int NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE broadcast_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES chat_contacts(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','read','failed','replied')),
  whatsapp_msg_id text,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  error         text,
  UNIQUE(campaign_id, contact_id)
);
```

**Arquivos:**
- `src/app/(app)/campanhas/page.tsx` — lista de campanhas
- `src/app/(app)/campanhas/nova/page.tsx` — wizard de criação (3 steps: template, segmentação, agendamento)
- `src/app/(app)/campanhas/[id]/page.tsx` — detalhe com métricas
- `src/lib/broadcasts/segment.ts` — `resolveSegment(filters): contactIds[]`
- `src/lib/broadcasts/worker.ts` — processa campanhas agendadas (chamado por cron)
- `src/app/api/cron/process-broadcasts/route.ts` — endpoint cron
- `src/components/broadcasts/template-picker.tsx` — busca templates aprovados na conta Meta do cliente

**Validação:**
- Só permite criar campanha se instância tem `provider='meta_cloud'`
- Template precisa existir e estar aprovado na Meta
- Quota: cliente pode ter X campanhas/mês por plano

**Worker:**
- Cron 1x/min
- Pega campanhas com `status='scheduled' AND scheduled_at <= now()`
- Marca `sending`, itera contatos, envia, salva resultado em `broadcast_sends`
- Rate limit: respeita tier Meta (250/dia → 1k/dia → 10k/dia conforme quality rating)

---

### Sprint 4.1 — Automações de Funil (drips + stage triggers + SLA) *(1-2 semanas)*

**Goal:** Engine genérico de "trigger → condition → actions" pra automações de funil. Inclui drips temporais.

**Gate:** Disponível apenas em planos com `allow_funnel_automations = true` (Pro+ com Meta Cloud).
Cliente Starter (só Baileys) **não tem acesso** — vê banner "Upgrade pra Pro com Meta Cloud" ao tentar usar.

**Triggers suportados:**
- `tag_applied` (existente nas actions)
- `tag_removed`
- `lifecycle_changed` (contact → lead → won/lost/unfit)
- `stage_entered` / `stage_exited` (em moveConversation)
- `conversation_won` / `conversation_lost`
- `time_in_stage` (cron: card parado em estágio há N dias)
- `time_no_response` (cron: contato sem resposta há N horas)
- `keyword_match` (já tem schema próprio em Sprint 2.3, mas pode disparar sequência também)

**Ações suportadas (cada step da sequência):**
- `send_text` (com variáveis + delay opcional)
- `send_media` (URL — só Meta Cloud aceita HSM templates)
- `apply_tag` / `remove_tag`
- `move_stage`
- `assign_user`
- `notify_user` (mensagem-sistema visível pro agente, sem mandar pro WhatsApp)
- `wait` (delay temporal puro)
- `webhook_call` (POST pra URL externa do cliente)

**Por que gate em Meta Cloud:**
Delay temporal + volume + alta variedade de gatilhos disparam padrões "robóticos" que aumentam risco de ban no Baileys. Em Meta Cloud é oficial, sem risco. Também justifica preço do plano Pro.

**Schema:**
```sql
CREATE TABLE automation_sequences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL CHECK (trigger_type IN ('tag_applied','lifecycle_change','keyword_match','manual')),
  trigger_meta jsonb NOT NULL DEFAULT '{}',
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE automation_sequence_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     uuid NOT NULL REFERENCES automation_sequences(id) ON DELETE CASCADE,
  position        int NOT NULL,
  delay_minutes   int NOT NULL DEFAULT 0,
  message_text    text,
  media_url       text,
  media_type      text CHECK (media_type IN ('image','audio','video','document')),
  apply_tag_id    uuid REFERENCES tags(id) ON DELETE SET NULL,
  UNIQUE(sequence_id, position)
);

CREATE TABLE automation_sequence_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id         uuid NOT NULL REFERENCES automation_sequences(id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES chat_contacts(id) ON DELETE CASCADE,
  conversation_id     uuid REFERENCES chat_conversations(id) ON DELETE SET NULL,
  current_step        int NOT NULL DEFAULT 0,
  next_run_at         timestamptz NOT NULL,
  completed_at        timestamptz,
  paused              boolean NOT NULL DEFAULT false,
  pause_reason        text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_seq_runs_due ON automation_sequence_runs(next_run_at)
  WHERE completed_at IS NULL AND paused = false;
```

**Arquivos:**
- `src/app/(app)/automacoes/page.tsx` — lista de sequências
- `src/app/(app)/automacoes/[id]/page.tsx` — editor de steps
- `src/lib/automation/sequence-worker.ts` — processa runs devidos
- `src/app/api/cron/process-sequences/route.ts` — endpoint cron 1x/min
- Integração em `keyword-engine`, `applyTag`, etc. — disparam `enqueueSequence(contact, sequenceId)`

**Auto-pausa:** se contato responde, marca `paused = true` (cliente humano assumiu).

---

## Fase 5 — AI + Chatbot Builder

### Sprint 5.0 — AI Copilot *(4-5 dias)*

**Goal:** Diferenciação premium. Claude/GPT sugere resposta no inbox.

**Schema:**
```sql
ALTER TABLE tenant_config
  ADD COLUMN ai_copilot_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN ai_model           text DEFAULT 'claude-sonnet-4-6',
  ADD COLUMN ai_temperature     numeric(3,2) DEFAULT 0.7,
  ADD COLUMN ai_system_prompt   text;

CREATE TABLE ai_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  suggested_text  text NOT NULL,
  used            boolean NOT NULL DEFAULT false,
  used_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  used_at         timestamptz,
  tokens_input    int,
  tokens_output   int,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**Arquivos:**
- `src/lib/ai/copilot.ts` — gera sugestão via Claude API com últimas N mensagens
- `src/components/chat/ai-suggestion-bubble.tsx` — bolha "Sugestão IA" acima do composer
- `src/app/api/ai/suggest/route.ts` — endpoint server-side (não expor key client)
- `src/lib/billing/ai-usage.ts` — count tokens, charge per plan tier

**UX:** No chat-panel, abaixo do thread e acima do composer, aparece card "💡 Sugestão" com botão "Usar" (preenche composer) ou "Refinar" (gera outra). Opt-in por agente.

**Quota:** plano Pro = X mil sugestões/mês incluídas; excedente paga.

---

### Sprint 5.1 — Chatbot Builder Visual *(2-3 semanas)*

**Goal:** O "moat" da BotConversa. Editor visual de fluxos.

**Schema:**
```sql
CREATE TABLE chatbot_flows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  enabled       boolean NOT NULL DEFAULT false,
  trigger_type  text CHECK (trigger_type IN ('keyword','first_message','tag','manual')),
  trigger_meta  jsonb NOT NULL DEFAULT '{}',
  graph         jsonb NOT NULL,  -- { nodes: [...], edges: [...] }
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chatbot_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         uuid NOT NULL REFERENCES chatbot_flows(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES chat_contacts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  current_node    text,
  context         jsonb NOT NULL DEFAULT '{}',
  completed_at    timestamptz,
  abandoned_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**Node types (V1):**
- `message` — envia texto/mídia
- `question` — pergunta com botões de resposta (Meta) ou texto livre
- `condition` — branch baseado em variável/tag
- `apply_tag` — aplica tag no contato
- `assign_human` — encerra fluxo, atribui a agente
- `wait` — pausa N minutos/horas
- `webhook` — chama URL externa

**Tech stack:**
- Editor: **React Flow** (`reactflow` lib) — mais maduro pra graph editors
- Runtime: engine server-side que interpreta `graph` JSON e responde via provider

**Arquivos:**
- `src/app/(app)/chatbot/page.tsx` — lista de fluxos
- `src/app/(app)/chatbot/[id]/page.tsx` — editor visual
- `src/components/chatbot/flow-editor.tsx` — ReactFlow wrapper
- `src/components/chatbot/nodes/*.tsx` — 1 componente por tipo de nó
- `src/lib/chatbot/runtime.ts` — executor do graph
- `src/lib/chatbot/triggers.ts` — quando iniciar um run

**Decisão pendente:** suportar Meta Interactive Buttons / List? Aumenta UX mas só Meta Cloud. Recomendação: sim, com fallback texto pra Baileys.

---

## Pre-launch *(1 semana)*

### Smoke test ponta-a-ponta *(1-2 dias)*
- Criar tenant via /admin
- Aceitar invite
- Conectar Evolution
- Configurar webhook (URL pública)
- Receber mensagem → ver no inbox
- Responder
- Criar keyword trigger e testar
- Mover card no kanban
- Criar tag, aplicar
- Criar campanha (se Meta Cloud configurado)
- Verificar quotas

### Deploy Vercel *(1 dia)*
- Conectar repo
- Configurar envs prod
- Domínio (kora.com.br ou similar)
- Cron jobs (broadcasts, sequences, health check)
- Edge Functions se necessário

### Observabilidade *(1 dia)*
- Sentry pra errors
- Vercel Analytics
- Supabase logs ativados
- Health check externo (UptimeRobot ou similar)

### Docs / Help Center *(2 dias)*
- Página `/ajuda` ou subdomain `docs.kora.com.br`
- Tutoriais: setup Evolution, setup Meta Cloud, criar campanha, criar fluxo
- Vídeos curtos (5-10 min cada) cobrindo onboarding

### Backup Supabase *(meio dia)*
- Configurar backup automatizado no plano Supabase
- Testar restore em projeto staging

---

## Pipeline completo de migrations

Aplicar nesta ordem:

1. `20260520_add_show_in_kanban.sql` *(já criada, aguardando aplicação)*
2. `20260521_add_provider_to_instances.sql` — Sprint 2.0
3. `20260523_add_automation_columns.sql` — Sprint 2.2 (welcome + business_hours)
4. `20260525_create_keyword_triggers.sql` — Sprint 2.3
5. `20260526_add_auto_assign_columns.sql` — Sprint 2.4
6. `20260530_add_meta_cloud_columns.sql` — Sprint 3.0
7. `20260605_create_plans_table.sql` — Sprint 3.1
8. `20260615_create_broadcast_tables.sql` — Sprint 4.0
9. `20260622_create_sequence_tables.sql` — Sprint 4.1
10. `20260628_add_ai_copilot_columns.sql` — Sprint 5.0
11. `20260710_create_chatbot_tables.sql` — Sprint 5.1

---

## Decisões pendentes (não bloqueiam Sprint 2.0)

| # | Decisão | Prazo |
|---|---|---|
| 1 | Stripe vs Pagar.me | Antes do Sprint 3.1 |
| 2 | Default plan slug (starter? trial?) | Sprint 3.1 |
| 3 | AI provider (Claude vs GPT vs ambos) | Antes do Sprint 5.0 |
| 4 | Chatbot lib (React Flow confirmar?) | Antes do Sprint 5.1 |
| 5 | Domínio do produto | Antes do deploy |
| 6 | Política LGPD (texto público + opt-out) | Antes do launch |
| 7 | Aprovar Meta Tech Provider (pra Embedded Signup V2) | Pode iniciar paralelo a qualquer sprint após 3.0 |

---

## Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Refactor Sprint 2.0 quebra inbox | Médio | Smoke test após. Manter `evolution-api.ts` paralelo até confirmar. |
| Meta Cloud webhook signature complexa | Médio | Estudar docs antes do Sprint 3.0. Library `@whiskeysockets/baileys`-equivalente pra Meta? |
| Stripe webhook race conditions | Médio | Implementar idempotência via `event.id` |
| Cliente abandona em Meta Cloud setup | Alto | Suporte assistido na V1 + tutorial detalhado + agendamento de call |
| Baileys ban inesperado | Alto | Não fazer broadcast em Baileys. Rate limit conservador. Recomendar Meta pra alto volume. |
| Quota não enforced antes do cliente exceder | Médio | Implementar em todas server actions críticas. Testar limites com seed de dados. |
| ReactFlow performance com 100+ nós | Baixo | Profiling no Sprint 5.1. Limitar a 50 nós na V1 se necessário. |

---

## Critérios "pronto" globais (definition of done)

Cada sprint só fecha quando:

- [ ] Schema migration aplicada no Supabase
- [ ] Typecheck limpo (`npx tsc --noEmit`)
- [ ] Smoke manual cobrindo o caminho feliz
- [ ] ROADMAP.md atualizado (item movido pra Done com data)
- [ ] PLAN.md ainda reflete fielmente o que foi entregue (ou atualizado se houve desvio)

---

## Cronograma estimado

Assumindo trabalho focado de ~30h/semana no projeto:

| Sem | Sprint(s) | Marco |
|---|---|---|
| 1 | 2.0 + 2.1 | Provider abstraction + Variáveis |
| 2 | 2.2 + 2.3 | Boas-vindas/Horário + Palavras-chave |
| 3 | 2.4 + 3.0 | Atribuição automática + Meta Cloud Provider |
| 4 | 3.0 (cont) + 3.1 | Meta Cloud + Plans/Billing |
| 5 | 3.1 (cont) + 3.2 | Billing + Onboarding |
| 6 | 4.0 | Broadcasts |
| 7 | 4.0 (cont) + 4.1 | Broadcasts + Sequências |
| 8 | 4.1 (cont) + 5.0 | Sequências + AI Copilot |
| 9 | 5.0 (cont) + 5.1 | AI Copilot + Chatbot Builder |
| 10 | 5.1 (cont) | Chatbot Builder |
| 11 | 5.1 (cont) + Pre-launch | Smoke + Deploy |
| 12 | Pre-launch (cont) | Launch 🚀 |

Margem de buffer: 2-3 semanas pra imprevistos. Launch realista: **3 meses**.
