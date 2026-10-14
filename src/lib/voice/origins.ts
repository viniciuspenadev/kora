/** Shared by the server router and CSP: only operator-configured HTTPS origins. */
export function evolutionVoiceOrigin(raw: string | null | undefined): URL | null {
  try {
    const url = new URL(raw ?? "")
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null
    return url
  } catch { return null }
}

export function voiceEvolutionOrigins(): string[] {
  const configured = [process.env.EVOLUTION_API_URL,
    ...(process.env.VOICE_EVOLUTION_ALLOWED_ORIGINS ?? "").split(","),
    ...(process.env.BLUE_VOICE_ENABLED === "true" ? [process.env.BLUE_VOICE_URL] : [])]
  return [...new Set(configured.flatMap(raw => {
    const url = evolutionVoiceOrigin(raw?.trim())
    return url ? [url.origin] : []
  }))]
}
