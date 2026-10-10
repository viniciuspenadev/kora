# Banco de produção: permissões de ligação

Mapeamento somente de leitura realizado em 2026-10-10 no projeto Supabase **WhatsApp**. Foram consultados `information_schema` e `pg_catalog`, além de contagens e do catálogo de módulos. O escopo cobre as tabelas tocadas pela migração de voz e a tabela de números usada para validar as concessões; não é um inventário de todo o banco. A aplicação posterior da migração está registrada abaixo.

## Estrutura encontrada

| Tabela | Situação relevante para voz |
| --- | --- |
| `module_catalog` | `slug text` é chave primária; `parent_slug text` referencia o próprio catálogo com `ON DELETE SET NULL`. `category`, `name`, `is_core`, `default_on` e `position` têm os tipos esperados. Há índice em `(category, position)`. Os slugs `voice_calls` e `voice_recording` ainda não existem. Na categoria `atendimento`, a última posição usada é 60 (`kanban`); 70 e 71 estão livres. |
| `tenant_modules` | Chave primária `(tenant_id, module_slug)`, com FK para `module_catalog(slug)`. `enabled boolean` tem padrão `true`, mas só há concessão quando existe uma linha. `source` aceita `plan` ou `manual`. Não há concessões dos dois novos slugs. |
| `tenant_users` | `role text` aceita `owner`, `admin` e `agent`. `instance_ids uuid[]` já representa os números atendidos e admite `NULL` (todos). `voice_instance_ids` ainda não existe. Há unicidade em `(tenant_id, user_id)`. |
| `tenant_config` | Chave primária `tenant_id`; `voice_recording_enabled` não existe. A preferência de gravação ainda não tem comportamento implementado, então a migração atual não acrescenta essa coluna. |
| `whatsapp_instances` | `id uuid` é chave primária, com `tenant_id uuid`. `provider` admite `baileys` e `meta_cloud`; havia 8 números Baileys e 1 Meta Cloud no momento da consulta. As permissões de ligação devem referenciar somente IDs Baileys do mesmo tenant. |

As cinco tabelas estão com RLS ativa. `tenant_users` tem política de leitura por tenant; o Kora usa `supabaseAdmin` nas ações de concessão. Há um gatilho existente em `tenant_users`, `tenant_modules`, `tenant_config` e `whatsapp_instances` que impede alterar `tenant_id`. Não havia gatilho de mudança de papel em `tenant_users`.

A função `public.tenant_has_module(uuid, text)` retorna `false` para slugs ausentes, módulos não core sem linha `enabled` válida e filhos cujo pai está desligado. Assim, inserir os novos slugs com `default_on=false` e sem criar linhas em `tenant_modules` mantém ligações e gravação desligadas para todas as contas. O God Mode pode conceder `voice_calls` por tenant; `voice_recording` depende do pai. A interface de gravação continua indisponível até existir captura e armazenamento.

## Mudança proposta no PR

1. Inserir `voice_calls` e seu filho `voice_recording` no catálogo, ambos desligados por padrão, nas posições 70 e 71 de `atendimento`.
2. Acrescentar `tenant_users.voice_instance_ids uuid[] NOT NULL DEFAULT '{}'`. O array vazio não autoriza ligação. A ação do proprietário valida que cada ID é um número Baileys da própria conta e, para agentes com `instance_ids` restrito, que o número já lhes foi atribuído.
3. Limpar `voice_instance_ids` quando o papel do membro mudar para `owner` ou `admin`. O gatilho novo convive com o gatilho já existente que protege `tenant_id`.

Nenhuma linha de `tenant_modules`, `tenant_users` ou `whatsapp_instances` será alterada pela migração. Nenhuma tabela de mensagens ou sessão do WhatsApp é tocada. O `SET LOCAL lock_timeout = '5s'` impede que a alteração de tabela espere indefinidamente por um bloqueio de produção.

## Aplicação e verificação

A migração foi aplicada em produção em **2026-10-10** por uma consulta transacional na Management API, após uma conferência que encontrou zero slugs de voz, zero colunas de concessão, zero gatilhos de voz e zero concessões. O código do PR ainda não havia sido publicado: ele passa a ler `tenant_users.voice_instance_ids` e deve ser implantado somente depois desta alteração. A execução direta da consulta não registra automaticamente esta versão no histórico do Supabase CLI; se o projeto passar a usar esse histórico, conciliar a versão antes de rodar todas as migrações do repositório.

Após a aplicação, a consulta de leitura confirmou os dois slugs desligados por padrão, a coluna `uuid[] NOT NULL DEFAULT '{}'`, o gatilho novo e **zero** concessões em `tenant_modules`, **zero** atendentes com números de voz e **zero** tenants com `voice_calls` ou `voice_recording` efetivos. Para repetir a verificação:

```sql
SELECT slug, parent_slug, default_on
FROM public.module_catalog
WHERE slug IN ('voice_calls', 'voice_recording')
ORDER BY slug;

SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenant_users'
  AND column_name = 'voice_instance_ids';

SELECT module_slug, count(*)
FROM public.tenant_modules
WHERE module_slug IN ('voice_calls', 'voice_recording')
GROUP BY module_slug;
```

O resultado esperado da última consulta é vazio até uma concessão explícita no God Mode. Antes da publicação do código, testar com uma conta piloto: pai desligado, pai ligado sem permissão do agente, e pai ligado com permissão apenas para o número Blue. A gravação não deve aparecer como disponível para uso.

O token pessoal usado no mapeamento não integra a aplicação nem o repositório. Como foi compartilhado na conversa, deve ser revogado e substituído depois da revisão.
