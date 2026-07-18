// Kora Companion — service worker (MV3).
// ÚNICO ponto que fala com a API do Kora. Token em chrome.storage.local (nunca
// na página); content script e sidebar pedem tudo por mensagem.

const DEFAULT_BASE = "http://localhost:3000"

async function getState() {
  const s = await chrome.storage.local.get(["token", "baseUrl", "user", "tenant"])
  return {
    token:   s.token   || null,
    baseUrl: s.baseUrl || DEFAULT_BASE,
    user:    s.user    || null,
    tenant:  s.tenant  || null,
  }
}

async function api(path, opts = {}) {
  const st = await getState()
  const headers = { "content-type": "application/json" }
  if (st.token) headers.authorization = `Bearer ${st.token}`
  let res
  try {
    res = await fetch(st.baseUrl + path, { ...opts, headers })
  } catch {
    return { ok: false, status: 0, error: "Sem conexão com o servidor Kora.", code: "offline" }
  }
  let data = null
  try { data = await res.json() } catch { /* corpo vazio */ }
  if (!res.ok) {
    // Token revogado/expirado → limpa a sessão local (a sidebar mostra o estado).
    if (res.status === 401) await chrome.storage.local.remove(["token", "user", "tenant"])
    return { ok: false, status: res.status, error: (data && data.error) || `Erro ${res.status}`, code: (data && data.code) || null }
  }
  return { ok: true, status: res.status, data }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    switch (msg && msg.type) {
      case "status": {
        const st = await getState()
        sendResponse({ ok: true, loggedIn: !!st.token, user: st.user, tenant: st.tenant, baseUrl: st.baseUrl })
        break
      }
      case "login": {
        if (msg.baseUrl) await chrome.storage.local.set({ baseUrl: String(msg.baseUrl).replace(/\/+$/, "") })
        const r = await api("/api/ext/auth", {
          method: "POST",
          body: JSON.stringify({ email: msg.email, password: msg.password, label: msg.label || "Chrome" }),
        })
        if (r.ok) await chrome.storage.local.set({ token: r.data.token, user: r.data.user, tenant: r.data.tenant })
        sendResponse(r)
        break
      }
      case "logout": {
        await api("/api/ext/logout", { method: "POST" })
        await chrome.storage.local.remove(["token", "user", "tenant"])
        sendResponse({ ok: true })
        break
      }
      case "me":
        sendResponse(await api("/api/ext/me"))
        break
      case "resolve":
        sendResponse(await api(`/api/ext/resolve?phone=${encodeURIComponent(msg.phone || "")}`))
        break
      case "pipelines":
        sendResponse(await api("/api/ext/pipelines"))
        break
      case "createContact":
        sendResponse(await api("/api/ext/contacts", { method: "POST", body: JSON.stringify({ name: msg.name, phone: msg.phone, photoUrl: msg.photoUrl }) }))
        break
      case "createDeal":
        sendResponse(await api("/api/ext/deals", {
          method: "POST",
          body: JSON.stringify({ contactId: msg.contactId, name: msg.name, pipelineId: msg.pipelineId, stageId: msg.stageId, value: msg.value }),
        }))
        break
      case "moveStage":
        sendResponse(await api(`/api/ext/deals/${encodeURIComponent(msg.dealId)}/stage`, { method: "PATCH", body: JSON.stringify({ stageId: msg.stageId }) }))
        break
      case "addNote":
        sendResponse(await api(`/api/ext/deals/${encodeURIComponent(msg.dealId)}/notes`, { method: "POST", body: JSON.stringify({ text: msg.text }) }))
        break
      case "quickReplies":
        sendResponse(await api(`/api/ext/quick-replies${msg.contactId ? `?contactId=${encodeURIComponent(msg.contactId)}` : ""}`))
        break
      case "dealDetail":
        sendResponse(await api(`/api/ext/deals/${encodeURIComponent(msg.dealId)}`))
        break
      case "createQuote":
        sendResponse(await api(`/api/ext/deals/${encodeURIComponent(msg.dealId)}/quote`, { method: "POST", body: "{}" }))
        break
      case "markQuoteSent":
        sendResponse(await api(`/api/ext/documents/${encodeURIComponent(msg.docId)}/sent`, { method: "POST", body: "{}" }))
        break
      case "radar":
        sendResponse(await api("/api/ext/radar"))
        break
      case "agenda":
        sendResponse(await api(`/api/ext/agenda?contactId=${encodeURIComponent(msg.contactId)}`))
        break
      case "agendaSlots":
        sendResponse(await api(
          `/api/ext/agenda/slots?resourceId=${encodeURIComponent(msg.resourceId)}&date=${encodeURIComponent(msg.date)}` +
          (msg.serviceId ? `&serviceId=${encodeURIComponent(msg.serviceId)}` : ""),
        ))
        break
      case "agendaBook":
        sendResponse(await api("/api/ext/agenda/book", {
          method: "POST",
          body: JSON.stringify({ contactId: msg.contactId, resourceId: msg.resourceId, serviceId: msg.serviceId, startsAt: msg.startsAt, notify: msg.notify }),
        }))
        break
      case "agendaReschedule":
        sendResponse(await api("/api/ext/agenda/reschedule", {
          method: "POST",
          body: JSON.stringify({ appointmentId: msg.appointmentId, startsAt: msg.startsAt }),
        }))
        break
      case "agendaConfirm":
        sendResponse(await api("/api/ext/agenda/confirm", {
          method: "POST",
          body: JSON.stringify({ appointmentId: msg.appointmentId }),
        }))
        break
      case "quotePdf": {
        // binário → base64: mensagens do runtime só trafegam JSON.
        const st = await getState()
        try {
          const res = await fetch(`${st.baseUrl}/api/ext/documents/${encodeURIComponent(msg.docId)}/pdf`, {
            headers: st.token ? { authorization: `Bearer ${st.token}` } : {},
          })
          if (!res.ok) {
            let data = null
            try { data = await res.json() } catch { /* corpo vazio */ }
            if (res.status === 401) await chrome.storage.local.remove(["token", "user", "tenant"])
            sendResponse({ ok: false, status: res.status, error: (data && data.error) || `Erro ${res.status}`, code: (data && data.code) || null })
            break
          }
          const u8 = new Uint8Array(await res.arrayBuffer())
          let bin = ""
          for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
          const m = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")
          sendResponse({ ok: true, status: 200, data: { b64: btoa(bin), fileName: (m && m[1]) || "cotacao.pdf" } })
        } catch {
          sendResponse({ ok: false, status: 0, error: "Sem conexão com o servidor Kora.", code: "offline" })
        }
        break
      }
      default:
        sendResponse({ ok: false, error: "Mensagem desconhecida." })
    }
  })()
  return true // resposta assíncrona
})
