import Script from "next/script"
import Link from "next/link"
import { notFound } from "next/navigation"
import { blueVoiceTarget } from "@/lib/voice/blue"

export const dynamic = "force-dynamic"

export default async function VoicePage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params
  try { await blueVoiceTarget(conversationId) } catch { notFound() }

  return (
    <main id="voice-phone" data-conversation-id={conversationId} className="mx-auto flex min-h-[70vh] max-w-lg flex-col gap-5 p-6">
      <div>
        <Link href="/inbox" className="text-sm text-primary hover:underline">← Voltar aos atendimentos</Link>
        <h1 className="mt-5 text-2xl font-semibold">Ligação WhatsApp</h1>
        <p className="mt-2 text-sm text-slate-600">A ligação usa o número Blue conectado por QR Code. Permita o microfone ao iniciar.</p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-live="polite">
        <p id="voice-connection" className="text-sm text-slate-600">Verificando a linha…</p>
        <p id="voice-call-state" className="mt-2 text-sm font-medium">Nenhuma ligação ativa.</p>
        <p id="voice-error" role="alert" className="mt-2 text-sm text-red-700" />
        <div className="mt-5 flex gap-3">
          <button id="voice-dial" type="button" disabled className="rounded-lg bg-primary px-5 py-2 font-semibold text-white disabled:opacity-50">Ligar</button>
          <button id="voice-hangup" type="button" disabled className="rounded-lg bg-red-600 px-5 py-2 font-semibold text-white disabled:opacity-50">Desligar</button>
        </div>
      </section>
      <Script src="/voice/kora-webphone.js" strategy="afterInteractive" />
    </main>
  )
}
