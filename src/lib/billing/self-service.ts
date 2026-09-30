import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// A cobrança deste cliente acontece DENTRO do produto?
// ═══════════════════════════════════════════════════════════════
//
// 🔑 DECISÃO DO DONO (05/08/2026): cliente com `billing_mode = 'manual'` é cobrado por
//    FORA do sistema — contrato direto, nota emitida à parte, cortesia, cliente da casa.
//    Pra ele, a área de Assinatura não é só inútil: ela oferece uma compra que a própria
//    plataforma vai recusar, e mostra "sua conta do mês" de um valor que ele não paga ali.
//
// 🔴 E hoje o estrago passa de cosmético. Auditoria de 05/08: **não existe caminho de
//    `manual` para `gateway`** em lugar nenhum do produto (o único escritor da coluna é o
//    signup). Então um cliente `manual` que caia em `trial_ended` é trancado pelo layout
//    na tela de assinatura, o modal não fecha, e TODO plano que ele clicar responde
//    *"a cobrança desta conta é combinada com a nossa equipe"*. Conta murada, sem saída,
//    até o cron suspendê-la 2 dias depois. Em produção, **4 de 5 tenants são `manual`**.
//
// ⚠️ Uma função, três consumidores (menu, rotas, paywall). A régua "dá pra cobrar?" já
//    existia em quatro cópias neste projeto e a quarta derrubou uma compra hoje — não vou
//    abrir a quinta por conveniência.

/**
 * `true` quando o cliente contrata e paga DENTRO do Kora (gateway).
 * `false` = cobrança combinada por fora ⇒ a área de Assinatura não existe pra ele.
 *
 * ⚠️ Fail-closed: tenant sem linha, ou erro de leitura, devolve `false`. Esconder uma tela
 *    de quem podia vê-la é um incômodo; oferecer contratação a quem é faturado por fora é
 *    cobrar duas vezes o mesmo cliente.
 */
export const temAssinaturaNoProduto = cache(async (tenantId: string | null | undefined): Promise<boolean> => {
  if (!tenantId) return false
  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("billing_mode")
    .eq("id", tenantId)
    .maybeSingle()
  if (error || !data) return false
  return (data as { billing_mode?: string | null }).billing_mode === "gateway"
})
