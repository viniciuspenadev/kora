import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { supabaseAdmin } from "@/lib/supabase"
import { generateSupabaseToken } from "@/lib/supabase-token"
import { getClientIp } from "@/lib/rate-limit"
import { readDeviceKey } from "@/lib/auth/device"
import { redeemLoginTicket } from "@/lib/auth/login-core"
import { isTenantBlockedForAccessAs } from "@/lib/lifecycle-shared"
import { randomUUID } from "crypto"

/** Os papéis que a sessão promete. "" = sem papel (não passa em gate nenhum). */
const APP_ROLES = ["owner", "admin", "agent"] as const
type AppRole = (typeof APP_ROLES)[number] | ""
/** Aceita `unknown` de propósito: o `token` do callback de sessão vem sem tipo, e um
 *  `as string` aqui seria justamente a checagem que se quer ter. Confere e devolve. */
const toAppRole = (r: unknown): AppRole =>
  typeof r === "string" && (APP_ROLES as readonly string[]).includes(r) ? (r as AppRole) : ""

const IS_PROD = process.env.NODE_ENV === "production"

// Revogação de privilégio: a sessão JWT dura 30d, mas role/active (e o token RLS
// derivado) não podem ficar 30d defasados. Revalidamos no banco no máximo 1×/REVALIDATE_S
// por usuário — num único ponto (callback jwt), não por página. Lag de revogação ≈ 5min.
const REVALIDATE_S = 300

type AccessState =
  | { status: "ok"; role: string; isPlatformAdmin: boolean }
  | { status: "revoked" }
  | { status: "error" }

/**
 * Re-checa, no banco, se o usuário ainda tem acesso e qual a role ATUAL.
 * - "revoked": não é mais platform admin E não tem membership ativa → mata a sessão.
 * - "error":  falha transitória (DB indisponível) → fail-open (mantém o token, re-tenta depois).
 * Platform admin nunca é deslogado por perder membership de tenant (opera via /admin).
 */
// Estados de lifecycle que negam acesso — definição única em login-core.ts
// (usada aqui pelo revalidateAccess a cada 5min).

async function revalidateAccess(
  userId: string,
  tenantId: string,
  wasPlatformAdmin: boolean,
): Promise<AccessState> {
  try {
    const [mem, pa, ten] = await Promise.all([
      tenantId
        ? supabaseAdmin
            .from("tenant_users")
            .select("role, active")
            .eq("user_id", userId)
            .eq("tenant_id", tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null as { role: string; active: boolean } | null, error: null }),
      wasPlatformAdmin
        ? supabaseAdmin.from("platform_admins").select("id").eq("user_id", userId).maybeSingle()
        : Promise.resolve({ data: null as { id: string } | null, error: null }),
      tenantId
        ? supabaseAdmin.from("tenants").select("active, lifecycle_state").eq("id", tenantId).maybeSingle()
        : Promise.resolve({ data: null as { active: boolean; lifecycle_state: string | null } | null, error: null }),
    ])

    if (mem.error || pa.error) return { status: "error" }

    const isPlatformAdmin = wasPlatformAdmin && !!pa.data
    const membership = mem.data as { role: string; active: boolean } | null
    const membershipActive = !!membership && membership.active === true

    // Gate de tenant: tenant inativo/pendente/suspenso = sem acesso (trial não-ativado,
    // suspensão por fim do trial, etc). Fail-OPEN em erro de query (não trava login).
    const tenant = ten.data as { active: boolean; lifecycle_state: string | null } | null
    // 🚪 Pergunta de ACESSO — deliberadamente sem assinatura: cliente em atraso continua
    //    entrando (degrau 3). Quem corta o gasto dele é o guarda dos webhooks/crons.
    // ⚠️ Ciente do PAPEL: com `trial_ended` o owner/admin continua dentro (pra pagar) e o
    //    atendente cai no próximo re-check. `membership.role` já está carregado aqui.
    const tenantBlocked = !ten.error && !!tenant &&
      (tenant.active === false ||
        isTenantBlockedForAccessAs(tenant.lifecycle_state, membership?.role))

    if (!isPlatformAdmin && (!membershipActive || tenantBlocked)) return { status: "revoked" }
    return { status: "ok", role: membershipActive ? membership!.role : "", isPlatformAdmin }
  } catch {
    return { status: "error" }
  }
}

