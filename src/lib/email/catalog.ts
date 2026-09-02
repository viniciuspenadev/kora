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

import { buildInviteEmail, buildDailyReportEmail, buildNovidadesEmail, buildVerificationEmail, buildHealthAlertEmail, buildLoginCodeEmail, buildNewDeviceEmail, type EmailSlug } from "./send"
// ⚠️ Módulo próprio (o `send.ts` já passa de mil linhas). Entrar NO CATÁLOGO é obrigatório:
//    foi por não estarem aqui que os quatro slugs de cobrança ficaram um ano declarados e
//    invisíveis — sem template, sem preview no god mode e sem ninguém sentir falta.
import { buildBillingConfirmedEmail, buildBillingCardFailedEmail, buildBillingOverdueEmail, buildBillingRestoredEmail } from "./billing-emails"
import { SUPORTE_WHATSAPP } from "@/lib/support"

// 🔴 ERA UM NÚMERO HARDCODED E **DESATUALIZADO** (achado 07/08). Enquanto as telas do app
//    apontavam pro número oficial, os e-mails que já saem — verificação de cadastro,
//    convite, relatório diário — mandavam o cliente pra um número antigo. Ninguém percebe:
//    contato errado não dá erro, só silêncio do outro lado.
// 🔑 Fonte única em `lib/support.ts`. Trocar o número passa a ser um lugar só.
const WA = `https://wa.me/${SUPORTE_WHATSAPP}`

export interface EmailTemplateMeta {
  /** ⚠️ Tipado (`EmailSlug`, em `send.ts`): slug fora da união não compila. */
  slug:        EmailSlug
  name:        string
  description: string
  trigger:     string
  variables:   Array<{ key: string; description: string; example: string }>
  build:       () => { subject: string; html: string; text: string }
}

