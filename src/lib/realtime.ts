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
 * ⏱️ RENOVAÇÃO — mora AQUI, não no componente (mudado em 2026-08-03).
 *
 * O token vale 10 minutos (era 1h; ver docs/access-revocation-design.md §4: um token que
 * fala DIRETO com o banco não pode viver mais que a janela de revogação que prometemos).
 * Antes, quem renovava era o inbox, com um `setInterval` próprio — e o **sino de
 * notificações**, que está em toda página e usa o mesmo singleton, **não renovava nada**.
 * Com 1h ninguém percebia; com 10 min o sino morreria calado em toda tela que não fosse o
 * inbox. Por isso o relógio desceu pro singleton: quem chama `getRealtimeClient` ganha
 * renovação de graça, independente de qual componente montou primeiro.
 *
 * 🔒 E a renovação é também um GATE: se `/api/auth/supabase-token` responder 401 (sessão
 *    revogada, cliente desativado), este módulo **derruba a conexão na hora** em vez de
 *    esperar o token vencer. É o que transforma revogação-por-relógio em revogação-por-evento
 *    no tempo real.
 */

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

/**
 * Renova a cada 4min. **O número não é folga estética — é invariante:**
 *   vida do token = 600s · o callback jwt regenera faltando <300s · logo o token SERVIDO
 *   sempre tem ≥300s de vida, e 240s < 300s garante renovação antes de qualquer expiração.
 * 🔴 REFRESH_MS **precisa** ser menor que o limiar de regeneração do `auth.ts`. Aumentar
 *    este número sem aumentar o limiar cria janela de tempo real morto — silenciosa.
 */
const REFRESH_MS = 4 * 60_000

let client:       SupabaseClient | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
/** Último token REALMENTE aplicado no socket. Ver o 🔴 em `getRealtimeClient`. */
let appliedToken: string | null = null
/** Trava de revogação: uma vez derrubado, esta aba não ressuscita. Ver `teardownRealtime`. */
let revoked = false

/**
 * Piso entre renovações. **Não é estética — é custo medido** (2026-08-03, no DevTools do
 * dono): três chamadas a `/api/auth/supabase-token` em ~20s, todas disparadas pelo listener
 * de `visibilitychange` a cada volta de foco. Como o `auth()` do NextAuth **revalida a
 * sessão no banco em toda chamada** (o cookie re-assinado nunca é escrito de volta no
 * caminho de RSC — ver access-revocation-design §4), cada alt-tab virava 3 SELECT + 1 UPDATE.
 *
 * 60s < 240s (REFRESH_MS), então o timer periódico NUNCA é afetado por este piso — ele só
 * poda a rajada dos eventos de acordar.
 */
const MIN_REFRESH_GAP_MS = 60_000
let lastRefreshAt = 0

/**
 * Busca um token novo e re-aplica no socket. 401 = sessão morreu → desconecta.
 * Qualquer outra falha (rede, 500) só espera o próximo tick: derrubar o tempo real
 * por blip de rede seria trocar um furo de segurança por um bug de produto.
 *
 * @param force ignora o piso de 60s. Reservado pro caso em que a decisão é do usuário e
 *   não pode esperar; hoje ninguém usa — os dois chamadores são o timer e os eventos.
 */
async function refreshOnce(force = false): Promise<void> {
  if (!client || revoked) return
  const now = Date.now()
  if (!force && now - lastRefreshAt < MIN_REFRESH_GAP_MS) return
  lastRefreshAt = now
  try {
    const res = await fetch("/api/auth/supabase-token")
    if (res.status === 401) { teardownRealtime({ redirect: true }); return }
    if (!res.ok) return
    const { token } = await res.json() as { token?: string }
    if (token && client) {
      appliedToken = token
      client.realtime.setAuth(token)
    }
  } catch {
    // próximo tick tenta de novo
  }
}

/**
 * ⏰ O `setInterval` NÃO corre com a máquina dormindo (tampa fechada, hibernação) nem,
 * em alguns navegadores, com a aba congelada em segundo plano. Voltar de 30 min de sono
 * com o token vencido e esperar até 4 min pelo próximo tick = inbox mudo sem sinal.
 * Renovar ao voltar o foco e ao voltar a rede fecha essa classe inteira.
 */
let wakeBound = false
function bindWakeListeners(): void {
  if (wakeBound || typeof document === "undefined") return
  wakeBound = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshOnce()
  })
  window.addEventListener("online", () => { void refreshOnce() })
}

