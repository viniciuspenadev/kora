import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id:              string
      tenantId:        string
      role:            "owner" | "admin" | "agent" | ""
      supabaseToken:   string
      isPlatformAdmin: boolean
    } & DefaultSession["user"]
  }

  interface User {
    id:              string
    tenantId?:       string | null
    role?:           string | null
    isPlatformAdmin?: boolean
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
  }
}
