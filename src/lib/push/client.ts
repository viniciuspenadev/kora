// Helpers de Web Push no browser. Usados pelos componentes client (push-prompt).
// Tudo defensivo: navegador sem suporte → funções viram no-op.

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/** App rodando instalado (standalone) — pré-requisito do push no iOS. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ se apresenta como Mac com touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  try {
    return await navigator.serviceWorker.register("/sw.js")
  } catch {
    return null
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/**
 * Inscreve este device no push e persiste no servidor. Idempotente: se já existe
 * subscription, só re-registra no backend (last_seen_at). Assume permissão já
 * concedida (chamar depois de Notification.requestPermission()).
 */
export async function subscribeToPush(publicKey: string): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })
  }
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, userAgent: navigator.userAgent }),
  })
  return res.ok
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingSubscription()
  if (!sub) return
  try {
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
  } catch { /* best-effort */ }
  try { await sub.unsubscribe() } catch { /* ignore */ }
}
