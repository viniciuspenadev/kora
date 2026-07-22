"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarDays, Megaphone, Headset, CreditCard, LayoutGrid,
  ArrowRight, Sparkles, type LucideIcon,
} from "lucide-react"
import {
  TEMPLATE_LIBRARY, KORA_CATEGORY_LABELS,
  type KoraCategory, type TemplateBlueprint,
} from "@/lib/templates/library"
import { EmptyState } from "@/components/ui/empty-state"

const CATEGORIES: KoraCategory[] = ["agenda", "atendimento", "marketing", "cobranca", "outro"]
const CAT_ICON: Record<KoraCategory, LucideIcon> = {
  agenda:      CalendarDays,
  atendimento: Headset,
  marketing:   Megaphone,
  cobranca:    CreditCard,
  outro:       LayoutGrid,
}

export function BibliotecaClient() {
  const router = useRouter()
  const [active, setActive] = useState<KoraCategory>("agenda")

  const countOf = (c: KoraCategory) => TEMPLATE_LIBRARY.filter((b) => b.koraCategory === c).length
  const items   = TEMPLATE_LIBRARY.filter((b) => b.koraCategory === active)
  const ActiveIcon = CAT_ICON[active]

  return (
    <div className="flex flex-col md:flex-row gap-5">
      {/* ── Nav de categorias (esquerda) ── */}
      <nav className="md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
        {CATEGORIES.map((c) => {
          const Icon = CAT_ICON[c]
          const n    = countOf(c)
          const on   = c === active
          return (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={`group flex items-center gap-2.5 rounded-xl px-2.5 h-11 text-sm font-medium transition-colors shrink-0
                ${on ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <span className={`grid place-items-center size-7 rounded-lg transition-colors
                ${on ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"}`}>
                <Icon className="size-4" strokeWidth={2} />
              </span>
              <span className="flex-1 text-left whitespace-nowrap">{KORA_CATEGORY_LABELS[c]}</span>
              {n > 0 && (
                <span className={`text-[11px] tabular-nums ${on ? "text-primary-600" : "text-slate-400"}`}>{n}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* ── Modelos da categoria (direita) ── */}
      <div className="flex-1 min-w-0">
        {items.length === 0 ? (
          <EmptyState
            icon={ActiveIcon}
            title="Novos modelos em breve"
            description={`Modelos de ${KORA_CATEGORY_LABELS[active]} estão a caminho. Por ora, explore os de Agenda.`}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {items.map((bp) => (
              <BlueprintCard key={bp.id} bp={bp} onUse={() => router.push(`/templates/novo?blueprint=${bp.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BlueprintCard({ bp, onUse }: { bp: TemplateBlueprint; onUse: () => void }) {
  // Pré-visualização: substitui {{n}} pelos exemplos → mostra como o cliente vai ver.
  const preview = bp.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => bp.bodyExamples[k] ?? `{{${k}}}`)

  return (
    <div className="group flex flex-col bg-white rounded-2xl border border-slate-200 hover:border-primary-200 hover:shadow-soft transition-all overflow-hidden">
      {/* Cabeçalho */}
      <div className="p-4 pb-3">
        <div className="flex items-start gap-2">
          <h3 className="text-sm font-semibold text-slate-800 flex-1 leading-snug">{bp.title}</h3>
          {bp.systemLocked && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-50 text-primary-700 border border-primary-100 shrink-0">
              <Sparkles className="size-2.5" /> Essencial
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{bp.description}</p>
      </div>

      {/* Mini-preview estilo WhatsApp */}
      <div className="px-4 pb-4 flex-1">
        <div className="rounded-2xl rounded-tl-md bg-[#e7ffdb]/40 border border-emerald-100/70 px-3 py-2.5">
          <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-snug">{preview}</p>
          {bp.buttons && bp.buttons.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-emerald-200/60 flex flex-col gap-1.5">
              {bp.buttons.map((b, i) => (
                <span key={i} className="text-center text-[13px] font-medium text-primary-600">{b.text}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rodapé / CTA */}
      <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400 truncate">
          {bp.buttons?.length ? `${bp.buttons.length} ${bp.buttons.length === 1 ? "botão" : "botões"}` : "Sem botões"} · {bp.language}
        </span>
        <button
          onClick={onUse}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors shrink-0"
        >
          Usar modelo <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
