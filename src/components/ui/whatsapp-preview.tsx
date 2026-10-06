import { CornerUpLeft, Calendar, List } from "lucide-react"

// ═══════════════════════════════════════════════════════════════
// Preview do WhatsApp — simula como a mensagem chega na tela do cliente.
// Reusável: lembretes (texto+botões in-window OU template fora), broadcast, etc.
// ═══════════════════════════════════════════════════════════════

interface WhatsAppPreviewProps {
  /** Corpo da mensagem (já com variáveis resolvidas). Suporta *negrito* do WhatsApp. */
  body:     string
  /** Rótulos dos botões interativos (ex: ["Confirmar","Remarcar"]). */
  buttons?: string[]
  /** Mensagem de LISTA do WhatsApp: um botão que abre uma folha de opções (ex: remarcação). */
  list?:    { buttonText: string; rows: string[] }
  /** "template" mostra o selo de modelo (mensagem fora da janela). */
  variant?: "free" | "template"
  /** Selo do canal/veículo (ex: "Dentro da janela · grátis"). */
  badge?:   string
}

// *negrito* → <strong> (sintaxe WhatsApp), preservando o resto.
function renderWaText(text: string) {
  const parts = text.split(/(\*[^*]+\*)/g)
  return parts.map((p, i) =>
    p.startsWith("*") && p.endsWith("*") && p.length > 2
      ? <strong key={i}>{p.slice(1, -1)}</strong>
      : <span key={i}>{p}</span>,
  )
}

export function WhatsAppPreview({ body, buttons, list, variant = "free", badge }: WhatsAppPreviewProps) {
  const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 select-none" aria-label="Prévia no WhatsApp">
      {/* Cabeçalho do chat (estilo WhatsApp) */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#075E54] text-white">
        <div className="size-7 rounded-full bg-white/20 grid place-items-center text-[11px] font-bold">C</div>
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold leading-tight">Seu cliente</p><p className="text-[10px] text-white/70 leading-tight">online</p></div>
        {badge && <span className="text-[9px] font-semibold bg-white/15 rounded-full px-2 py-0.5">{badge}</span>}
      </div>

      {/* Papel de parede + balão recebido */}
      <div className="p-3 bg-[#E5DDD5] min-h-[120px]">
        <div className="max-w-[85%]">
          <div className="relative bg-white rounded-lg rounded-tl-none shadow-sm px-2.5 py-1.5">
            {variant === "template" && (
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1"><Calendar className="size-2.5" /> Modelo (fora da janela)</p>
            )}
            <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-snug">{renderWaText(body || "…")}</p>
            <p className="text-[9px] text-slate-400 text-right mt-0.5">{now}</p>
          </div>

          {/* Botões interativos (full-width, estilo WhatsApp) */}
          {buttons && buttons.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {buttons.map((b, i) => (
                <div key={i} className="bg-white rounded-lg shadow-sm py-2 grid place-items-center">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#00A5F4]"><CornerUpLeft className="size-3.5" /> {b}</span>
                </div>
              ))}
            </div>
          )}

          {/* Mensagem de LISTA: botão que abre a folha + prévia das opções (estilo WhatsApp) */}
          {list && list.rows.length > 0 && (
            <div className="mt-0.5">
              <div className="bg-white rounded-lg shadow-sm py-2 grid place-items-center">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#00A5F4]"><List className="size-3.5" /> {list.buttonText}</span>
              </div>
              <div className="mt-1 rounded-lg bg-white shadow-sm overflow-hidden">
                <p className="px-2.5 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Toca p/ abrir</p>
                <div className="divide-y divide-slate-100">
                  {list.rows.map((r, i) => (
                    <div key={i} className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-slate-700">{r}</span>
                      <span className="size-3.5 rounded-full border border-slate-300 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
