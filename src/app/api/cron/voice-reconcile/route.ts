import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { recoverExpiredVoiceCalls } from '@/lib/voice/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied
  try { return NextResponse.json(await recoverExpiredVoiceCalls()) }
  catch { return NextResponse.json({ error: 'Voice recovery unavailable' }, { status: 503 }) }
}
