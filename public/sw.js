/* Kora — Service Worker (Web Push).
   Mínimo e focado: recebe push e abre/foca a conversa ao clicar. Sem cache
   offline por enquanto (evita servir versões velhas do app durante o dev). */

self.addEventListener("push", (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = {} }

  const title = data.title || "Kora"
  const options = {
    body:    data.body || "",
    icon:    data.icon  || "/icons/icon-192.png",
    badge:   data.badge || "/icons/icon-192.png",
    tag:     data.tag,                 // colapsa notifs da mesma conversa
    renotify: Boolean(data.tag),       // re-alerta mesmo colapsando
    data:    { url: data.url || "/inbox" },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || "/inbox"

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    // Já tem uma janela do app aberta? foca (e navega pra conversa se der).
    for (const c of wins) {
      try {
        const u = new URL(c.url)
        if (u.origin === self.location.origin) {
          await c.focus()
          if ("navigate" in c) { try { await c.navigate(target) } catch (_) {} }
          return
        }
      } catch (_) { /* ignore */ }
    }
    // Senão abre uma nova.
    if (self.clients.openWindow) return self.clients.openWindow(target)
  })())
})

// Re-subscribe transparente quando o navegador rotaciona a subscription.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.subscribe(
        event.oldSubscription ? event.oldSubscription.options : undefined
      )
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub, userAgent: self.navigator ? self.navigator.userAgent : "" }),
      })
    } catch (_) { /* best-effort */ }
  })())
})
