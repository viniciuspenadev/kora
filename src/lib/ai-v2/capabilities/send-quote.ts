// ═══════════════════════════════════════════════════════════════
// Capacidade: REENVIAR a cotação (AÇÃO, não consulta)
// ═══════════════════════════════════════════════════════════════
// A única AÇÃO do pacote comercial que a IA ganha. Reenvia o PDF de uma cotação
// JÁ GERADA (active) ou já enviada — nunca rascunho.
// ✅ DECISÃO DO OWNER (2026-07-24): `active` conta como reenviável — GERAR o PDF
//    numerado JÁ é a autorização do humano (não precisa ter sido enviado antes).
//    NÃO reabrir pra exigir `sent`. Doutrina:
//   • parameters VAZIO — a IA não escolhe QUAL nem PRA QUEM (escopo-contato duro);
//   • só doc do PRÓPRIO contato da conversa (o núcleo re-valida — anti-IDOR);
//   • só `active`/`sent` = autorizado por humano; rascunho jamais;
//   • janela 24h fail-closed (no núcleo).
// Off por padrão no nó — o dono liga sabendo.

import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { sendQuoteToConversation } from "@/lib/commercial/send-quote"
import { fmtFull } from "@/lib/agenda/format"

export const SEND_QUOTE = "send_quote"

export const sendQuoteCapability = defineCapability<Record<string, never>>({
  id:           SEND_QUOTE,
  name:         "Reenviar cotação",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        SEND_QUOTE,
      description: "Reenvia ao cliente o PDF de uma proposta/cotação que ele JÁ recebeu ou que já foi gerada. Use quando ele pedir a proposta de novo (\"me manda de novo\", \"cadê minha proposta?\"). Nunca envia rascunho.",
      parameters:  { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  playbook: () =>
    "REENVIAR PROPOSTA: se o cliente pedir a cotação/proposta de novo, use send_quote pra reenviar o PDF. Só existe pra documento já gerado; se não houver, avise que vai acionar o time — nunca invente que enviou.",
  parseArgs: () => ({}),
  execute: async (ctx) => {
    if (!(await hasModule(ctx.tenantId, "crm"))) {
      return { ok: true, toolMessage: "Reenvio de cotação indisponível. Diga que vai acionar o time." }
    }
    // A cotação a reenviar: a mais recente ATIVA/ENVIADA deste contato, com PDF.
    const { data } = await supabaseAdmin.from("commercial_documents")
      .select("id, number, year, valid_until")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id).eq("kind", "quote")
      .in("status", ["active", "sent"]).not("pdf_path", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    const doc = data as { id: string; number: number | null; year: number | null; valid_until: string | null } | null
    if (!doc) {
      return { ok: true, toolMessage: "Este cliente NÃO tem proposta pronta pra reenviar. Avise que vai acionar o time pra preparar/enviar." }
    }
    if (ctx.dryRun) return { ok: true, toolMessage: "[simulação] Reenviaria a proposta." }

    // Anti-spam (auditoria 2026-07-24): a IA pode chamar a tool 2-4× no mesmo turno
    // (loop bounded do agente). Se JÁ saiu um documento nesta conversa nos últimos
    // 3min, não reenvia de novo — só confirma. Guarda determinística, sem estado novo.
    const { data: recent } = await supabaseAdmin.from("chat_messages")
      .select("id").eq("conversation_id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
      .eq("content_type", "document").eq("sender_type", "bot")
      .gt("created_at", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1).maybeSingle()
    if (recent) {
      return { ok: true, toolMessage: "A proposta JÁ foi reenviada agora há pouco nesta conversa — não mande de novo, só confirme que ela chegou." }
    }

    const r = await sendQuoteToConversation({
      tenantId: ctx.tenantId, docId: doc.id, conversationId: ctx.conversationId, actorUserId: null,
    })
    if ("error" in r) {
      return { ok: true, toolMessage: `Não consegui reenviar a proposta agora (${r.error}). Diga que vai acionar o time.` }
    }
    const code = doc.number != null ? `COT-${String(doc.number).padStart(3, "0")}/${doc.year ?? ""}` : "proposta"
    const val = doc.valid_until ? ` Válida até ${fmtFull(doc.valid_until)}.` : ""
    return { ok: true, toolMessage: `Proposta ${code} reenviada aqui pelo WhatsApp. ✅${val} Confirme com o cliente que chegou.` }
  },
})