export const EMAIL_CATALOG: EmailTemplateMeta[] = [
  {
    slug:        "signup_verification",
    name:        "Verificação de cadastro",
    description: "Código de confirmação enviado quando um novo cliente se cadastra no trial pelo site (/signup).",
    trigger:     "Disparado ao iniciar o cadastro público; o cliente digita o código pra confirmar o email antes de criar a conta.",
    variables: [
      { key: "firstName",      description: "Primeiro nome de quem se cadastrou",     example: "Maria" },
      { key: "code",           description: "Código numérico de verificação",          example: "428193" },
      { key: "expiresMinutes", description: "Validade do código em minutos",           example: "15" },
    ],
    build: () => buildVerificationEmail({ firstName: "Maria", code: "428193", expiresMinutes: 15 }),
  },
  {
    slug:        "login_verification",
    name:        "Verificação de login (dispositivo novo)",
    description: "Código enviado quando um login vem de dispositivo não reconhecido (device trust).",
    trigger:     "Disparado por beginLogin() quando a senha está correta mas o dispositivo não tem confiança válida (30 dias). Nunca dispara com senha errada.",
    variables: [
      { key: "firstName",      description: "Primeiro nome de quem está logando",       example: "Maria" },
      { key: "code",           description: "Código numérico de verificação",            example: "915306" },
      { key: "expiresMinutes", description: "Validade do código em minutos",             example: "10" },
      { key: "deviceLabel",    description: "Dispositivo da tentativa (derivado do UA)", example: "Chrome no Windows" },
      { key: "ip",             description: "IP da tentativa (pode ser null)",           example: "187.45.101.22" },
    ],
    build: () => buildLoginCodeEmail({ firstName: "Maria", code: "915306", expiresMinutes: 10, deviceLabel: "Chrome no Windows", ip: "187.45.101.22" }),
  },
  {
    slug:        "new_device_login",
    name:        "Novo acesso (dispositivo novo)",
    description: "Aviso de que um dispositivo novo entrou na conta, com botão de desconectar em 1 clique (não exige login).",
    trigger:     "Disparado quando um desafio de login é concluído com sucesso num dispositivo novo (confirmLoginCode). Fire-and-forget.",
    variables: [
      { key: "firstName",   description: "Primeiro nome do dono da conta",              example: "Maria" },
      { key: "deviceLabel", description: "Dispositivo que entrou (derivado do UA)",      example: "Chrome no Windows" },
      { key: "ip",          description: "IP do acesso (pode ser null)",                 example: "187.45.101.22" },
      { key: "when",        description: "Momento do acesso (ISO)",                      example: "2026-07-22T14:32:00Z" },
      { key: "revokeUrl",   description: "Link assinado de revogação (7 dias, sem login)", example: "https://app/device/revogar/abc.def" },
    ],
    build: () => buildNewDeviceEmail({ firstName: "Maria", deviceLabel: "Chrome no Windows", ip: "187.45.101.22", when: new Date().toISOString(), revokeUrl: "https://app.exemplo.com/device/revogar/exemplo-token" }),
  },
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
    slug:        "whatsapp_health_alert",
    name:        "Alerta de saúde do WhatsApp oficial",
    description: "Aviso ao dono/admin quando o número oficial é restrito/banido pela Meta ou a qualidade cai (vermelho).",
    trigger:     "Disparado pelo webhook da Meta (account_update/phone_number_quality_update) quando o número entra em risco.",
    variables: [
      { key: "name",     description: "Nome do destinatário (pode ser null)", example: "Vinicius" },
      { key: "status",   description: "Status do número",                     example: "RESTRICTED" },
      { key: "reason",   description: "Motivo informado pela Meta",           example: "RESTRICTED_CUSTOMER_INITIATED_MESSAGING" },
      { key: "critical", description: "Crítico (restrição/ban) vs aviso",     example: "true" },
    ],
    build: () => buildHealthAlertEmail({ name: "Vinicius", status: "RESTRICTED", reason: "RESTRICTED_CUSTOMER_INITIATED_MESSAGING", critical: true }),
  },
  {
    slug:        "daily_report",
    name:        "Relatório diário",
    description: "Resumo de KPIs do dia (novas conversas, mensagens, novos contatos, leads de anúncio) enviado pros responsáveis do tenant.",
    trigger:     "Disparado pelo cron /api/cron/daily-reports às 18h Brasil, 1x por dia. Tenant pode desligar em /configuracoes/relatorios.",
    variables: [
      { key: "tenantName",       description: "Nome do tenant",                                       example: "Bernardo Concept" },
      { key: "reportDate",       description: "Dia coberto pelo relatório (ISO YYYY-MM-DD)",          example: "2026-05-26" },
      { key: "newConversations", description: "Conversas ativas no dia (com atividade)",             example: "12" },
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
  {
    slug:        "novidades",
    name:        "Novidades (marketing)",
    description: "Recap de tudo que o Kora ganhou desde o lançamento + upsell da Kora IA (Pro/Enterprise). Campanha manual.",
    trigger:     "Disparo manual pelo god mode (não automático). Use 'Enviar teste' antes de qualquer campanha.",
    variables: [
      { key: "primeiro_nome",   description: "Primeiro nome do destinatário",          example: "Bernardo" },
      { key: "unsubscribe_url", description: "Link de descadastro (compliance)",        example: "https://app/unsub/token" },
    ],
    build: () => buildNovidadesEmail({
      firstName:      "Bernardo",
      unsubscribeUrl: "https://kora.bluedigitalhub.com.br/descadastro",
      waLink:         `${WA}?text=${encodeURIComponent("Oi! Quero saber mais sobre o Kora.")}`,
      waLinkAI:       `${WA}?text=${encodeURIComponent("Oi! Quero ativar a Kora IA (Pro/Enterprise).")}`,
    }),
  },
  // ── Cobrança ─────────────────────────────────────────────────────────────
  // Os quatro degraus da escada, na ordem em que o cliente os vive.
  {
    slug:        "billing_card_failed",
    name:        "Cartão recusado",
    description: "Aviso de que a cobrança não passou. É o degrau 1 — nada foi cortado ainda.",
    trigger:     "Disparado quando o gateway informa falha na cobrança do cartão, ANTES de qualquer corte. Escopo dinheiro (só owner).",
    variables: [
      { key: "valorCents", description: "Valor que não passou, em centavos", example: "34990" },
    ],
    build: () => buildBillingCardFailedEmail({ valorCents: 34990 }),
  },
  {
    slug:        "billing_overdue",
    name:        "Fatura em aberto",
    description: "Fatura vencida: diz o que PAROU e, antes disso, o que continua funcionando.",
    trigger:     "Disparado quando o tenant entra em atraso (degrau 2 — campanhas, IA e automações pausadas). Escopo dinheiro.",
    variables: [
      { key: "valorCents",   description: "Valor em aberto, em centavos",            example: "34990" },
      { key: "quando",       description: "Data do vencimento, já formatada",         example: "11 de agosto" },
      { key: "diasCarencia", description: "Dias restantes antes do produto fechar",   example: "7" },
    ],
    build: () => buildBillingOverdueEmail({ valorCents: 34990, quando: "11 de agosto", diasCarencia: 7 }),
  },
  {
    slug:        "billing_payment_confirmed",
    name:        "Pagamento confirmado",
    description: "Confirmação ao cliente de que o pagamento entrou.",
    trigger:     "Disparado pelo webhook do gateway ao confirmar o pagamento. Deduplicado pelo pagamento, não pelo evento.",
    variables: [
      { key: "valorCents", description: "Valor pago, em centavos",        example: "34990" },
      { key: "quando",     description: "Data do pagamento, formatada",   example: "8 de agosto" },
    ],
    build: () => buildBillingConfirmedEmail({ valorCents: 34990, quando: "8 de agosto" }),
  },
  {
    slug:        "billing_restored",
    name:        "Tudo voltou ao normal",
    description: "Fecha o ciclo: avisa que campanhas, IA e automações voltaram.",
    trigger:     "Disparado quando o tenant sai do estado restrito depois de regularizar.",
    variables:   [],
    build: () => buildBillingRestoredEmail(),
  },
]

export function getEmailTemplate(slug: string): EmailTemplateMeta | null {
  return EMAIL_CATALOG.find((t) => t.slug === slug) ?? null
}
