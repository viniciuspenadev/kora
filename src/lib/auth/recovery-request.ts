import "server-only";
import { resetBaseUrl } from "./password-recovery";
/** Public auth mutations require same-origin JSON, no cookies or session authority. */
export function recoveryOriginAllowed(req: Request) {
    const origin = req.headers.get("origin");
    if (!origin || req.headers.get("sec-fetch-site") === "cross-site")
        return false;
    const local = process.env.NODE_ENV !== "production" ? new URL(req.url).origin : null;
    return origin === resetBaseUrl() || origin === local;
}
export async function readRecoveryJson(req: Request): Promise<Record<string, unknown>> {
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
        throw new Error("Invalid input");
    const reader = req.body?.getReader();
    if (!reader)
        throw new Error("Invalid input");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 4096)
                throw new Error("Invalid input");
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel();
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Invalid input");
    return parsed as Record<string, unknown>;
}
