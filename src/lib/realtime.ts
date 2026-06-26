"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Cliente Realtime browser-side. Singleton — uma conexão WebSocket por aba.
 *
 * Como a auth funciona:
 *   - Server emite `supabaseToken` (JWT HS256 com app_tenant_id) na session do NextAuth.
 *   - Aqui chamamos `realtime.setAuth(token)` toda vez que o token muda.
 *   - O servidor Realtime do Supabase valida o JWT, expõe os claims via
 *     `current_setting('request.jwt.claims')` no Postgres, e a policy
 *     `tenant_isolation` em chat_messages/chat_conversations filtra os eventos.
 *
 * Resultado: o WebSocket só entrega rows do tenant_id do JWT. Garantia de
 * isolamento idêntica à do PostgREST.
 *
 * Token expira em 1h. NextAuth gera token novo nos próximos hits da session
 * (callback jwt em src/auth.ts). Quem chamar este client precisa atualizar
 * o token periodicamente — ver `refreshRealtimeAuth`.
 */

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

let client: SupabaseClient | null = null

export function getRealtimeClient(token: string): SupabaseClient {
  if (!client) {
    client = createClient(URL, ANON, {
      auth:     { persistSession: false, autoRefreshToken: false },
      // eventsPerSecond limita throttling client-side; volume do Kora cabe folgado.
      realtime: { params: { eventsPerSecond: 10 } },
    })
  }
  client.realtime.setAuth(token)
  return client
}

export function refreshRealtimeAuth(token: string) {
  if (client) client.realtime.setAuth(token)
}
