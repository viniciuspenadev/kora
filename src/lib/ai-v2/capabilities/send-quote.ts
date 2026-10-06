// ═══════════════════════════════════════════════════════════════
// Capacidade: REENVIAR o orçamento (AÇÃO, não consulta)
// ═══════════════════════════════════════════════════════════════
// A única AÇÃO do pacote comercial que a IA ganha. Reenvia o PDF de um orçamento
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
import { docCode, type DocumentKind } from "@/lib/commercial/documents"
import { QUOTE_TERM as Q } from "@/lib/commercial/quote-terms"
import { fmtFull } from "@/lib/agenda/format"

export const SEND_QUOTE = "send_quote"

// O cliente chama o documento de muitos jeitos — a descrição da tool cobre todos, para a IA
// reconhecer o pedido qualquer que seja a palavra dele; as respostas usam o nome da empresa.
const SYNONYMS = "orçamento, proposta ou cotação"

export const sendQuoteCapability = defineCapability<Record<string, never>>({
  id:           SEND_QUOTE,
  name:         `Reenviar ${Q.oneLower}`,
  category:     "crm",
  minPlanLevel: 0,
  isNode:       false,
  toolSchema: {
    type: "function",
    function: {
      name:        SEND_QUOTE,
      description: `Reenvia ao cliente o PDF ${Q.ofThe} (ele pode chamar de ${SYNONYMS}) que ele JÁ recebeu ou que já foi gerado. Use quando ele pedir de novo ("me manda de novo", "cadê meu orçamento?", "cadê a proposta?"). Nunca envia rascunho.`,
      parameters:  { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  playbook: () =>
    `REENVIAR ${Q.one.toUpperCase()}: se o cliente pedir de novo ${Q.the} (ou a proposta/cotação), use send_quote pra reenviar o PDF. Só existe pra documento já gerado; se não houver, avise que vai acionar o time — nunca invente que enviou.`,
  parseArgs: () => ({}),
  execute: async (ctx) => {
    if (!(await hasModule(ctx.tenantId, "crm"))) {
      return { ok: true, toolMessage: `Reenvio ${Q.ofThe} indisponível. Diga que vai acionar o time.` }
    }
    // O documento a reenviar: o mais recente ATIVO/ENVIADO deste contato, com PDF.
    const { data } = await supabaseAdmin.from("commercial_documents")
      .select("id, kind, number, year, code_prefix, valid_until")
      .eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id).eq("kind", "quote")
      .in("status", ["active", "sent"]).not("pdf_path", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    const doc = data as { id: string; kind: DocumentKind; number: number | null; year: number | null; code_prefix: string | null; valid_until: string | null } | null
    if (!doc) {
      return { ok: true, toolMessage: `Este cliente NÃO tem ${Q.oneLower} pronto pra reenviar. Avise que vai acionar o time pra preparar/enviar.` }
    }
    if (ctx.dryRun) return { ok: true, toolMessage: `[simulação] Reenviaria ${Q.the}.` }

    // Anti-spam (auditoria 2026-07-24): a IA pode chamar a tool 2-4× no mesmo turno
    // (loop bounded do agente). Se JÁ saiu um documento nesta conversa nos últimos
    // 3min, não reenvia de novo — só confirma. Guarda determinística, sem estado novo.
    const { data: recent } = await supabaseAdmin.from("chat_messages")
      .select("id").eq("conversation_id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
      .eq("content_type", "document").eq("sender_type", "bot")
      .gt("created_at", new Date(Date.now() - 3 * 60_000).toISOString()).limit(1).maybeSingle()
    if (recent) {
      return { ok: true, toolMessage: `${Q.one} JÁ foi reenviado agora há pouco nesta conversa — não mande de novo, só confirme que chegou.` }
    }

    const r = await sendQuoteToConversation({
      tenantId: ctx.tenantId, docId: doc.id, conversationId: ctx.conversationId, actorUserId: null,
    })
    if ("error" in r) {
      return { ok: true, toolMessage: `Não consegui reenviar ${Q.the} agora (${r.error}). Diga que vai acionar o time.` }
    }
    // Número pela MESMA função do PDF — antes era montado aqui com 3 dígitos ("COT-005") e o
    // PDF dizia "COT-0005": o cliente ouvia um número que não existia no documento.
    const code = doc.number != null && doc.year != null ? docCode(doc.kind, doc.number, doc.year, doc.code_prefix) : Q.oneLower
    const val = doc.valid_until ? ` Validade até ${fmtFull(doc.valid_until)}.` : ""
    return { ok: true, toolMessage: `${Q.one} ${code} reenviado aqui pelo WhatsApp. ✅${val} Confirme com o cliente que chegou.` }
  },
})
