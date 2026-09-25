# Assinatura de atendente no WhatsApp — 24/09/2026

Código da assinatura presente no main de produção (00a491f). Migration aplicada em 24/09/2026 após autorização do owner. Nenhuma regra foi ativada e nenhum envio real foi realizado por esta execução.

## Regras
- WhatsApp Evolution/Baileys e API Oficial: textos humanos e legendas não vazias. Texto em grupos Evolution incluído; anexos de grupo continuam fora do corte anterior.
- Prioridade: agente (ligar/desligar/herdar) → departamento da conversa → empresa. Padrão desligado. Sem configuração por número.
- Nome personalizado pela gestão ou nome do perfil do autor autenticado, nunca o responsável pela conversa/negócio. Formatação: *Nome* + linha vazia + corpo.
- Templates, automações, notas internas, webchat, Instagram, áudios e anexos sem legenda não são assinados.
- Assinatura aplicada apenas nas actions de envio manual, sem alterar provedores/webhooks. Snapshot em metadata.agent_signature; histórico e texto editado preservam o nome original. Edição continua restrita aos canais já suportados; não habilita edição na API Oficial nem em grupos.
- Texto/legenda retornados ao cliente após o envio são os mesmos persistidos e enviados. Limites incluem o prefixo (4096 texto; 1024 legenda assinada).

## Configuração
Nova aba Assinatura em /configuracoes/atendimento: padrão, exceções por departamento, exceções e nome por agente, prévia e salvar próprio. Somente owner/admin, com membership atual. IDs devem pertencer à mesma empresa. Gravação limitada ao campo agent_signature e comparação com o valor anterior para evitar sobrescrita concorrente.

## Banco / liberação
Migration 20260924000100_agent_signature_policy.sql cria uma coluna JSONB nullable em tenant_config, com CHECK de objeto. Sem UPDATE de registros, alteração de RLS/grants, novas tabelas ou ativação automática. Rollback documentado (remove regras salvas; mensagens já enviadas não mudam).
Pré-checagem administrativa confirmou coluna ausente. Aplicação HTTP 201, coluna JSONB nullable e CHECK confirmados. RLS, ACL e quantidade de policies idênticos antes/depois. Zero configurações preenchidas. Pós-checagem REST HTTP 200; Blue permanece sem assinatura configurada.
Pendente homologação visual e de envio real com agente/destinatário escolhidos pelo owner. A assinatura permanece desligada por padrão e pode ser configurada pela gestão em Atendimento → Assinatura. Status HTTP 200 no login e /api/version após a migration; build observado: iFxB9Ja9XO5TEYrs3uuAr. Isso confirma disponibilidade, não associa o build a um commit.

## Validação
- 79 testes em sete arquivos: prioridade, escopo de tenant/autor, papel da gestão, validação de nomes/IDs, concorrência, envio individual Baileys/Meta com provedores simulados, legendas/áudio/notas/webchat, grupo, edição/exclusão e visibilidade.
- TypeScript e lint dos novos componentes/actions sem erros. Build e quatro gates de prebuild aprovados. Avisos existentes de fetch financeiro indisponível no prerender local permanecem.
- Inspeção visual em navegador PENDENTE: automação local falhou ao criar processo Windows (1920); reset também falhou. Fixture pronta em .tmp/signature-preview, ignorada pelo Git e sem credenciais.
- Não houve mudança de permissões de leitura, schema de mensagens ou regras de atendimento/CRM. Novas leituras/configurações são autenticadas e tenant-scoped; assinatura não aceita nome informado pelo cliente no envio.
