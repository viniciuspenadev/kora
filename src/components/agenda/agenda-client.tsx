"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, Plus, Settings2, Share2, LayoutGrid, CalendarRange, Lock, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AgendaOverview } from "@/components/agenda/agenda-overview"
import { ShareAgendaDialog } from "@/components/agenda/share-agenda-dialog"
import { AgendaBoard } from "@/components/agenda/board/agenda-board"
import { BookingModal, type BookingInitial } from "@/components/agenda/board/booking-modal"
import { BlockModal } from "@/components/agenda/board/block-modal"
import { type ResourceRow, type ServiceRow } from "@/lib/actions/agenda"

/**
 * Casca da Agenda — SEM header de página (chrome removido; o conteúdo ocupa a
 * altura toda). Dois modos: **Visão Geral** (mantida 100% intacta) e **Calendário**
 * (board da Agenda 2.0). O switch Visão Geral|Calendário mora na barra compacta no
 * topo do conteúdo (vale nos dois modos). As ações (Novo/Compartilhar/Configurar)
 * viraram um FAB speed-dial flutuante no canto inferior direito — cada item com o
 * MESMO gate do botão antigo do header (Configurar=admin · Compartilhar=quem tem
 * agenda própria · Novo=qualquer membro).
 */
export function AgendaClient({
  resources, services, isAdmin, userId,
}: {
  resources: ResourceRow[]; services: ServiceRow[]; isAdmin: boolean; userId: string
}) {
  const [mode, setMode]           = useState<"overview" | "board">("overview")
  const [booking, setBooking]     = useState<BookingInitial | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const activeResources = useMemo(() => resources.filter((r) => r.active), [resources])
  const myResources = useMemo(() => activeResources.filter((r) => r.assigned_agent_id === userId), [activeResources, userId])

  const reload = () => setReloadKey((k) => k + 1)

  return (
    <div className="relative min-h-full bg-canvas">
      <div className="px-4 sm:px-6 py-4">
        {activeResources.length === 0 ? (
          <EmptyConfig isAdmin={isAdmin} />
        ) : mode === "overview" ? (
          <div className="space-y-3">
            <div className="flex"><ModeSwitch mode={mode} setMode={setMode} /></div>
            <AgendaOverview onSeeAll={() => setMode("board")} reloadSignal={reloadKey} />
          </div>
        ) : (
          // O switch FUNDE na barra do board como 1º item (leading).
          <AgendaBoard
            resources={activeResources} services={services} isAdmin={isAdmin} userId={userId}
            reloadSignal={reloadKey} onRequestBooking={setBooking}
            leading={<ModeSwitch mode={mode} setMode={setMode} />}
          />
        )}
      </div>

      {/* FAB speed-dial — só quando há agenda configurada (mesmo contexto do "Novo" antigo). */}
      {activeResources.length > 0 && (
        <AgendaSpeedDial
          canShare={myResources.length > 0}
          canConfig={isAdmin}
          canBlock={isAdmin || myResources.length > 0}
          onNew={() => setBooking({})}
          onShare={() => setShareOpen(true)}
          onBlock={() => setBlockOpen(true)}
        />
      )}

      {booking && (
        <BookingModal
          resources={activeResources}
          services={services}
          initial={booking}
          onClose={() => setBooking(null)}
          onCreated={() => { setBooking(null); reload() }}
        />
      )}

      {shareOpen && <ShareAgendaDialog resources={myResources} onClose={() => setShareOpen(false)} />}

      {blockOpen && (
        <BlockModal
          resources={activeResources}
          isAdmin={isAdmin}
          userId={userId}
          onClose={() => setBlockOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  )
}

// ── FAB speed-dial ───────────────────────────────────────────
// Círculo primary 56px com "+" que gira pra "×". Leque VERTICAL pra cima: o item
// mais próximo do FAB é o "Novo agendamento" (mais frequente, destaque primário).
// z-40: acima do board, ABAIXO de modais/DangerConfirm (z-50). Clique-fora/Esc fecha.
function AgendaSpeedDial({
  canShare, canConfig, canBlock, onNew, onShare, onBlock,
}: {
  canShare: boolean; canConfig: boolean; canBlock: boolean
  onNew: () => void; onShare: () => void; onBlock: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Ordem do mais próximo do FAB (Novo) pra fora. Gates idênticos ao header antigo.
  const items: { key: string; label: string; icon: LucideIcon; primary?: boolean; onClick: () => void }[] = [
    { key: "new", label: "Novo agendamento", icon: Plus, primary: true, onClick: () => { setOpen(false); onNew() } },
    ...(canBlock ? [{ key: "block", label: "Bloquear horário", icon: Lock, onClick: () => { setOpen(false); onBlock() } }] : []),
    ...(canShare ? [{ key: "share", label: "Compartilhar minha agenda", icon: Share2, onClick: () => { setOpen(false); onShare() } }] : []),
    ...(canConfig ? [{ key: "config", label: "Configurar", icon: Settings2, onClick: () => { setOpen(false); router.push("/agenda/configuracao") } }] : []),
  ]

  return (
    <>
      {open && (
        <button aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-30 cursor-default" />
      )}

      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2.5">
        {/* Leque (renderiza só aberto). DOM: topo→base = mais longe→mais perto do FAB. */}
        {open && items.slice().reverse().map((it) => {
          const dist = items.findIndex((x) => x.key === it.key)   // 0 = mais perto do FAB
          const Icon = it.icon
          return (
            <button
              key={it.key}
              type="button"
              onClick={it.onClick}
              style={{ animationDelay: `${dist * 45}ms`, animationFillMode: "backwards" }}
              className={`inline-flex items-center gap-2 h-10 pl-3.5 pr-4 rounded-full text-sm font-semibold shadow-lg transition-colors animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none ${
                it.primary
                  ? "bg-primary hover:bg-primary-700 text-white"
                  : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Icon className="size-4 shrink-0" /> {it.label}
            </button>
          )
        })}

        {/* FAB */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Fechar ações da agenda" : "Ações da agenda"}
          aria-expanded={open}
          className="size-14 rounded-full bg-primary hover:bg-primary-700 text-white grid place-items-center shadow-lg shadow-primary/25 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
        >
          <Plus className={`size-6 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-45" : ""}`} />
        </button>
      </div>
    </>
  )
}

// Switch de modo — reutilizado standalone (Visão Geral) e como 1º item da barra do board (Calendário).
function ModeSwitch({ mode, setMode }: { mode: "overview" | "board"; setMode: (m: "overview" | "board") => void }) {
  return (
    <div className="inline-flex items-center h-9 rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
      {([["overview", "Visão geral", LayoutGrid], ["board", "Calendário", CalendarRange]] as const).map(([m, label, Icon]) => (
        <button key={m} onClick={() => setMode(m)}
          className={`inline-flex items-center gap-1.5 h-full px-3 text-xs font-semibold rounded-md transition-colors ${mode === m ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"}`}>
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  )
}

function EmptyConfig({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="max-w-md mx-auto text-center py-24">
      <div className="size-12 rounded-xl bg-primary-50 grid place-items-center mx-auto mb-4"><CalendarDays className="size-6 text-primary-600" /></div>
      <h2 className="text-base font-semibold text-slate-900">Sua agenda está vazia</h2>
      <p className="text-sm text-slate-500 mt-1">
        {isAdmin ? "Crie uma agenda (de um profissional, uma sala, uma mesa…) pra começar a agendar." : "Peça a um administrador pra configurar as agendas."}
      </p>
      {isAdmin && <Link href="/agenda/configuracao" className="inline-block mt-4"><Button size="sm"><Settings2 className="size-4" /> Configurar agenda</Button></Link>}
    </div>
  )
}
