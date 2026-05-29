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

function getAppBaseUrl(): string {
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
  if (ctx.newContacts > 0 && ctx.newConversations === ctx.newContacts) {
    return `👋 <strong>${ctx.newContacts} contato${ctx.newContacts > 1 ? "s" : ""} novo${ctx.newContacts > 1 ? "s" : ""}</strong> chegaram hoje — todos via primeira conversa.`
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

Novas conversas:        ${ctx.newConversations} (ontem: ${ctx.previous.newConversations})
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
    ${totalInteractions} interações hoje · ${ctx.newConversations} novas conversas · ${ctx.newContacts} contatos novos
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
                  ${kpiCard("Novas conversas", ctx.newConversations, ctx.previous.newConversations, "💬", true)}
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
