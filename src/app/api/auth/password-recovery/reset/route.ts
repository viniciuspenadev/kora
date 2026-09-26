import { after, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { completeRecovery, notifyPasswordChanged } from "@/lib/auth/password-recovery";
import { readRecoveryJson, recoveryOriginAllowed } from "@/lib/auth/recovery-request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
    try {
        if (!recoveryOriginAllowed(req))
            return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
        const ip = getClientIp(req);
        if (!rateLimit("recovery-reset:" + ip, 30, 900000).ok)
            return NextResponse.json({ error: "Aguarde alguns minutos antes de tentar novamente." }, { status: 429 });
        const input = await readRecoveryJson(req);
        if (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.token) || typeof input.password !== "string" || typeof input.confirmation !== "string" || input.password.length > 72 || input.password !== input.confirmation)
            return NextResponse.json({ error: "Confira o link e a confirmação da nova senha." }, { status: 400 });
        const result = await completeRecovery(input.token, input.password, ip);
        if ("error" in result)
            return NextResponse.json(result, { status: 400 });
        after(async () => { try {
            await notifyPasswordChanged(result.email);
        }
        catch {
            console.error("[password-recovery] notice unavailable");
        } });
        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    catch {
        return NextResponse.json({ error: "Não foi possível redefinir agora. Tente novamente em instantes." }, { status: 503 });
    }
}
