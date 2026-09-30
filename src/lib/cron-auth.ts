import { NextResponse } from "next/server"
import crypto from "node:crypto"

// ═══════════════════════════════════════════════════════════════
// Autenticação dos endpoints de cron — UM lugar para auditar
// ═══════════════════════════════════════════════════════════════
//
// 🔴 ERAM SETE LUGARES (unificado em 10/08). Este helper cobria só os 6 jobs que usam
//    `Authorization: Bearer`; os outros 6 (campanhas, Studio ×2, agenda, atendimento,
//    tarefas) comparavam `x-cron-secret` **inline, cada um por conta própria**. Doze jobs,
//    duas famílias, sete comparações — e mudar a regra exigia achar as sete. Duas delas
//    ficavam em rotas que ninguém associa a "cron" porque moram fora de `/api/cron`.
//
// 🔑 O ganho não é a comparação em si: é existir **um** ponto onde a regra vive. Auditoria
//    que precisa varrer sete cópias é auditoria que um dia passa por seis.
//
// ⚠️ AS DUAS FORMAS CONTINUAM ACEITAS de propósito. Trocar o header exigiria reagendar os
//    12 jobs no `pg_cron` — mexer em produção para um ganho estético. O mesmo segredo,
//    duas portas, uma verificação.

/** Comparação de tempo constante: sem isso o tamanho do prefixo correto vaza pelo relógio. */
function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  // ⚠️ `timingSafeEqual` LANÇA com tamanhos diferentes — a checagem tem que vir antes, e
  //    ela já vaza o tamanho (que não é segredo).
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/**
 * Autoriza uma chamada de cron. **Fail-closed**: sem `CRON_SECRET` no ambiente, recusa
 * (503) em vez de rodar aberto.
 *
 * ⚠️ O `DEPLOY.md` afirmava o contrário — que sem a env os endpoints ficariam **abertos**.
 *    Era falso desde que este helper virou fail-closed, e foi corrigido em 10/08. Fica
 *    registrado aqui porque quem lê o runbook num incidente merece a verdade.
 *
 * @returns `NextResponse` de erro (401/503) se não autorizado, ou `null` se ok.
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  }

  const bearer = req.headers.get("authorization")
  const direto = req.headers.get("x-cron-secret")

  const ok = (bearer !== null && iguais(bearer, `Bearer ${secret}`))
          || (direto !== null && iguais(direto, secret))

  return ok ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
