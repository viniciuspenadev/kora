/**
 * Catalog de templates de email transacionais do Kora.
 *
 * Cada entrada descreve:
 *   - slug:          identificador único usado em URLs (/admin/emails/[slug])
 *   - name:          nome curto pra UI
 *   - description:   contexto pra time saber pra que serve
 *   - trigger:       quando o sistema dispara (texto humano)
 *   - variables:     lista de variáveis injetadas pelo backend (pra debugging)
 *   - sampleContext: dados de exemplo pra preview (texto fake mas realista)
 *   - build:         função que retorna { subject, html, text } com o sample
 *
 * Pra adicionar um template novo (reset de senha, welcome, etc):
 *   1. Implementa `buildXxxEmail(ctx)` em `src/lib/email/send.ts`
 *   2. Adiciona entrada aqui
 *   3. Aparece automaticamente em /admin/emails
 */

import { buildInviteEmail, buildDailyReportEmail } from "./send"

export interface EmailTemplateMeta {
  slug:        string
  name:        string
  description: string
  trigger:     string
  variables:   Array<{ key: string; description: string; example: string }>
  build:       () => { subject: string; html: string; text: string }
}

export const EMAIL_CATALOG: EmailTemplateMeta[] = [
  {
    slug:        "invite",
    name:        "Convite de equipe",
    description: "Email enviado quando um admin convida um atendente novo a entrar no tenant.",
    trigger:     "Disparado por inviteTeamMember() em /configuracoes/equipe ao adicionar atendente.",
    variables: [
      { key: "inviteUrl",     description: "URL com token pra aceitar o convite",       example: "https://app/invite/abc123" },
      { key: "tenantName",    description: "Nome do tenant que está convidando",         example: "Bernardo Concept" },
      { key: "roleLabel",     description: "Papel atribuído (Owner/Admin/Atendente)",    example: "Atendente" },
      { key: "inviterName",   description: "Quem mandou o convite (pode ser null)",      example: "Vinicius Pena" },
      { key: "expiresInDays", description: "Validade do link em dias",                   example: "7" },
    ],
    build: () => buildInviteEmail({
      inviteUrl:     "https://app.bluedigitalhub.com.br/invite/exemplo-token-aqui",
      tenantName:    "Bernardo Concept",
      roleLabel:     "Atendente",
      inviterName:   "Vinicius Pena",
      expiresInDays: 7,
    }),
  },
  {
    slug:        "daily_report",
    name:        "Relatório diário",
    description: "Resumo de KPIs do dia (novas conversas, mensagens, novos contatos, leads de anúncio) enviado pros responsáveis do tenant.",
    trigger:     "Disparado pelo cron /api/cron/daily-reports às 18h Brasil, 1x por dia. Tenant pode desligar em /configuracoes/relatorios.",
    variables: [
      { key: "tenantName",       description: "Nome do tenant",                                       example: "Bernardo Concept" },
      { key: "reportDate",       description: "Dia coberto pelo relatório (ISO YYYY-MM-DD)",          example: "2026-05-26" },
      { key: "newConversations", description: "Conversas criadas no dia",                            example: "12" },
      { key: "messagesIn",       description: "Mensagens recebidas (sender_type=contact)",           example: "184" },
      { key: "messagesOut",      description: "Mensagens enviadas (sender_type=agent)",              example: "97" },
      { key: "newContacts",      description: "Contatos novos criados",                              example: "8" },
      { key: "fromAdLeads",      description: "Conversas que vieram de anúncio Meta (CTWA)",         example: "3" },
      { key: "appUrl",           description: "URL base do app (pra link 'Abrir inbox')",            example: "https://app.bluedigitalhub.com.br" },
    ],
    build: () => buildDailyReportEmail({
      tenantName:       "Bernardo Concept",
      reportDate:       new Date().toISOString().slice(0, 10),
      newConversations: 12,
      messagesIn:       184,
      messagesOut:      97,
      newContacts:      8,
      fromAdLeads:      3,
      previous: {
        newConversations: 9,
        messagesIn:       142,
        messagesOut:      88,
        newContacts:      5,
        fromAdLeads:      1,
      },
      appUrl:           "https://kora.bluedigitalhub.com.br",
    }),
  },
]

export function getEmailTemplate(slug: string): EmailTemplateMeta | null {
  return EMAIL_CATALOG.find((t) => t.slug === slug) ?? null
}
