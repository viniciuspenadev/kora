import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import { generateSupabaseToken } from "@/lib/supabase-token"
import { rateLimit, getClientIp } from "@/lib/rate-limit"
import { randomUUID } from "crypto"

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
async function revalidateAccess(
  userId: string,
  tenantId: string,
  wasPlatformAdmin: boolean,
): Promise<AccessState> {
  try {
    const [mem, pa] = await Promise.all([
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
    ])

    if (mem.error || pa.error) return { status: "error" }

    const isPlatformAdmin = wasPlatformAdmin && !!pa.data
    const membership = mem.data as { role: string; active: boolean } | null
    const membershipActive = !!membership && membership.active === true

    if (!isPlatformAdmin && !membershipActive) return { status: "revoked" }
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
): Promise<string | null> {
  try {
    const sid = randomUUID()
    const { error } = await supabaseAdmin.from("user_sessions").insert({
      user_id:    userId,
      tenant_id:  tenantId || null,
      sid,
      last_ip:    ip && ip !== "unknown" ? ip.slice(0, 64) : null,
      user_agent: ua ? ua.slice(0, 400) : null,
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
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        // Rate-limit por email — 5 tentativas / 15 min.
        // Mitiga credential-stuffing e brute force. NextAuth não dá IP no callback;
        // chave por email cobre o cenário mais perigoso (alvo conhecido).
        const emailKey = String(credentials.email).toLowerCase().trim().slice(0, 254)
        const rl = rateLimit(`auth:login:${emailKey}`, 5, 15 * 60_000)
        if (!rl.ok) {
          // Retorna null (mesma resposta de senha errada) — não vaza info de bloqueio
          return null
        }

        // Rate-limit secundário por IP — barra credential-stuffing distribuído
        // (muitos emails diferentes de um mesmo IP). Pula se IP desconhecido (sem
        // proxy) pra não jogar todos os usuários no mesmo balde.
        const ip = getClientIp(request)
        if (ip !== "unknown" && !rateLimit(`auth:login:ip:${ip}`, 20, 15 * 60_000).ok) {
          return null
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, email, full_name, password_hash")
          .eq("email", credentials.email)
          .single()

        if (!profile?.password_hash) return null

        const valid = await bcrypt.compare(
          credentials.password as string,
          profile.password_hash
        )
        if (!valid) return null

        const [{ data: memberships }, { data: platformAdmin }] = await Promise.all([
          supabaseAdmin
            .from("tenant_users")
            .select("tenant_id, role")
            .eq("user_id", profile.id)
            .eq("active", true),
          supabaseAdmin
            .from("platform_admins")
            .select("id")
            .eq("user_id", profile.id)
            .single(),
        ])

        const isPlatformAdmin = !!platformAdmin

        if ((!memberships || memberships.length === 0) && !isPlatformAdmin) return null

        const tenantId = memberships?.[0]?.tenant_id ?? ""

        // Registra a sessão/device no gerenciador (presença + auditoria + revogável).
        const sid = await recordSession(
          profile.id,
          tenantId,
          getClientIp(request),
          request.headers.get("user-agent"),
        )

        return {
          id:              profile.id,
          email:           profile.email,
          name:            profile.full_name,
          tenantId,
          role:            memberships?.[0]?.role ?? "",
          isPlatformAdmin,
          sid,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId          = user.id!
        token.tenantId        = (user as any).tenantId
        token.role            = (user as any).role
        token.isPlatformAdmin = (user as any).isPlatformAdmin ?? false
        token.supabaseTokenExp = 0
        token.checkedAt        = Math.floor(Date.now() / 1000) // acabou de validar no authorize
        token.sid              = (user as any).sid ?? undefined // sessão no gerenciador (pode ser null se a gravação falhou)
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
          // Só pra tokens que têm sid (logaram já com a feature). Token legado (sem sid) é
          // pulado → não expulsa; entra no gerenciador no próximo login. Tudo fail-open.
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
            } catch { /* fail-open: mantém a sessão */ }
          }

          token.checkedAt = now
        }
        // status "error": mantém o token e NÃO atualiza checkedAt (re-tenta no próximo acesso)
      }

      if (!token.supabaseToken || (token.supabaseTokenExp as number) - now < 300) {
        token.supabaseToken = await generateSupabaseToken({
          userId: token.userId as string,
          tenantId: token.tenantId as string,
          role: token.role as string,
        })
        token.supabaseTokenExp = now + 3600
      }

      return token
    },

    async session({ session, token }) {
      session.user.id              = token.userId as string
      session.user.tenantId        = token.tenantId as string
      session.user.role            = token.role as any
      session.user.supabaseToken   = token.supabaseToken as string
      session.user.isPlatformAdmin = token.isPlatformAdmin as boolean
      session.user.sid             = token.sid as string | undefined
      return session
    },
  },
})
