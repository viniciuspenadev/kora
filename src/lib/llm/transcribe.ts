// ═══════════════════════════════════════════════════════════════
// Transcrição de áudio INBOUND (voice note do cliente)
// ═══════════════════════════════════════════════════════════════
// Chamada pelos webhooks (Evolution + Meta) quando chega áudio 1:1 sem
// texto. Baixa o arquivo do storage (os dois webhooks já salvam no mesmo
// bucket), transcreve via OpenAI e grava em chat_messages.metadata.transcript
// — o bubble do inbox mostra "Ver transcrição" e a cadeia da IA usa o texto
// como incomingText (pro motor, vira uma mensagem de texto normal).
//
// Gate: módulo `ai` (transcrição CONSOME IA — custo da plataforma; tenant
// sem o add-on fica no comportamento clássico: áudio sem transcrição).
// Fail-safe TOTAL: qualquer falha → null, nada quebra, nada bloqueia.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { runTranscription, TRANSCRIBE_MODEL } from "./openai"
import { costOfTranscription } from "./pricing"
import { recordAiUsage } from "./usage"

const CHAT_BUCKET     = "chat-attachments"
const MAX_AUDIO_BYTES = 20 * 1024 * 1024   // API aceita 25MB; margem de folga

const EXT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/amr": "amr", "audio/wav": "wav", "audio/webm": "webm", "audio/aac": "aac",
}

export async function transcribeStoredAudio(args: {
  tenantId:      string
  conversationId: string
  /** Âncora do UPDATE do metadata (único por tenant). Null = só transcreve. */
  whatsappMsgId: string | null
  storagePath:   string
  mimeType?:     string | null
}): Promise<string | null> {
  try {
    if (!(await hasModule(args.tenantId, "ai"))) return null

    const t0 = Date.now()
    const { data, error } = await supabaseAdmin.storage.from(CHAT_BUCKET).download(args.storagePath)
    if (error || !data || data.size > MAX_AUDIO_BYTES) return null
    const buffer = Buffer.from(await data.arrayBuffer())

    // "audio/ogg; codecs=opus" (voice note WhatsApp) → ogg
    const mime = (args.mimeType ?? "").split(";")[0].trim().toLowerCase()
    const { text, usage } = await runTranscription({ buffer, fileName: `voice.${EXT_BY_MIME[mime] ?? "ogg"}` })

    // Ledger: transcrição é gasto de IA — custo real por tokens de áudio da API.
    recordAiUsage(
      { tenantId: args.tenantId, conversationId: args.conversationId, kind: "transcription" },
      {
        model:        TRANSCRIBE_MODEL,
        inputTokens:  usage.audioTokens,
        outputTokens: usage.outputTokens,
        costUsd:      costOfTranscription(TRANSCRIBE_MODEL, usage.audioTokens, usage.outputTokens),
        durationMs:   Date.now() - t0,
      },
    )
    if (!text) return null

    // Merge no metadata da mensagem → inbox ganha o "Ver transcrição".
    if (args.whatsappMsgId) {
      const { data: row } = await supabaseAdmin
        .from("chat_messages")
        .select("id, metadata")
        .eq("tenant_id", args.tenantId)
        .eq("whatsapp_msg_id", args.whatsappMsgId)
        .maybeSingle()
      if (row) {
        await supabaseAdmin
          .from("chat_messages")
          .update({ metadata: { ...((row.metadata as Record<string, unknown>) ?? {}), transcript: text } })
          .eq("id", row.id)
      }
    }
    return text
  } catch (e) {
    console.error("[transcribe] falhou:", e instanceof Error ? e.message : e)
    return null
  }
}
