"use client"

import { useState } from "react"
import { Check, Copy, QrCode } from "lucide-react"
import { toast } from "sonner"
import { brl, dataLonga } from "../format"

// ═══════════════════════════════════════════════════════════════
// PixBox — o bloco "como pagar"
// ═══════════════════════════════════════════════════════════════
// DECISÃO (a inversão que a tela de fatura pede): quem abre uma fatura em
// aberto quer PAGAR, não auditar. Então o copia-e-cola e o botão grande vêm
// primeiro, o QR fica a um toque (celular já está com o app aberto — quem
// precisa do QR é quem está no desktop), e o "por quê" mora abaixo.
//
// O valor aparece AQUI e de novo no bloco de conferência. Não é redundância:
// ninguém deve copiar um código sem ver quanto está pagando.

export function PixBox({
  totalCents, vencimento, pixCopiaECola, compacto = false,
}: {
  totalCents:    number
  vencimento:    string
  pixCopiaECola: string
  /** Dentro do modal: sem o cartão externo, tipografia um degrau menor. */
  compacto?:     boolean
}) {
  const [copiado, setCopiado] = useState(false)
  const [verQr, setVerQr]     = useState(compacto)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(pixCopiaECola)
      setCopiado(true)
      toast.success("Código Pix copiado")
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      toast.error("Não consegui copiar — selecione o código e copie na mão")
    }
  }

  return (
    <div className={compacto ? "" : "bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden"}>
      <div className={compacto ? "" : "px-5 sm:px-6 py-5"}>
        {!compacto && (
          <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Pagar com Pix</p>
              <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none mt-1.5">{brl(totalCents)}</p>
            </div>
            <p className="text-xs text-slate-500">
              Vencimento em <span className="font-semibold text-slate-700">{dataLonga(vencimento)}</span>
            </p>
          </div>
        )}

        {/* Código + ação. O botão é o elemento mais pesado do bloco de propósito. */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0 h-11 px-3 flex items-center bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-[11px] font-mono text-slate-500 truncate">{pixCopiaECola}</span>
          </div>
          <button
            type="button"
            onClick={copiar}
            className="h-11 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0"
          >
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copiado ? "Copiado" : "Copiar código Pix"}
          </button>
        </div>

        <div className="flex items-center gap-3 mt-3">
          {!compacto && (
            <button
              type="button"
              onClick={() => setVerQr((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700"
            >
              <QrCode className="size-3.5" />
              {verQr ? "Esconder QR Code" : "Mostrar QR Code"}
            </button>
          )}
          <p className="text-[11px] text-slate-400">
            O Pix cai em até 1 minuto — a gente confirma por e-mail.
          </p>
        </div>

        {verQr && (
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <PseudoQr payload={pixCopiaECola} />
            <div className="text-xs text-slate-500 leading-relaxed max-w-[15rem]">
              Abra o app do banco, escolha <span className="font-semibold text-slate-700">Pix &rsaquo; Ler QR Code</span> e
              aponte pra cá. O valor já vem preenchido.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * QR de exemplo — desenho determinístico a partir do payload.
 * 🔴 TODO(dev): trocar pelo QR real do PSP (data-URI; NUNCA imagem de host externo).
 * Fica aqui pra a tela ser revisável com o peso visual certo — um quadrado
 * cinza mentiria sobre a densidade do bloco.
 */
function PseudoQr({ payload, size = 156 }: { payload: string; size?: number }) {
  const N = 25
  // Hash puro do payload (sem estado mutável no render) + ruído determinístico
  // por célula: o mesmo código Pix desenha sempre o mesmo QR.
  const seed = Array.from(payload).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const escuro = (x: number, y: number) => {
    let h = (seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5
    return (h >>> 0) % 100 > 45
  }
  const dentroDoOlho = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9)

  const cells = Array.from({ length: N * N }, (_, i) => ({ x: i % N, y: Math.floor(i / N) }))
    .filter((c) => !dentroDoOlho(c.x, c.y) && escuro(c.x, c.y))

  const olho = (ox: number, oy: number) => (
    <g key={`${ox}-${oy}`}>
      <rect x={ox} y={oy} width={7} height={7} fill="#0f172a" />
      <rect x={ox + 1} y={oy + 1} width={5} height={5} fill="#fff" />
      <rect x={ox + 2} y={oy + 2} width={3} height={3} fill="#0f172a" />
    </g>
  )

  return (
    <div className="p-2.5 bg-white border border-slate-200 rounded-xl shrink-0" aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${N} ${N}`} shapeRendering="crispEdges">
        {cells.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1} height={1} fill="#0f172a" />)}
        {olho(0, 0)}{olho(N - 7, 0)}{olho(0, N - 7)}
      </svg>
    </div>
  )
}
