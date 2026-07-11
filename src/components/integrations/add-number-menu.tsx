"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { Plus, BadgeCheck, QrCode, Lock } from "lucide-react"

/** Estado de um tipo de canal pro chooser. */
interface TypeState {
  enabled: boolean   // canal habilitado pro tenant (módulo/instância existe; QR não escondido)
  atLimit: boolean   // limite do plano atingido pra esse tipo
  usage:   string    // "1/1"
}

/**
 * Chooser "+ Adicionar número" — abre um menu com os tipos de conexão (Oficial via
 * Embedded Signup · QR via Baileys). É o "menu separando API vs Baileys". Cada opção
 * é gated por canal habilitado E pelo limite do plano (fail-closed no server; aqui só UX).
 */
export function AddNumberMenu({ official, qr }: { official: TypeState; qr: TypeState }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
      >
        <Plus className="size-4" /> Adicionar número
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white shadow-soft p-1.5 z-20">
          {official.enabled && (
            <Option
              state={official}
              href="/integracoes/whatsapp-oficial?new=1"
              icon={BadgeCheck}
              iconClass="bg-primary-50 text-primary-700"
              title="Número Oficial (Meta)"
              desc="API Cloud — templates, escala e confiabilidade."
            />
          )}
          {qr.enabled && (
            <Option
              state={qr}
              href="/configuracoes/whatsapp"
              icon={QrCode}
              iconClass="bg-slate-100 text-slate-500"
              title="Número via QR (Baileys)"
              desc="Conexão rápida lendo um QR Code."
            />
          )}
          {!official.enabled && !qr.enabled && (
            <p className="px-3 py-2.5 text-[11px] text-slate-400">Nenhum tipo de conexão disponível para sua conta.</p>
          )}
        </div>
      )}
    </div>
  )
}

function Option({ state, href, icon: Icon, iconClass, title, desc }: {
  state: TypeState; href: string; icon: typeof BadgeCheck; iconClass: string; title: string; desc: string
}) {
  if (state.atLimit) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg px-3 py-2.5 opacity-60 cursor-not-allowed"
        title="Limite do plano atingido — fale com o suporte para aumentar."
      >
        <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}><Icon className="size-4" /></div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-900">{title}</p>
          <p className="text-[11px] text-amber-700 leading-snug mt-0.5 inline-flex items-center gap-1">
            <Lock className="size-3 shrink-0" /> Limite do plano atingido · {state.usage}
          </p>
        </div>
      </div>
    )
  }
  return (
    <Link href={href} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50 transition-colors">
      <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}><Icon className="size-4" /></div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-900">{title}</p>
        <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{desc}</p>
      </div>
    </Link>
  )
}
