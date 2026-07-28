/**
 * Cliente de email via Resend (REST API).
 *
 * Por que Resend e não nodemailer:
 *  - SMTP precisa de servidor próprio + SPF/DKIM + monitoring de bounce
 *  - Resend resolve isso por $0–20/mês com domínio próprio verificado
 *  - REST puro (sem SDK) mantém deps lean
 *
 * Config via env:
 *   RESEND_API_KEY    = re_xxx
 *   EMAIL_FROM        = "Kora <noreply@kora.bluedigitalhub.com.br>"
 *
 * Se RESEND_API_KEY estiver vazio, sendEmail() retorna `configured: false`
 * — o caller deve avisar o usuário pra configurar antes de usar.
 *
 * Outbox: toda chamada cria 1 linha em email_outbox. Webhook do Resend
 * atualiza o status (delivered/opened/bounced/etc) pelo `resend_id`.
 */

import { supabaseAdmin } from "@/lib/supabase"

interface SendInput {
  to:           string
  subject:      string
  html:         string
  text?:        string
  /** Slug do template do catalog (pra agrupar/filtrar no outbox). */
  templateSlug: string
  /** Vincula o envio ao tenant pra filtros no /admin/emails/log. */
  tenantId?:    string
  /** Payload extra opcional armazenado em email_outbox.metadata. */
  metadata?:    Record<string, unknown>
}

export type EmailResult =
  | { ok: true;  id: string }
  | { ok: false; configured: false }
  | { ok: false; configured: true; error: string }

export async function sendEmail(input: SendInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.EMAIL_FROM

  // ── 1. Cria registro no outbox (status=pending) antes de bater na API ──
  //    Garante que mesmo se a chamada falhar/timeout, o admin VÊ a tentativa.
  const { data: outbox } = await supabaseAdmin
    .from("email_outbox")
    .insert({
      tenant_id:     input.tenantId ?? null,
      template_slug: input.templateSlug,
      to_email:      input.to,
      subject:       input.subject,
      status:        "pending",
      metadata:      input.metadata ?? {},
    })
    .select("id")
    .single()

  const outboxId = outbox?.id as string | undefined

  if (!apiKey || !from) {
    if (outboxId) {
      await supabaseAdmin
        .from("email_outbox")
        .update({ status: "failed", error: "RESEND_API_KEY ou EMAIL_FROM não configurados" })
        .eq("id", outboxId)
    }
    return { ok: false, configured: false }
  }

  // ── 2. Chama API Resend ──────────────────────────────────────
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from,
        to:      [input.to],
        subject: input.subject,
        html:    input.html,
        ...(input.text ? { text: input.text } : {}),
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      const errorMsg = `Resend ${res.status}: ${text.slice(0, 200)}`
      if (outboxId) {
        await supabaseAdmin
          .from("email_outbox")
          .update({ status: "failed", error: errorMsg })
          .eq("id", outboxId)
      }
      return { ok: false, configured: true, error: errorMsg }
    }

    const json = await res.json() as { id?: string }
    const resendId = json.id ?? ""

    if (outboxId) {
      await supabaseAdmin
        .from("email_outbox")
        .update({
          resend_id: resendId || null,
          status:    "sent",
          sent_at:   new Date().toISOString(),
        })
        .eq("id", outboxId)
    }
    return { ok: true, id: resendId }
  } catch (err) {
    const errorMsg = `Falha de rede: ${(err as Error).message}`
    if (outboxId) {
      await supabaseAdmin
        .from("email_outbox")
        .update({ status: "failed", error: errorMsg })
        .eq("id", outboxId)
    }
    return { ok: false, configured: true, error: errorMsg }
  }
}

// ── Templates ───────────────────────────────────────────────────

export interface InviteEmailContext {
  inviteUrl:    string
  tenantName:   string
  roleLabel:    string
  inviterName?: string | null
  expiresInDays: number
}

export function getAppBaseUrl(): string {
  return process.env.AUTH_URL
      ?? process.env.NEXTAUTH_URL
      ?? "http://localhost:3000"
}

