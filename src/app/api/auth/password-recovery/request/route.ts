import { after, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { issueRecovery, RECOVERY_NOTICE } from "@/lib/auth/password-recovery";
import { readRecoveryJson, recoveryOriginAllowed } from "@/lib/auth/recovery-request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
    try {
        if (!recoveryOriginAllowed(req))
            return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
        const ip = getClientIp(req);
        if (!rateLimit("recovery-request:" + ip, 10, 3600000).ok)
            return NextResponse.json({ message: RECOVERY_NOTICE }, { headers: { "Cache-Control": "no-store" } });
        const input = await readRecoveryJson(req);
        if (typeof input.email !== "string" || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
            return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
        const email = input.email.trim().toLowerCase();
        after(async () => {
            try {
                await issueRecovery(email, ip);
            }
            catch {
                console.error("[password-recovery] request unavailable");
            }
        });
        return NextResponse.json({ message: RECOVERY_NOTICE }, { headers: { "Cache-Control": "no-store" } });
    }
    catch {
        return NextResponse.json({ error: "Não foi possível processar. Tente novamente em instantes." }, { status: 503 });
    }
}
