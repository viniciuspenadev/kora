"use client"
import { signOut } from "next-auth/react"
import { unsubscribeFromPush } from "@/lib/push/client"
import { endMyCurrentSession } from "@/lib/actions/profile"

/**
 * Logout que LIMPA a inscrição de push ANTES de encerrar a sessão.
 *
 * Sem isto (bug achado no pentest 2026-08-01): um dispositivo deslogado continuava inscrito
 * em `push_subscriptions` e o servidor seguia mandando push com PII (nome do contato + prévia
 * da mensagem) na tela de bloqueio. `unsubscribeFromPush` faz as duas pontas — `pushManager…
 * unsubscribe()` no browser + DELETE server-side (`/api/push/unsubscribe`, por user_id).
 *
 * Ordem importa: unsubscribe PRIMEIRO (a sessão ainda vale → o delete server-side autentica),
 * depois `signOut`. Best-effort: falha no unsubscribe NUNCA bloqueia o logout.
 */
export async function logoutWithCleanup(opts?: Parameters<typeof signOut>[0]): Promise<void> {
  try { await unsubscribeFromPush() } catch { /* best-effort — não trava o logout */ }
  // Revoga a linha de user_sessions do sid corrente (a sessão ainda vale → a action autentica).
  // Sem isto, um JWT copiado sobrevivia 30d mesmo após logout — só o cookie caía.
  try { await endMyCurrentSession() } catch { /* best-effort — não trava o logout */ }
  await signOut(opts)
}