export function getRealtimeClient(token: string): SupabaseClient {
  if (!client) {
    client = createClient(URL, ANON, {
      auth:     { persistSession: false, autoRefreshToken: false },
      // eventsPerSecond limita throttling client-side; volume do Kora cabe folgado.
      realtime: { params: { eventsPerSecond: 10 } },
    })
    if (!revoked) bindWakeListeners()
  }

  // 🔴 TRAVA DE REVOGAÇÃO — e ela precisa estar AQUI, não só no `teardownRealtime`.
  //    O teardown zera `client`, então sem esta linha o próximo efeito que montasse
  //    (clicar em outra conversa) caía no `if (!client)` e **ressuscitava** socket, timer e
  //    autenticação com a prop — que ainda é um JWT válido por até 10 min. A trava existia
  //    só no comentário; o código recriava. (Defeito meu, achado ao investigar o banner de
  //    "reconectando" — mesma classe do comentário falso que o `plans.ts` tinha.)
  //
  // ⚠️ NÃO lança e NÃO devolve null de propósito: isto roda dentro de `useEffect`, e um
  //    throw viraria tela branca em cima de uma sessão que já acabou. Devolver o cliente
  //    SEM autenticar é o degrade certo — a RLS exige `app_tenant_id()` no JWT, então um
  //    socket só com a chave anônima **não recebe nenhuma linha**. Nada vaza; o canal cai
  //    em CHANNEL_ERROR, o inbox mostra "reconectando" e degrada pro poll, e o redirect
  //    do 401 tira a pessoa da tela em seguida.
  if (revoked) return client

  // 🔴 O TOKEN DA PROP SÓ VALE NA CRIAÇÃO — nunca re-aplicar (achado da revisão adversarial,
  //    2026-08-03). O `token` vem de prop de RSC e fica **congelado** no render que o
  //    produziu; quem mantém o socket em dia é o `refreshOnce`. Chamar `setAuth(prop)` de
  //    novo REBAIXA o token fresco para o velho: o SDK sobrescreve `accessTokenValue`,
  //    reescreve o join payload de TODOS os canais e empurra `access_token` nos já joined
  //    (`realtime-js/RealtimeClient.js`), e um canal novo entra com `socket.accessTokenValue`
  //    (`RealtimeChannel.js`) — ou seja, com o token vencido.
  //    Cenário real: às 12h00 abre o inbox (token T0, vence 12h10) · 12h04 e 12h08 o timer
  //    troca por T1/T2 · 12h11 o atendente **clica em outra conversa** → o efeito `conv:`
  //    re-executa com a prop T0 **já vencida** → o canal da conversa aberta entra com JWT
  //    morto e o `list:` recebe token morto. Com token de 1h isso era invisível; com 10 min
  //    passaria a acontecer a cada troca de conversa depois dos primeiros 10 minutos.
  //    São TRÊS consumidores do singleton hoje (inbox, sino, kanban) — qualquer um deles
  //    re-montando reintroduziria o rebaixamento.
  if (!appliedToken) {
    appliedToken = token
    client.realtime.setAuth(token)
  }

  // Um timer só por aba, criado na primeira montagem e mantido enquanto a aba viver.
  if (!refreshTimer) refreshTimer = setInterval(refreshOnce, REFRESH_MS)
  return client
}

/**
 * Corta o tempo real imediatamente (sessão revogada). Idempotente.
 *
 * 🔴 A TRAVA `revoked` É O QUE FAZ ISTO VALER (achado da revisão adversarial, 2026-08-03).
 *    Sem ela, o teardown só zerava o singleton — e o próximo clique em outra conversa
 *    chamava `getRealtimeClient` de novo, caía no `if (!client)` e **ressuscitava** socket,
 *    timer e tudo, autenticado com a prop, que ainda é um JWT válido por até 10 min. A
 *    exposição ficava limitada pela expiração do token (a promessa "≤10 min" se mantinha),
 *    mas a promessa **"ou imediato no 401"** — a revogação-por-evento — era falsa.
 *    Uma vez revogada, a aba fica morta até um reload; e o reload passa pelo layout, que
 *    já redireciona quem não tem sessão.
 *
 * @param opts.redirect manda a aba pro login. Só no 401 (sessão definitivamente morta),
 *   nunca em falha de rede: sem isto, o atendente fica numa tela que parece viva — lista
 *   congelada, banner de "conexão instável" — sem nunca saber que a sessão dele acabou.
 */
export function teardownRealtime(opts?: { redirect?: boolean }): void {
  revoked = true
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  if (client) {
    // `disconnect()` devolve Promise — try/catch NÃO pega a rejeição dela. Sem o
    // `.catch`, um socket já morto vira unhandled rejection no console do cliente.
    void Promise.resolve(client.realtime.disconnect()).catch(() => { /* já caiu */ })
    client = null
  }
  if (opts?.redirect && typeof window !== "undefined") {
    window.location.href = "/auth/signin"
  }
}
