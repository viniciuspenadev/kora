import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id:              string
      tenantId:        string
      role:            "owner" | "admin" | "agent" | ""
      supabaseToken:   string
      isPlatformAdmin: boolean
      sid?:            string  // id da sessão atual (gerenciador) — marca "este dispositivo"
    } & DefaultSession["user"]
  }

  /**
   * O que o NOSSO `authorize` devolve — não o `User` genérico do NextAuth.
   *
   * ⚠️ Estes campos eram opcionais e nulos aqui, e o `auth.ts` compensava com `as any` em
   *    cada linha. Só que `authorize` sempre preenche todos (ver `TicketActor` em
   *    src/lib/auth/login-core.ts): a frouxidão era do TIPO, não do dado — e cada `any`
   *    apagava a checagem justamente no arquivo mais sensível do app. Apertado aqui, os
   *    `any` de lá caem sozinhos.
   */
  interface User {
    id:              string
    tenantId:        string
    role:            string
    isPlatformAdmin: boolean
    sid?:            string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId:           string
    tenantId:         string
    role:             string
    supabaseToken:    string
    isPlatformAdmin:  boolean
    supabaseTokenExp?: number
    checkedAt?:        number  // epoch s da última revalidação de acesso no banco
    sid?:             string  // id da sessão no gerenciador (user_sessions)
  }
}