export function buildInviteEmail(ctx: InviteEmailContext): { subject: string; html: string; text: string } {
  const subject = `Você foi convidado para o ${ctx.tenantName} no Kora`
  const logoUrl = `${getAppBaseUrl()}/logo_kora.png`

  const text = `Olá!

${ctx.inviterName ? `${ctx.inviterName} convidou você` : "Você foi convidado"} para entrar no time do ${ctx.tenantName} no Kora, como ${ctx.roleLabel}.

Aceite o convite no link abaixo (válido por ${ctx.expiresInDays} dias):

${ctx.inviteUrl}

Se já tiver conta, é só clicar e está dentro. Se não tiver, você cria a senha em segundos.

—
Kora
`

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px 32px;">
              <img src="${logoUrl}" alt="Kora" height="28" style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">
                Você foi convidado para o <span style="color:#004add;">${escapeHtml(ctx.tenantName)}</span>
              </h1>
              <p style="margin:0 0 24px 0;font-size:14px;color:#475569;line-height:1.6;">
                ${ctx.inviterName ? `<strong>${escapeHtml(ctx.inviterName)}</strong> está te chamando` : "Você foi chamado"} pra entrar no time como <strong>${escapeHtml(ctx.roleLabel)}</strong>. Aceite o convite pra começar a usar o sistema.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <a href="${ctx.inviteUrl}" style="display:inline-block;background:#004add;color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:10px;text-decoration:none;">
                Aceitar convite
              </a>
              <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
                Ou copie e cole este link no navegador:<br>
                <span style="color:#64748b;word-break:break-all;">${ctx.inviteUrl}</span>
              </p>
              <p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;">
                Este link expira em ${ctx.expiresInDays} dias.
              </p>
            </td>
          </tr>
        </table>
        <p style="max-width:540px;margin:16px auto 0 auto;font-size:11px;color:#94a3b8;text-align:center;">
          Se você não esperava esse convite, pode ignorar este email.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// ── Alerta de saúde do número oficial (restrição / qualidade) ──────

export interface HealthAlertEmailContext {
  name:     string | null
  status:   string        // RESTRICTED | BANNED | FLAGGED | Qualidade baixa | ...
  reason:   string | null
  critical: boolean
}

/** Aviso ao dono/admin quando o número oficial é restrito/banido ou a qualidade cai. */
export function buildHealthAlertEmail(ctx: HealthAlertEmailContext): { subject: string; html: string; text: string } {
  const headline = ctx.critical ? "Seu número oficial está em risco" : "A qualidade do seu número caiu"
  const subject  = ctx.critical ? "🔴 WhatsApp oficial em risco — ação recomendada" : "🟡 Qualidade do WhatsApp oficial caiu"
  const logoUrl  = `${getAppBaseUrl()}/logo_kora.png`
  const link     = `${getAppBaseUrl()}/integracoes/whatsapp-oficial`
  const accent   = ctx.critical ? "#dc2626" : "#d97706"
  const greeting = ctx.name ? `Olá, ${ctx.name}!` : "Olá!"

  const text = `${greeting}

${headline}.

Status: ${ctx.status}${ctx.reason ? `\nMotivo: ${ctx.reason}` : ""}

${ctx.critical
  ? "Seus envios podem estar limitados. Revise suas mensagens e templates para regularizar o número."
  : "Revise seus envios (evite mensagens marcadas como spam) para não perder limite de envio."}

Ver detalhes: ${link}

—
Kora
`

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px 32px;">
          <img src="${logoUrl}" alt="Kora" height="28" style="display:block;height:28px;width:auto;border:0;" />
        </td></tr>
        <tr><td style="padding:0 32px 8px 32px;">
          <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:700;line-height:1.3;">
            <span style="color:${accent};">${escapeHtml(headline)}</span>
          </h1>
          <p style="margin:0 0 16px 0;font-size:14px;color:#475569;line-height:1.6;">
            Status do número: <strong>${escapeHtml(ctx.status)}</strong>.${ctx.reason ? ` Motivo: ${escapeHtml(ctx.reason)}.` : ""}
          </p>
          <p style="margin:0 0 24px 0;font-size:14px;color:#475569;line-height:1.6;">
            ${ctx.critical
              ? "Seus envios podem estar limitados. Revise suas mensagens e templates para regularizar o número o quanto antes."
              : "Revise seus envios (evite conteúdo marcado como spam) para não perder limite de envio."}
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 32px 32px;">
          <a href="${link}" style="display:inline-block;background:#004add;color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:10px;text-decoration:none;">
            Ver saúde do número
          </a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// ── Verificação de cadastro (trial self-serve) ────────────────────

export interface VerificationEmailContext {
  firstName:      string
  code:           string
  expiresMinutes: number
}

/** Código de confirmação de email no cadastro público do trial (/signup). */
export function buildVerificationEmail(ctx: VerificationEmailContext): { subject: string; html: string; text: string } {
  // Assunto SEM o código — o OTP é segredo de vida curta e não pode persistir no
  // email_outbox.subject nem vazar em preview de notificação. Código só no corpo.
  const subject = `Seu código de verificação · Kora`
  const logoUrl = `${getAppBaseUrl()}/logo_kora.png`

  const text = `Olá, ${ctx.firstName}!

Seu código de verificação no Kora é:

${ctx.code}

Digite esse código na tela de cadastro pra confirmar seu email. Ele expira em ${ctx.expiresMinutes} minutos.

Se você não tentou criar uma conta no Kora, ignore este email.

—
Kora
`

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="padding:32px 32px 16px 32px;">
          <img src="${logoUrl}" alt="Kora" height="28" style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="padding:0 32px 8px 32px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;">Confirme seu email</h1>
          <p style="margin:0 0 20px 0;font-size:14px;color:#475569;line-height:1.6;">
            Olá, <strong>${escapeHtml(ctx.firstName)}</strong>! Use o código abaixo pra confirmar seu cadastro no Kora.
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <div style="background:#f0f4ff;border:1px solid #bcd0ff;border-radius:12px;padding:18px;text-align:center;">
            <span style="font-size:34px;font-weight:800;letter-spacing:10px;color:#004add;font-variant-numeric:tabular-nums;">${escapeHtml(ctx.code)}</span>
          </div>
          <p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
            Este código expira em ${ctx.expiresMinutes} minutos. Se você não tentou criar uma conta, ignore este email.
          </p>
        </td></tr>
      </table>
      <p style="max-width:480px;margin:16px auto 0 auto;font-size:11px;color:#94a3b8;text-align:center;">
        Kora · WhatsApp Business para times de atendimento
      </p>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// ── Código de verificação de LOGIN (device trust) ─────────────────

export interface LoginCodeEmailContext {
  firstName:      string
  code:           string
  expiresMinutes: number
  deviceLabel:    string
  ip:             string | null
}

/**
 * Código enviado quando um LOGIN vem de dispositivo não reconhecido
 * (docs/auth-device-trust-design.md §9). Mostra dispositivo/IP da tentativa —
 * se não foi a pessoa, o alerta pra trocar a senha é a parte que importa.
 */
export function buildLoginCodeEmail(ctx: LoginCodeEmailContext): { subject: string; html: string; text: string } {
  // Assunto SEM o código (OTP não persiste em outbox/preview — mesma regra do signup).
  const subject = `Seu código de acesso · Kora`
  const logoUrl = `${getAppBaseUrl()}/logo_kora.png`
  const origin  = ctx.ip ? `${ctx.deviceLabel} · IP ${ctx.ip}` : ctx.deviceLabel

  const text = `Olá, ${ctx.firstName}!

Recebemos uma tentativa de login na sua conta Kora a partir de um dispositivo não reconhecido:

${origin}

Se foi você, use o código abaixo pra confirmar o acesso:

${ctx.code}

Ele expira em ${ctx.expiresMinutes} minutos.

NUNCA compartilhe este código com ninguém — nem com o suporte. A Kora jamais pede seu código por telefone, WhatsApp ou e-mail.

Se NÃO foi você, não use o código — sua senha está correta em posse de outra pessoa. Troque a senha em Configurações → Perfil assim que possível.

—
Kora
`

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="padding:32px 32px 16px 32px;">
          <img src="${logoUrl}" alt="Kora" height="28" style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="padding:0 32px 8px 32px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;">Confirme este acesso</h1>
          <p style="margin:0 0 12px 0;font-size:14px;color:#475569;line-height:1.6;">
            Olá, <strong>${escapeHtml(ctx.firstName)}</strong>! Recebemos uma tentativa de login na sua conta a partir de um dispositivo não reconhecido:
          </p>
          <p style="margin:0 0 20px 0;font-size:13px;color:#0f172a;line-height:1.6;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;">
            ${escapeHtml(origin)}
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <div style="background:#f0f4ff;border:1px solid #bcd0ff;border-radius:12px;padding:18px;text-align:center;">
            <span style="font-size:34px;font-weight:800;letter-spacing:10px;color:#004add;font-variant-numeric:tabular-nums;">${escapeHtml(ctx.code)}</span>
          </div>
          <p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
            Este código expira em ${ctx.expiresMinutes} minutos. <strong style="color:#64748b;">Nunca compartilhe este código com ninguém — nem com o suporte.</strong> A Kora jamais pede seu código por telefone, WhatsApp ou e-mail.
          </p>
          <p style="margin:12px 0 0 0;font-size:12px;color:#b45309;line-height:1.6;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;">
            <strong>Não foi você?</strong> Não use o código — sua senha está correta em posse de outra pessoa. Troque a senha em Configurações → Perfil assim que possível.
          </p>
        </td></tr>
      </table>
      <p style="max-width:480px;margin:16px auto 0 auto;font-size:11px;color:#94a3b8;text-align:center;">
        Kora · WhatsApp Business para times de atendimento
      </p>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// ── Novo acesso confirmado (device trust F5) ──────────────────────

export interface NewDeviceEmailContext {
  firstName:   string
  deviceLabel: string
  ip:          string | null
  when:        string        // ISO — momento do acesso
  revokeUrl:   string        // link de revogação em 1 clique (7 dias)
}

/**
 * Aviso de que um dispositivo NOVO entrou na conta (depois do código validado).
 * É a peça de DETECÇÃO do design: se não foi a pessoa, o botão derruba o
 * dispositivo sem precisar logar.
 */
export function buildNewDeviceEmail(ctx: NewDeviceEmailContext): { subject: string; html: string; text: string } {
  const subject = `Novo acesso à sua conta · Kora`
  const logoUrl = `${getAppBaseUrl()}/logo_kora.png`
  const whenStr = new Date(ctx.when).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  })
  const origin = ctx.ip ? `${ctx.deviceLabel} · IP ${ctx.ip}` : ctx.deviceLabel

  const text = `Olá, ${ctx.firstName}!

Um novo dispositivo acabou de entrar na sua conta Kora:

${origin}
${whenStr}

Foi você? Então está tudo certo — nada a fazer.

NÃO foi você? Desconecte o dispositivo agora (o link vale por 7 dias):

${ctx.revokeUrl}

E troque sua senha em Configurações → Perfil — quem entrou usou a senha correta E o código enviado ao seu e-mail.

—
Kora
`

  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="padding:32px 32px 16px 32px;">
          <img src="${logoUrl}" alt="Kora" height="28" style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
        </td></tr>
        <tr><td style="padding:0 32px 8px 32px;">
          <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;line-height:1.3;">Novo acesso à sua conta</h1>
          <p style="margin:0 0 12px 0;font-size:14px;color:#475569;line-height:1.6;">
            Olá, <strong>${escapeHtml(ctx.firstName)}</strong>! Um dispositivo novo acabou de entrar na sua conta:
          </p>
          <p style="margin:0 0 8px 0;font-size:13px;color:#0f172a;line-height:1.6;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;">
            <strong>${escapeHtml(origin)}</strong><br/>
            <span style="color:#64748b;">${escapeHtml(whenStr)}</span>
          </p>
          <p style="margin:0 0 20px 0;font-size:13px;color:#475569;line-height:1.6;">
            Foi você? Então está tudo certo — nada a fazer.
          </p>
        </td></tr>
        <tr><td style="padding:0 32px 28px 32px;">
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px;">
            <p style="margin:0 0 12px 0;font-size:13px;color:#92400e;line-height:1.6;">
              <strong>Não foi você?</strong> Desconecte o dispositivo agora — e depois troque sua senha:
              quem entrou usou a senha correta <em>e</em> o código enviado ao seu e-mail.
            </p>
            <a href="${ctx.revokeUrl}" style="display:inline-block;background:#b45309;color:#ffffff;font-size:13px;font-weight:700;padding:10px 18px;border-radius:10px;text-decoration:none;">
              Desconectar este dispositivo
            </a>
            <p style="margin:10px 0 0 0;font-size:11px;color:#a16207;">O link vale por 7 dias e não exige login.</p>
          </div>
        </td></tr>
      </table>
      <p style="max-width:480px;margin:16px auto 0 auto;font-size:11px;color:#94a3b8;text-align:center;">
        Kora · WhatsApp Business para times de atendimento
      </p>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// ── Relatório diário ──────────────────────────────────────────────

export interface DailyReportContext {
  tenantName:        string
  reportDate:        string  // ISO date (YYYY-MM-DD) do dia coberto
  newConversations:  number
  messagesIn:        number
  messagesOut:       number
  newContacts:       number
  fromAdLeads:       number
  /** KPIs do dia anterior — usados pra mostrar tendência (↑/↓ %). */
  previous: {
    newConversations: number
    messagesIn:       number
    messagesOut:      number
    newContacts:      number
    fromAdLeads:      number
  }
  appUrl:            string  // link pro inbox
}

function formatBRDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
}

function formatBRShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
}

/**
 * Calcula delta % entre curr e prev. Retorna HTML inline com seta + cor.
 * Lógica:
 *   - prev=0 e curr=0  → "—" cinza
 *   - prev=0 e curr>0  → "novo" verde
 *   - curr > prev      → "↑ X%" verde
 *   - curr < prev      → "↓ X%" laranja/vermelho
 *   - curr = prev      → "= 0%" cinza
 */
function deltaBadge(curr: number, prev: number): string {
  if (prev === 0 && curr === 0) {
    return `<span style="display:inline-block;font-size:11px;font-weight:600;color:#94a3b8;background:#f1f5f9;padding:2px 7px;border-radius:99px;">sem dados</span>`
  }
  if (prev === 0 && curr > 0) {
    return `<span style="display:inline-block;font-size:11px;font-weight:700;color:#047857;background:#d1fae5;padding:2px 7px;border-radius:99px;">novo</span>`
  }
  const pct = Math.round(((curr - prev) / prev) * 100)
  if (pct === 0) {
    return `<span style="display:inline-block;font-size:11px;font-weight:600;color:#64748b;background:#f1f5f9;padding:2px 7px;border-radius:99px;">igual a ontem</span>`
  }
  if (pct > 0) {
    return `<span style="display:inline-block;font-size:11px;font-weight:700;color:#047857;background:#d1fae5;padding:2px 7px;border-radius:99px;">↑ ${pct}%</span>`
  }
  return `<span style="display:inline-block;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;padding:2px 7px;border-radius:99px;">↓ ${Math.abs(pct)}%</span>`
}

function generateInsight(ctx: DailyReportContext): string | null {
  const totalMsgs = ctx.messagesIn + ctx.messagesOut
  const totalMsgsPrev = ctx.previous.messagesIn + ctx.previous.messagesOut

  // Prioridade: ads > volume > engajamento
  if (ctx.fromAdLeads > 0 && ctx.fromAdLeads >= 3) {
    return `📣 <strong>Dia forte de anúncios:</strong> ${ctx.fromAdLeads} leads vieram de campanhas Meta hoje. Acompanhe os criativos em <a href="${ctx.appUrl}/relatorios/anuncios" style="color:#004add;text-decoration:none;font-weight:600;">Relatórios → Anúncios</a>.`
  }
  if (totalMsgsPrev > 0 && totalMsgs > totalMsgsPrev * 1.3) {
    const pct = Math.round(((totalMsgs - totalMsgsPrev) / totalMsgsPrev) * 100)
    return `📈 <strong>Dia movimentado:</strong> ${pct}% mais mensagens que ontem (${totalMsgs} vs ${totalMsgsPrev}).`
  }
  if (ctx.messagesIn > 0 && ctx.messagesOut < ctx.messagesIn * 0.3) {
    return `💡 <strong>Atenção ao backlog:</strong> ${ctx.messagesIn} mensagens chegaram mas só ${ctx.messagesOut} foram respondidas. Talvez tenha conversas esperando resposta.`
  }
  if (ctx.newContacts > 0) {
    return `👋 <strong>${ctx.newContacts} contato${ctx.newContacts > 1 ? "s" : ""} novo${ctx.newContacts > 1 ? "s" : ""}</strong> chegaram hoje.`
  }
  if (totalMsgs === 0) {
    return `🌙 Dia tranquilo, sem mensagens trocadas.`
  }
  return null
}

export function buildDailyReportEmail(ctx: DailyReportContext): { subject: string; html: string; text: string } {
  const dateFull = formatBRDate(ctx.reportDate)
  const dateShort = formatBRShort(ctx.reportDate)
  const weekday = dateFull.split(",")[0]
  const subject = `📊 ${ctx.tenantName} — Resumo de ${dateShort}`
  const base = getAppBaseUrl()
  const logoUrl      = `${base}/logo_kora.png`         // azul, usado em fundo branco (footer)
  const logoWhiteUrl = `${base}/logo_kora_branco.png`  // branca, usada em fundo primary (hero)

  const totalInteractions = ctx.messagesIn + ctx.messagesOut
  const totalPrev = ctx.previous.messagesIn + ctx.previous.messagesOut

  const text = `Olá! Aqui está o resumo de hoje no ${ctx.tenantName}.

${dateFull}

INTERAÇÕES TOTAIS: ${totalInteractions} (ontem: ${totalPrev})

Conversas:              ${ctx.newConversations} (ontem: ${ctx.previous.newConversations})
Novos contatos:         ${ctx.newContacts} (ontem: ${ctx.previous.newContacts})
Mensagens recebidas:    ${ctx.messagesIn} (ontem: ${ctx.previous.messagesIn})
Mensagens enviadas:     ${ctx.messagesOut} (ontem: ${ctx.previous.messagesOut})
Leads de anúncio Meta:  ${ctx.fromAdLeads} (ontem: ${ctx.previous.fromAdLeads})

Ver inbox: ${ctx.appUrl}/inbox

—
Kora · ${ctx.appUrl}
`

  const insight = generateInsight(ctx)

  // Componente reutilizável de card KPI com delta.
  // Layout em <table> (não flex) — display:flex é ignorado por Gmail/Outlook.
  const kpiCard = (label: string, value: number, prev: number, icon: string, accent = false) => `
    <td style="padding:0;width:50%;vertical-align:top;">
      <div style="background:${accent ? "#f0f4ff" : "#ffffff"};border:1px solid ${accent ? "#bcd0ff" : "#e2e8f0"};border-radius:14px;padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td style="vertical-align:middle;text-align:left;line-height:1;">
              <span style="font-size:20px;line-height:1;display:inline-block;">${icon}</span>
            </td>
            <td style="vertical-align:middle;text-align:right;line-height:1;">
              ${deltaBadge(value, prev)}
            </td>
          </tr>
        </table>
        <p style="margin:0 0 2px 0;font-size:30px;font-weight:700;color:${accent ? "#004add" : "#0f172a"};font-variant-numeric:tabular-nums;line-height:1.05;letter-spacing:-0.02em;">${value}</p>
        <p style="margin:0;font-size:12px;font-weight:600;color:#475569;">${label}</p>
        <p style="margin:2px 0 0 0;font-size:10px;color:#94a3b8;">ontem: ${prev}</p>
      </div>
    </td>
  `

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
  <span style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${totalInteractions} interações hoje · ${ctx.newConversations} conversas · ${ctx.newContacts} contatos novos
  </span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.04);">

          <!-- HERO -->
          <tr>
            <td style="background:#004add;background-image:linear-gradient(135deg,#004add 0%,#0033a8 100%);padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${logoWhiteUrl}" alt="Kora" height="24" style="display:block;height:24px;width:auto;border:0;outline:none;text-decoration:none;" />
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <span style="display:inline-block;font-size:11px;font-weight:600;color:#bcd0ff;text-transform:uppercase;letter-spacing:0.06em;">
                      Resumo diário
                    </span>
                  </td>
                </tr>
              </table>
              <h1 style="margin:18px 0 4px 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;letter-spacing:-0.01em;">
                Bom trabalho hoje, ${escapeHtml(ctx.tenantName)}.
              </h1>
              <p style="margin:0;font-size:13px;color:#bcd0ff;text-transform:capitalize;">
                ${weekday}, ${dateFull.split(",")[1]?.trim() ?? dateFull}
              </p>
            </td>
          </tr>

          <!-- HEADLINE NUMBER -->
          <tr>
            <td style="padding:32px 32px 8px 32px;text-align:center;">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">
                Interações totais hoje
              </p>
              <p style="margin:0 0 8px 0;font-size:64px;font-weight:800;color:#0f172a;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-0.04em;">
                ${totalInteractions}
              </p>
              <div>${deltaBadge(totalInteractions, totalPrev)}</div>
              <p style="margin:10px 0 0 0;font-size:12px;color:#94a3b8;">
                ${ctx.messagesIn} recebidas · ${ctx.messagesOut} enviadas
              </p>
            </td>
          </tr>

          <!-- INSIGHT -->
          ${insight ? `
          <tr>
            <td style="padding:18px 32px 0 32px;">
              <div style="background:#f0f4ff;border-left:4px solid #004add;border-radius:8px;padding:14px 18px;">
                <p style="margin:0;font-size:13px;line-height:1.55;color:#1e293b;">
                  ${insight}
                </p>
              </div>
            </td>
          </tr>
          ` : ""}

          <!-- DIVIDER -->
          <tr><td style="padding:24px 32px 8px 32px;">
            <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">
              Métricas do dia
            </p>
          </td></tr>

          <!-- KPI GRID — linha 1 -->
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${kpiCard("Conversas", ctx.newConversations, ctx.previous.newConversations, "💬", true)}
                  <td style="width:10px;"></td>
                  ${kpiCard("Novos contatos", ctx.newContacts, ctx.previous.newContacts, "👤")}
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:10px;"></td></tr>

          <!-- KPI GRID — linha 2 -->
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${kpiCard("Mensagens recebidas", ctx.messagesIn, ctx.previous.messagesIn, "📥")}
                  <td style="width:10px;"></td>
                  ${kpiCard("Mensagens enviadas", ctx.messagesOut, ctx.previous.messagesOut, "📤")}
                </tr>
              </table>
            </td>
          </tr>

          <!-- ADS HIGHLIGHT (só renderiza se houver leads) -->
          ${ctx.fromAdLeads > 0 ? `
          <tr><td style="padding:18px 32px 0 32px;">
            <div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border:1px solid #fcd34d;border-radius:14px;padding:18px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <p style="margin:0 0 2px 0;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;">
                      📣 Leads de anúncio Meta
                    </p>
                    <p style="margin:0;font-size:12px;color:#78350f;line-height:1.4;">
                      Conversas iniciadas via Click-to-WhatsApp
                    </p>
                  </td>
                  <td style="vertical-align:middle;text-align:right;width:80px;">
                    <p style="margin:0;font-size:36px;font-weight:800;color:#b45309;line-height:1;font-variant-numeric:tabular-nums;">
                      ${ctx.fromAdLeads}
                    </p>
                    <p style="margin:4px 0 0 0;text-align:right;">${deltaBadge(ctx.fromAdLeads, ctx.previous.fromAdLeads)}</p>
                  </td>
                </tr>
              </table>
            </div>
          </td></tr>
          ` : ""}

          <!-- CTA -->
          <tr>
            <td style="padding:32px 32px 28px 32px;text-align:center;">
              <a href="${ctx.appUrl}/inbox" style="display:inline-block;background:#004add;color:#ffffff;font-size:14px;font-weight:600;padding:14px 28px;border-radius:12px;text-decoration:none;box-shadow:0 1px 3px rgba(0,74,221,0.3);">
                Abrir inbox →
              </a>
              <p style="margin:14px 0 0 0;font-size:12px;color:#94a3b8;">
                Veja conversas em aberto, atribua atendentes ou responda direto na plataforma.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
              <img src="${logoUrl}" alt="Kora" height="16" style="display:inline-block;height:16px;width:auto;opacity:0.5;border:0;" />
              <p style="margin:8px 0 4px 0;font-size:11px;color:#94a3b8;line-height:1.5;">
                Você recebe este resumo porque é responsável pelo <strong style="color:#475569;">${escapeHtml(ctx.tenantName)}</strong>.
              </p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                <a href="${ctx.appUrl}/configuracoes/relatorios" style="color:#64748b;text-decoration:underline;">Gerenciar destinatários ou desativar</a>
              </p>
            </td>
          </tr>

        </table>

        <p style="max-width:620px;margin:14px auto 0 auto;font-size:10px;color:#cbd5e1;text-align:center;">
          Kora · WhatsApp Business para times de atendimento
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

// ── Novidades (marketing) ─────────────────────────────────────────

export interface NovidadesEmailContext {
  firstName:      string
  unsubscribeUrl: string
  waLink:         string  // CTA principal "Falar no WhatsApp"
  waLinkAI:       string  // CTA upgrade "Ativar a Kora IA"
}

/**
 * Email de novidades (marketing). Design alinhado ao site oficial:
 * Inter, azul Kora #004add, navy #001548 nos blocos dramáticos, CTA azul pill.
 * Fonte canônica do HTML: docs/email-novidades-kora.html.
 */
export function buildNovidadesEmail(ctx: NovidadesEmailContext): { subject: string; html: string; text: string } {
  const subject = "Tudo que o Kora ganhou pra você vender mais no WhatsApp 🚀"
  const base = getAppBaseUrl()
  const logoWhiteUrl = "https://kora.bluedigitalhub.com.br/logo_kora_branco.png"
  const logoUrl      = "https://kora.bluedigitalhub.com.br/logo_kora.png"
  void base

  const text = `Oi, ${ctx.firstName}!

Desde que você começou no Kora, a gente não parou de construir. Veja tudo que evoluiu:

• Um atendimento que flui — inbox multi-atendente, setas de direção e menu de botão direito.
• Vender de forma organizada — funil Kanban com cores personalizáveis.
• No piloto automático — boas-vindas, horário comercial e gatilhos por palavra-chave.
• Além do WhatsApp — chat no site (com Kora IA nos planos Pro e Enterprise).
• Decisões com dados — relatórios de SLA, funil, origem e anúncios.

KORA IA (exclusivo Pro e Enterprise): o atendente que qualifica seus leads, salva os dados no cadastro, responde no WhatsApp e no site, e encaminha pro setor certo.

Ativar a Kora IA: ${ctx.waLinkAI}
Falar no WhatsApp: ${ctx.waLink}

— Equipe Kora`

  const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(subject)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table,td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }
    body { margin:0; padding:0; width:100%!important; background:#f1f5f9; }
    a { color:#004add; }
    @media only screen and (max-width:600px){
      .container { width:100%!important; }
      .px { padding-left:24px!important; padding-right:24px!important; }
      .hero-h1 { font-size:28px!important; line-height:34px!important; }
      .stack { display:block!important; width:100%!important; }
      .feat-ico { margin-bottom:10px!important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f1f5f9;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; font-size:1px; line-height:1px; color:#f1f5f9;">
    Inbox, funil, automação e a Kora IA qualificando seus leads no WhatsApp e no site.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 10px 34px rgba(0,37,122,.10); font-family:'Inter',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td bgcolor="#001548" style="background:#001548; background:linear-gradient(160deg,#003db8 0%,#001548 60%,#001033 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td class="px" style="padding:36px 44px 6px 44px;"><img src="${logoWhiteUrl}" width="104" alt="Kora" style="width:104px; height:auto;"></td></tr>
                <tr><td class="px" style="padding:22px 44px 44px 44px;">
                  <p style="margin:0 0 14px 0; font-size:12px; font-weight:600; letter-spacing:2.5px; text-transform:uppercase; color:#92acff;">Novidades</p>
                  <h1 class="hero-h1" style="margin:0 0 14px 0; font-size:34px; line-height:40px; font-weight:800; letter-spacing:-0.8px; color:#ffffff;">Seu WhatsApp,<br>uma operação inteira.</h1>
                  <p style="margin:0; font-size:16px; line-height:24px; color:#cdd6ee;">Desde que você começou no Kora, a gente não parou de construir. Veja tudo que evoluiu pra você <strong style="color:#ffffff;">vender mais e atender melhor</strong>.</p>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr><td class="px" style="padding:36px 44px 4px 44px;"><p style="margin:0; font-size:16px; line-height:24px; color:#334155;">Oi, <strong style="color:#0f172a;">${escapeHtml(ctx.firstName)}</strong> 👋</p></td></tr>

          ${feature("💬", "Um atendimento que flui", "Inbox multi-atendente com mídia, áudios e grupos. Agora com lista mais limpa, <strong style=\"color:#334155;\">setas que mostram quem falou por último</strong> (você, o cliente ou pelo celular) e menu de botão direito pra fixar, marcar pendente e atribuir.", "20px")}
          ${divider()}
          ${feature("📊", "Vender de forma organizada", "Funil de vendas em Kanban: arraste conversas entre etapas, marque ganho ou perdido e personalize as cores das colunas do seu jeito.")}
          ${divider()}
          ${feature("⚙️", "No piloto automático", "Boas-vindas, aviso de horário comercial e gatilhos por palavra-chave respondendo sozinhos — com variáveis personalizadas como {primeiro_nome} e {empresa}.")}
          ${divider()}
          ${feature("🌐", "Além do WhatsApp", "Atenda também pelo <strong style=\"color:#334155;\">chat no seu site</strong>, sem perder o histórico. E nos planos <strong style=\"color:#004add;\">Pro e Enterprise</strong>, a <strong style=\"color:#004add;\">Kora IA</strong> responde no site automaticamente.")}
          ${divider()}
          ${feature("📈", "Decisões com dados", "Relatórios de atendimento, SLA de resposta, funil de vendas, origem dos contatos e desempenho dos seus anúncios Click-to-WhatsApp.", "24px", "4px")}

          <tr>
            <td class="px" style="padding:32px 44px 8px 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:18px; overflow:hidden;">
                <tr>
                  <td bgcolor="#001548" style="background:#001548; background:linear-gradient(160deg,#00257a 0%,#001548 55%,#001033 100%); padding:34px 30px;">
                    <span style="display:inline-block; background:rgba(94,133,255,.16); color:#b7c8ff; font-size:11px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; padding:6px 13px; border-radius:999px;">✦ Exclusivo Pro &amp; Enterprise</span>
                    <h2 style="margin:16px 0 10px 0; font-size:24px; line-height:30px; font-weight:800; color:#ffffff; letter-spacing:-0.4px;">Kora IA: o atendente que<br>qualifica seus leads</h2>
                    <p style="margin:0 0 20px 0; font-size:15px; line-height:23px; color:#cdd6ee;">Mais que um chatbot — uma IA dedicada, treinada com a <strong style="color:#ffffff;">persona e o conhecimento da sua empresa</strong>, trabalhando 24/7 por você:</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr><td style="padding:6px 0; font-size:14px; line-height:20px; color:#e7ecfb;">🎯&nbsp;&nbsp;<strong style="color:#ffffff;">Qualifica o lead</strong> e salva nome, telefone e e-mail no cadastro</td></tr>
                      <tr><td style="padding:6px 0; font-size:14px; line-height:20px; color:#e7ecfb;">💬&nbsp;&nbsp;Responde no <strong style="color:#ffffff;">WhatsApp e no site</strong>, com tom humano</td></tr>
                      <tr><td style="padding:6px 0; font-size:14px; line-height:20px; color:#e7ecfb;">🔀&nbsp;&nbsp;<strong style="color:#ffffff;">Encaminha pro setor certo</strong> quando precisa de um humano</td></tr>
                      <tr><td style="padding:6px 0; font-size:14px; line-height:20px; color:#e7ecfb;">📣&nbsp;&nbsp;Sabe de <strong style="color:#ffffff;">qual anúncio</strong> o cliente veio e abre no contexto</td></tr>
                    </table>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;">
                      <tr><td align="center" bgcolor="#004add" style="border-radius:999px; background:#004add;"><a href="${ctx.waLinkAI}" target="_blank" style="display:inline-block; padding:15px 30px; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:999px;">Ativar a Kora IA&nbsp;&nbsp;→</a></td></tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:30px 44px 10px 44px;" align="center">
              <p style="margin:0 0 18px 0; font-size:15px; line-height:22px; color:#475569;">Ficou com alguma dúvida? A gente te ajuda em minutos.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" align="center">
                <tr><td align="center" bgcolor="#004add" style="border-radius:999px; background:#004add;"><a href="${ctx.waLink}" target="_blank" style="display:inline-block; padding:15px 32px; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:999px;">Falar no WhatsApp</a></td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 44px 36px 44px; border-top:1px solid #eef2f7;">
              <img src="${logoUrl}" width="84" alt="Kora" style="width:84px; height:auto; margin-bottom:12px;">
              <p style="margin:0 0 14px 0; font-size:12px; line-height:18px; color:#94a3b8;">WhatsApp + IA com toque humano. Atendimento e vendas no piloto inteligente.</p>
              <p style="margin:0; font-size:11px; line-height:17px; color:#b6c0cf;">Você recebe este email porque tem uma conta no Kora.<br><a href="${ctx.unsubscribeUrl}" style="color:#94a3b8; text-decoration:underline;">Cancelar inscrição</a> &nbsp;·&nbsp; BlueDigitalHub · contato@bluedigitalhub.com.br</p>
            </td>
          </tr>
        </table>
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px;">
          <tr><td align="center" style="padding:18px 12px; font-size:11px; color:#aab4c4; font-family:'Inter',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">© Kora · feito pra quem vende no WhatsApp</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}

/** Linha de feature (ícone + título + texto) do email de novidades. */
function feature(icon: string, title: string, body: string, padTop = "24px", padBottom = "0"): string {
  return `<tr>
    <td class="px" style="padding:${padTop} 44px ${padBottom} 44px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td class="feat-ico stack" width="52" valign="top" style="width:52px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:44px; height:44px; background:#eef2ff; border-radius:12px; text-align:center; vertical-align:middle; font-size:20px;">${icon}</td></tr></table>
          </td>
          <td class="stack" valign="top" style="padding-left:16px;">
            <p style="margin:0 0 4px 0; font-size:16px; font-weight:700; color:#0f172a;">${title}</p>
            <p style="margin:0; font-size:14px; line-height:21px; color:#64748b;">${body}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`
}

function divider(): string {
  return `<tr><td class="px" style="padding:24px 44px 0 44px;"><div style="border-top:1px solid #eef2f7; line-height:1px; font-size:1px;">&nbsp;</div></td></tr>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
