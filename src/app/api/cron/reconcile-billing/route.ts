import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"
import { reconcileAsaas } from "@/lib/asaas/reconcile"

/**
 * GET /api/cron/reconcile-billing — reconciliação com o gateway, a cada 15 minutos.
 *
 * 🔑 POR QUE UM JOB PRÓPRIO, E NÃO NO DIÁRIO (decisão do dono, 2026-08-06).
 *    A reconciliação nasceu pendurada no `trial-housekeeping`, que roda 1×/dia às 5h05.
 *    Frequência errada para o que ela faz: se o webhook de um pagamento se perder às 6h da
 *    manhã, o cliente fica travado — **já tendo pago** — até as 5h05 do dia seguinte.
 *    Quase 24 horas de alguém que colocou o cartão e não recebeu o produto. A guarda do
 *    housekeeping impede que ele seja SUSPENSO nesse meio-tempo, mas não o destrava.
 *    Com 15 minutos, a pior espera cai de ~24h para ~15min.
 *
 * ⚠️ Cada tarefa na frequência DELA. Encerrar trial vencido é decisão de calendário (1×/dia
 *    está certo); socorrer quem pagou é urgência de minutos. Amarrar as duas no mesmo
 *    horário obrigaria a escolher entre rodar faxina de armazenamento a cada 15min ou
 *    deixar cliente pagante esperando um dia.
 *
 * 💰 Custo real ~zero: três consultas em tabelas pequenas, e chamada ao gateway **só** se
 *    existir alguém preso — o caso normal é não existir ninguém e o job sair em ms.
 *
 * ⚠️ `reconcileAsaas` continua sendo chamada no `trial-housekeeping` também, de propósito:
 *    se este job for desativado por engano, o diário ainda pega. Rodar duas vezes é
 *    inofensivo — a função é idempotente (dedup por `payment_id`, limpeza de reserva
 *    condicionada ao valor exato, e `processAsaasEvent` sai cedo se já processado).
 *
 * 🔒 Autentica por `CRON_SECRET` (fail-closed: sem a env, 503 — nunca roda aberto).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const negado = requireCronSecret(req)
  if (negado) return negado

  try {
    // ⚠️ A trava EFETIVA da reconciliação NÃO é esta — é a que `reconcileAsaas` toma por
    //    dentro, com o nome do TRABALHO (`reconcile-asaas`). Motivo: ela tem DOIS
    //    chamadores (este job e o `trial-housekeeping`), com nomes de job diferentes; uma
    //    trava por nome de job serializa cada um contra si mesmo e nunca um contra o
    //    outro — e os dois creditariam o mesmo pagamento. Aqui a trava só impede este
    //    job de se atropelar.
    const saida = await executarJob({ job: "reconcile-billing" }, async () => {
      const r = await reconcileAsaas()
      return {
        processed: r.reprocessados + r.liberados,
        failed:    r.erros,
        meta:      { ...r },
      }
    })

    if (saida.pulado) return NextResponse.json({ ok: true, pulado: "já em execução" })

    const r = saida.resultado
    // ⚠️ Log só quando houve TRABALHO. Um job de 15 em 15 minutos que grita "0, 0, 0" 96
    //    vezes por dia treina todo mundo a ignorar o log dele — e aí o dia em que ele
    //    tiver algo a dizer passa despercebido. (O livro registra as 96 de qualquer forma:
    //    é ele que sabe se o job rodou, não o log.)
    if ((r.processed ?? 0) > 0 || (r.failed ?? 0) > 0) {
      console.log(JSON.stringify({ src: "cron", kind: "reconcile-billing", ...r }))
    }

    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error("[cron/reconcile-billing]", (e as Error).message)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