/**
 * Gerenciador de sessões: grava esta sessão/device em `user_sessions` no login e
 * devolve o `sid` que vai no JWT. **Fire-and-forget seguro** — se a gravação falhar,
 * devolve null → o token fica SEM sid → o enforcement é pulado (a sessão funciona,
 * só não entra no gerenciador). Nunca bloqueia o login.
 */
async function recordSession(
  userId: string,
  tenantId: string | null,
  ip: string | null,
  ua: string | null,
  deviceId: string | null,
): Promise<string | null> {
  try {
    const sid = randomUUID()
    const { error } = await supabaseAdmin.from("user_sessions").insert({
      user_id:    userId,
      tenant_id:  tenantId || null,
      sid,
      last_ip:    ip && ip !== "unknown" ? ip.slice(0, 64) : null,
      user_agent: ua ? ua.slice(0, 400) : null,
      // F1 do device trust: NULL = navegador sem cookie ainda (ou falha na
      // resolução). Não bloqueia nada aqui — o gate entra na F3.
      device_id:  deviceId,
    })
    return error ? null : sid
  } catch {
    return null
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 }, // 30 dias

  // Cookies hardened explícitos (não confiar em defaults futuros do NextAuth)
  cookies: {
    sessionToken: {
      name: IS_PROD ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path:     "/",
        secure:   IS_PROD,
      },
    },
    callbackUrl: {
      name: IS_PROD ? "__Secure-authjs.callback-url" : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path:     "/",
        secure:   IS_PROD,
      },
    },
    csrfToken: {
      name: IS_PROD ? "__Host-authjs.csrf-token" : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path:     "/",
        secure:   IS_PROD,
      },
    },
  },

  pages: {
    signIn: "/auth/signin",
  },

  providers: [
    // ── Provider ÚNICO: troca ticket por sessão (device trust F2) ──
    // Doc: docs/auth-device-trust-design.md §4/§4.1. O provider de SENHA foi
    // DELETADO (invariante I1) — senha valida na action beginLogin, que emite o
    // ticket. Recolocar um provider de email+senha aqui = reabrir o bypass do
    // gate de dispositivo.
    Credentials({
      id: "ticket",
      credentials: {
        ticket: { label: "Ticket", type: "text" },
      },
      async authorize(credentials, request) {
        const raw = typeof credentials?.ticket === "string" ? credentials.ticket : ""

        // Consumo atômico + vínculo ao cookie de dispositivo desta request +
        // re-check de membership. Qualquer falha → null (fail-closed).
        const actor = await redeemLoginTicket(raw, readDeviceKey(request))
        if (!actor) return null

        // Registra a sessão/device no gerenciador (presença + auditoria + revogável).
        const sid = await recordSession(
          actor.userId,
          actor.tenantId || null,
          getClientIp(request),
          request.headers.get("user-agent"),
          actor.deviceId,
        )

        return {
          id:              actor.userId,
          email:           actor.email,
          name:            actor.name,
          tenantId:        actor.tenantId,
          role:            actor.role,
          isPlatformAdmin: actor.isPlatformAdmin,
          sid,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId          = user.id!
        token.tenantId        = user.tenantId
        token.role            = user.role
        token.isPlatformAdmin = user.isPlatformAdmin
        token.supabaseTokenExp = 0
        token.checkedAt        = Math.floor(Date.now() / 1000) // acabou de validar no authorize
        token.sid              = user.sid ?? undefined // sessão no gerenciador (pode ser null se a gravação falhou)
      }

      const now = Math.floor(Date.now() / 1000)

      // ── Revogação de privilégio (revalida acesso a cada REVALIDATE_S) ──
      if (now - ((token.checkedAt as number | undefined) ?? 0) >= REVALIDATE_S) {
        const acc = await revalidateAccess(
          token.userId as string,
          token.tenantId as string,
          token.isPlatformAdmin as boolean,
        )
        if (acc.status === "revoked") return null            // expulso/inativo → apaga a sessão
        if (acc.status === "ok") {
          if (acc.role !== token.role) {
            token.role = acc.role
            token.supabaseTokenExp = 0                         // role mudou → regenera token RLS
          }
          token.isPlatformAdmin = acc.isPlatformAdmin

          // ── Gerenciador de sessões: confirma que esta sessão não foi revogada + presença ──
          // Token comum: fail-OPEN (blip de DB não desloga; revogação recupera na próxima
          // checagem). GOD-MODE (platform_admin): fail-CLOSED (H-15, decisão do owner 2026-08-01)
          // — jóia da coroa; se não dá pra CONFIRMAR que a sessão é válida, derruba.
          const isGod = acc.isPlatformAdmin === true
          // God-mode EXIGE sessão rastreável (sid): sem ela não há como revogar → fail-closed.
          if (isGod && !token.sid) return null
          if (token.sid) {
            try {
              const sid = token.sid as string
              const { data, error } = await supabaseAdmin
                .from("user_sessions").select("id").eq("sid", sid).maybeSingle()
              if (!error && !data) return null   // linha sumiu → sessão revogada → apaga o cookie
              if (!error && data) {
                await supabaseAdmin
                  .from("user_sessions")
                  .update({ last_seen_at: new Date(now * 1000).toISOString() })
                  .eq("sid", sid)
              }
              // H-15: erro na consulta → comum mantém (fail-open); god-mode DERRUBA.
              if (error && isGod) return null
            } catch {
              // H-15: comum = fail-open (mantém); god-mode = fail-closed (não confirmou → derruba).
              if (isGod) return null
            }
          }

          token.checkedAt = now
        }
        // status "error": comum mantém o token e NÃO atualiza checkedAt (re-tenta). GOD-MODE =
        // fail-CLOSED (H-15): não confirmou o acesso de maior privilégio → derruba a sessão.
        if (acc.status === "error" && token.isPlatformAdmin === true) return null
      }

      // ⏱️ OS TRÊS RELÓGIOS TÊM QUE FECHAR ENTRE SI — a conta está aqui:
      //   vida do token = 600s (supabase-token.ts) · regenera faltando <300s (aqui) ·
      //   renovação do socket a cada 240s (REFRESH_MS em lib/realtime.ts).
      // Logo, o token SERVIDO sempre tem entre 300s e 600s de vida, e o socket o renova aos
      // 240s — antes de qualquer cenário de expiração. Invariante: REFRESH_MS < limiar.
      // 🔴 A tentação é baixar o limiar pra "economizar" regeneração (ela é barata: assinar
      //    um JWT). Com limiar de 120s, uma página recém-renderizada podia receber um token
      //    com 2min de vida e só renovar aos 4 — tempo real morto no meio, em silêncio.
      if (!token.supabaseToken || (token.supabaseTokenExp as number) - now < 300) {
        token.supabaseToken = await generateSupabaseToken({
          userId: token.userId as string,
          tenantId: token.tenantId as string,
          role: token.role as string,
        })
        token.supabaseTokenExp = now + 600
      }

      return token
    },

    async session({ session, token }) {
      session.user.id              = token.userId as string
      session.user.tenantId        = token.tenantId as string
      // Estreitamento no ÚNICO ponto de passagem: o banco devolve `string`, a sessão promete
      // um dos três papéis. Com `as any` a promessa era falsa — qualquer valor inesperado
      // entrava vestido de papel válido. Aqui, o que não for conhecido vira "" (sem papel),
      // que é o lado seguro: "" não passa em nenhum gate.
      session.user.role            = toAppRole(token.role)
      session.user.supabaseToken   = token.supabaseToken as string
      session.user.isPlatformAdmin = token.isPlatformAdmin as boolean
      session.user.sid             = token.sid as string | undefined
      return session
    },
  },
})
