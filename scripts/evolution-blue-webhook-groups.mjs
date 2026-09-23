#!/usr/bin/env node
// Piloto Blue: preserva a URL e os eventos existentes; acrescenta só eventos
// de metadados de grupo. Não altera groupsIgnore nem o flag interno do Kora.
const mode = process.argv[2] ?? "--inspect"
if (!["--inspect", "--apply-blue"].includes(mode)) throw new Error("Use --inspect ou --apply-blue")

const base = process.env.EVOLUTION_API_URL?.replace(/\/$/, "")
const key = process.env.EVOLUTION_API_KEY
const name = "kora-blue-digital-hub-1783030819675"
const additions = ["GROUPS_UPSERT", "GROUP_UPDATE", "GROUP_PARTICIPANTS_UPDATE"]
if (!base || !key) throw new Error("Credenciais da Evolution indisponíveis")

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { apikey: key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Evolution respondeu HTTP ${response.status}`)
  return response.json()
}

const path = `/webhook/find/${name}`
const before = await request(path)
const endpoint = new URL(before.url)
if (endpoint.hostname !== "kora.bluedigitalhub.com.br"
  || !/^\/api\/webhooks\/evolution\/[a-zA-Z0-9_-]{16,128}$/.test(endpoint.pathname)
  || before.enabled !== true || before.webhookByEvents !== false || before.webhookBase64 !== false
  || !Array.isArray(before.events) || !before.events.includes("MESSAGES_UPSERT")) {
  throw new Error("Webhook da Blue diverge do contrato esperado; nenhuma alteração realizada")
}
const target = [...new Set([...before.events, ...additions])]
const report = value => console.log(JSON.stringify({
  mode, enabled: value.enabled === true, eventCount: value.events?.length ?? 0,
  groupEvents: additions.filter(event => value.events?.includes(event)),
  messageEventPreserved: before.events.every(event => value.events?.includes(event)),
  urlPreserved: value.url === before.url,
}))
if (mode === "--inspect" || target.length === before.events.length) {
  report(before)
  process.exit(0)
}

const set = events => request(`/webhook/set/${name}`, {
  method: "POST",
  body: JSON.stringify({ webhook: {
    url: before.url, enabled: true, events, byEvents: false, base64: false,
  } }),
})
try {
  await set(target)
  const after = await request(path)
  if (after.url !== before.url || after.enabled !== true || after.webhookByEvents !== false
    || after.webhookBase64 !== false || !target.every(event => after.events?.includes(event))) {
    throw new Error("Configuração não confirmada pela Evolution")
  }
  report(after)
} catch (error) {
  try { await set(before.events) } catch { /* preservar o erro original; revisão manual necessária */ }
  throw error
}
