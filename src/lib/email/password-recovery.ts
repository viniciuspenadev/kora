import { escapeHtml } from "./send";
export function buildPasswordRecoveryEmail(ctx: {
    resetUrl: string;
}) {
    return { subject: "Redefina sua senha do Kora", text: "Recebemos um pedido para redefinir sua senha. Abra o link abaixo, válido por 30 minutos e para um único uso:\n\n" + ctx.resetUrl + "\n\nSe você não pediu, ignore este e-mail. Sua senha continua a mesma.",
        html: '<div style="background:#f8fafc;padding:32px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:16px;padding:32px"><h1 style="font-size:22px;color:#0f172a">Redefina sua senha</h1><p style="color:#475569;line-height:1.6">Recebemos um pedido de recuperação da sua conta no Kora. Este link vale por <strong>30 minutos</strong> e pode ser usado uma única vez.</p><a href="' + escapeHtml(ctx.resetUrl) + '" style="display:inline-block;background:#004add;color:white;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Criar nova senha</a><p style="font-size:13px;color:#64748b;line-height:1.6">Se você não pediu esta alteração, ignore este e-mail. Sua senha continua a mesma. Nunca compartilhe este link.</p></div></div>' };
}
export function buildPasswordChangedEmail() {
    return { subject: "Sua senha do Kora foi alterada", text: "Sua senha foi redefinida e seus acessos anteriores foram encerrados. Se você não fez esta alteração, entre em contato com o suporte do Kora imediatamente.",
        html: '<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px"><h1 style="font-size:22px;color:#0f172a">Senha alterada</h1><p style="color:#475569;line-height:1.6">Sua senha foi redefinida e seus acessos anteriores foram encerrados.</p><p style="color:#475569;line-height:1.6">Se você não fez esta alteração, entre em contato com o suporte do Kora imediatamente.</p></div>' };
}
