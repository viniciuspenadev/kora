"use client"

// Som dos avisos do Kora — o "ding-dong" de 2 notas do protótipo da oferta de atendimento
// (aprovado pelo dono em 27/09), gerado pelo navegador: sem arquivo de áudio. Som obrigatório
// (decisão do dono: sem botão de silenciar).
// O navegador só deixa tocar depois que a pessoa clica ou digita na página: o primeiro gesto
// libera o som. Tocou antes disso → fica "travado" e a tela mostra o pedido de clique.

type Listener = (locked: boolean) => void

let ctx: AudioContext | null = null
let unlocked = false
let pendingLock = false
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l(pendingLock && !unlocked))

function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    return ctx
  } catch { return null }
}

/** Liga a escuta do primeiro gesto (chamar 1× no app). */
export function armNotifySound(): () => void {
  const unlock = () => {
    const a = audio()
    if (!a) return
    // A liberação é assíncrona: só conta depois que o navegador confirma.
    const done = () => { if (a.state === "running") { unlocked = true; pendingLock = false; emit(); cleanup() } }
    if (a.state === "running") done()
    else void a.resume?.().then(done, () => {})
  }
  const cleanup = () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock) }
  window.addEventListener("pointerdown", unlock)
  window.addEventListener("keydown", unlock)
  return cleanup
}

/** "Precisa clicar para liberar o som?" — para a tela mostrar o aviso. */
export function onNotifySoundLock(l: Listener): () => void {
  listeners.add(l)
  l(pendingLock && !unlocked)
  return () => { listeners.delete(l) }
}

/** Toca o aviso. Sem o primeiro gesto ainda, guarda o pedido de liberação. */
export function playNotifySound(): void {
  const a = audio()
  if (!a) return
  if (a.state !== "running") {
    void a.resume?.()
    // Sem o primeiro gesto, o navegador não deixa: pede o clique. Já liberado (ex.: só
    // suspenso pelo sistema), o `resume` acima volta a tocar.
    if (!unlocked) { pendingLock = true; emit(); return }
  }
  try {
    const now = a.currentTime
    for (const [f, d] of [[880, 0], [660, 0.22]] as const) {
      const o = a.createOscillator(), g = a.createGain()
      o.type = "sine"; o.frequency.value = f
      g.gain.setValueAtTime(0, now + d)
      g.gain.linearRampToValueAtTime(0.22, now + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, now + d + 0.45)
      o.connect(g).connect(a.destination)
      o.start(now + d); o.stop(now + d + 0.5)
    }
  } catch { /* sem áudio no aparelho: o sininho continua */ }
}
