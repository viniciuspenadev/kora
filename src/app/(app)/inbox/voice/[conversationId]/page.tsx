import { notFound } from "next/navigation"
import { blueVoiceTarget } from "@/lib/voice/blue"
import { VoiceLauncher } from "@/components/voice/voice-launcher"

export const dynamic = "force-dynamic"

export default async function VoicePage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params
  let number: string
  try { ({ number } = await blueVoiceTarget(conversationId)) } catch { notFound() }
  return <VoiceLauncher conversationId={conversationId} phone={number} />
}
