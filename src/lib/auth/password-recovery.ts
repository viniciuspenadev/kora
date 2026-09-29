import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getAppBaseUrl, sendEmail } from "@/lib/email/send";
import { buildPasswordRecoveryEmail, buildPasswordChangedEmail } from "@/lib/email/password-recovery";
import { validatePassword } from "@/lib/password";
export const RECOVERY_NOTICE = "Se este e-mail tiver uma conta no Kora, você receberá um link para redefinir a senha. Confira também o spam.";
export const RESET_INVALID = "Este link expirou, já foi usado ou não é válido. Solicite um novo link.";
export const hashResetToken = (value: string) => createHash("sha256").update(value).digest("hex");
export function resetBaseUrl() {
    const url = new URL(getAppBaseUrl());
    if (url.username || url.password || (process.env.NODE_ENV === "production" && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol))
        throw new Error("Reset origin unavailable");
    return url.origin;
}
export async function takeRecoveryLimit(kind: string, value: string, max: number, seconds: number) {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret)
        throw new Error("Reset limit unavailable");
    const key = createHmac("sha256", secret).update(kind + ":" + value).digest("hex");
    const { data, error } = await supabaseAdmin.rpc("take_password_reset_limit", { p_key: key, p_max: max, p_seconds: seconds });
    if (error)
        throw new Error("Reset limit unavailable");
    return data === true;
}
/** Runs after the generic response: account lookup and mail latency cannot enumerate users. */
export async function issueRecovery(email: string, ip: string) {
    if (!await takeRecoveryLimit("request-ip", ip, 10, 3600) || !await takeRecoveryLimit("request-email", email, 3, 3600))
        return;
    const { data: profile, error } = await supabaseAdmin.from("profiles").select("id,email,password_hash").eq("email", email).maybeSingle();
    if (error)
        throw new Error("Reset lookup unavailable");
    if (!profile?.password_hash)
        return;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashResetToken(token);
    const { data: issued, error: issueError } = await supabaseAdmin.rpc("issue_password_reset", {
        p_user: profile.id, p_email: profile.email, p_previous_hash: profile.password_hash, p_token_hash: tokenHash, p_fingerprint: hashResetToken(profile.password_hash),
    });
    if (issueError)
        throw new Error("Reset issue unavailable");
    if (!issued)
        return;
    // Fragment never travels in the GET URL, server access logs or referrers.
    const resetUrl = resetBaseUrl() + "/auth/reset-password#token=" + token;
    const sent = await sendEmail({ to: profile.email, templateSlug: "password_recovery", ...buildPasswordRecoveryEmail({ resetUrl }) });
    // No token, URL or credential is written to outbox metadata or logs.
    if (!sent.ok)
        console.error("[password-recovery] email unavailable");
}
export function recoveryPasswordProblem(password: string) {
    if (Array.from(password).length < 15)
        return "Use pelo menos 15 caracteres, com uma letra e um número.";
    return validatePassword(password);
}
export async function completeRecovery(token: string, password: string, ip: string) {
    if (!await takeRecoveryLimit("reset-ip", ip, 30, 900) || !await takeRecoveryLimit("reset-token", token, 5, 900))
        return { error: "Aguarde alguns minutos antes de tentar novamente." };
    const tokenHash = hashResetToken(token);
    const { data: reset, error } = await supabaseAdmin.from("password_reset_tokens").select("user_id,email,credential_fingerprint,expires_at,consumed_at").eq("token_hash", tokenHash).maybeSingle();
    if (error)
        throw new Error("Reset read unavailable");
    if (!reset || reset.consumed_at || Date.parse(reset.expires_at) <= Date.now())
        return { error: RESET_INVALID };
    const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("id,email,password_hash").eq("id", reset.user_id).maybeSingle();
    if (profileError)
        throw new Error("Reset profile unavailable");
    if (!profile || profile.email !== reset.email || hashResetToken(profile.password_hash) !== reset.credential_fingerprint)
        return { error: RESET_INVALID };
    const problem = recoveryPasswordProblem(password);
    if (problem)
        return { error: problem };
    if (await bcrypt.compare(password, profile.password_hash))
        return { error: "Escolha uma senha diferente da atual." };
    const nextHash = await bcrypt.hash(password, 12);
    const { data: userId, error: consumeError } = await supabaseAdmin.rpc("consume_password_reset", {
        p_token_hash: tokenHash, p_previous_hash: profile.password_hash, p_fingerprint: reset.credential_fingerprint, p_new_hash: nextHash,
    });
    if (consumeError)
        throw new Error("Reset consume unavailable");
    if (userId !== profile.id)
        return { error: RESET_INVALID };
    return { ok: true as const, email: profile.email };
}
export async function notifyPasswordChanged(email: string) {
    const result = await sendEmail({ to: email, templateSlug: "password_changed", ...buildPasswordChangedEmail() });
    if (!result.ok)
        console.error("[password-recovery] change notice unavailable");
}
