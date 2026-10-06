"use client"

// "Meus avisos" (Meu perfil) — o som dos avisos (com teste) e os avisos no celular neste
// aparelho. Sem botão de silenciar: o som é obrigatório para toda a equipe (decisão do dono).
// O que cada aviso diz e para quem vai: lib/atendimento/notices.ts.

import { useEffect, useState } from "react"
import { Bell, Volume2, Smartphone, Check, Loader2 } from "lucide-react"
import { playNotifySound } from "@/lib/notify-sound"
import { isPushSupported, isIOS, isStandalone, registerServiceWorker, getExistingSubscription, subscribeToPush } from "@/lib/push/client"

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
const BTN = "inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"

type PushState = "checking" | "on" | "off" | "denied" | "ios-install" | "unsupported"

export function MyAlertsCard() {
  const [push, setPush] = useState<PushState>("checking")
  const [busy, setBusy] = useState(false)
  const [played, setPlayed] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const set = (s: PushState) => { if (alive) setPush(s) }
      if (isIOS() && !isStandalone()) return set("ios-install")
      if (!isPushSupported() || !VAPID) return set("unsupported")
      if (Notification.permission === "denied") return set("denied")
      await registerServiceWorker()
      const sub = Notification.permission === "granted" ? await getExistingSubscription() : null
      set(sub ? "on" : "off")
    })()
    return () => { alive = false }
  }, [])

  async function enable() {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm === "denied") { setPush("denied"); return }
      if (perm !== "granted") return
      setPush((await subscribeToPush(VAPID)) ? "on" : "off")
    } finally { setBusy(false) }
  }

  function test() { playNotifySound(); setPlayed(true); setTimeout(() => setPlayed(false), 1500) }

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="size-4 text-primary-600" />
        <h2 className="text-sm font-bold text-slate-900">Meus avisos</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        O Kora avisa quando uma conversa chega para você, quando o cliente responde e quando algo precisa de você.
        Com o Kora aberto, toca aqui e o celular fica quieto; com o Kora fechado, o aviso vai para o celular.
      </p>

      <div className="divide-y divide-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 first:pt-0">
          <span className="size-9 rounded-xl bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Volume2 className="size-4" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">Som no Kora</p>
            <p className="text-xs text-slate-500">Toca a cada aviso novo. É obrigatório para toda a equipe.</p>
          </div>
          <button type="button" onClick={test} className={BTN}>
            {played ? <><Check className="size-3.5 text-emerald-600" /> Tocou</> : "Tocar o som de teste"}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 last:pb-0">
          <span className="size-9 rounded-xl bg-primary-50 text-primary-600 grid place-items-center shrink-0"><Smartphone className="size-4" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">Avisos neste aparelho</p>
            <p className="text-xs text-slate-500">
              {push === "on" ? "Ativado. Na tela bloqueada aparece só o nome e de onde veio — o conteúdo fica dentro do Kora."
                : push === "denied" ? "Bloqueado neste navegador. Libere as notificações do Kora nas configurações do navegador."
                : push === "ios-install" ? "No iPhone, adicione o Kora à Tela de Início (Compartilhar → Adicionar à Tela de Início) e ative por lá."
                : push === "unsupported" ? "Este navegador não recebe avisos fora do Kora."
                : push === "checking" ? "Conferindo…"
                : "Receba os avisos mesmo com o Kora fechado."}
            </p>
          </div>
          {push === "on" && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check className="size-3.5" /> Ativado</span>}
          {push === "off" && (
            <button type="button" onClick={() => void enable()} disabled={busy} className={BTN}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} Ativar neste aparelho
            </button>
          )}
        </div>
      </div>
      <p className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
        Aparelhos com avisos ligados aparecem em Dispositivos e sessões, logo abaixo. Desconectar um aparelho desliga os avisos dele.
      </p>
    </section>
  )
}
