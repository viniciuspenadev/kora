"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DataTable, type Column } from "@/components/ui/data-table"
import { SectionCard } from "@/components/ui/section-card"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { lifecycleMeta } from "@/lib/lifecycle"
import { Megaphone, ExternalLink, BarChart3, List, Trophy } from "lucide-react"
import { PlatformBadge } from "@/components/ui/platform-icon"
import type { AdConversationRow, AdAggregateRow } from "@/lib/actions/ads"

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open:     { label: "Aberta",    cls: "bg-primary-50 text-primary-700" },
  pending:  { label: "Pendente",  cls: "bg-amber-50  text-amber-700"  },
  resolved: { label: "Resolvida", cls: "bg-green-50  text-green-700"  },
  snoozed:  { label: "Adiada",    cls: "bg-slate-100 text-slate-600"  },
}

export function AdsTables({
  byAd, byContact,
}: {
  byAd:      AdAggregateRow[]
  byContact: AdConversationRow[]
}) {
  const router = useRouter()
  const [view, setView] = useState<"by_ad" | "by_contact">("by_ad")

  // ── Columns: Por anúncio ──────────────────────────────────
  const adColumns: Column<AdAggregateRow>[] = [
    {
      id: "ad", header: "Anúncio", width: "minmax(260px, 1.5fr)",
      cell: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          {row.thumbnailUrl ? (
            <img src={row.thumbnailUrl} alt="" className="size-10 rounded object-cover shrink-0 border border-slate-200"
                 onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
          ) : (
            <div className="size-10 rounded bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
              <Megaphone className="size-4 text-slate-400" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900 truncate">{row.title ?? "(sem título)"}</p>
            <p className="text-[11px] text-slate-400 font-mono truncate">{row.sourceId}</p>
          </div>
        </div>
      ),
    },
    {
      id: "platform", header: "Plataforma", width: "120px",
      cell: (row) => <PlatformBadge app={row.sourceApp} />,
    },
    {
      id: "leads", header: "Leads", width: "80px", align: "right",
      cell: (row) => (
        <span className="text-sm font-bold text-slate-900 tabular-nums">{row.leads}</span>
      ),
    },
    {
      id: "won", header: "Ganhos", width: "80px", align: "right",
      cell: (row) => (
        <span className="text-sm font-bold text-emerald-700 tabular-nums">{row.won}</span>
      ),
    },
    {
      id: "active", header: "Em aberto", width: "90px", align: "right",
      cell: (row) => (
        <span className="text-sm text-slate-600 tabular-nums">{row.active}</span>
      ),
    },
    {
      id: "conv", header: "Conversão", width: "100px", align: "right",
      cell: (row) => {
        const v = row.conversionPct
        const cls = v >= 30 ? "text-emerald-700" : v >= 10 ? "text-slate-600" : "text-slate-400"
        return <span className={`text-sm font-bold tabular-nums ${cls}`}>{v}%</span>
      },
    },
    {
      id: "link", header: "", width: "60px", align: "right",
      cell: (row) => (
        row.sourceUrl
          ? <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
               className="text-primary-600 hover:text-primary-700"><ExternalLink className="size-3.5" /></a>
          : null
      ),
    },
  ]

  // ── Columns: Por contato (drill-down) ─────────────────────
  const contactColumns: Column<AdConversationRow>[] = [
    {
      id: "contact", header: "Contato", width: "minmax(180px, 1fr)",
      cell: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          {row.contactPicture ? (
            <img src={row.contactPicture} alt="" className="size-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="size-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary-700">{(row.contactName ?? "?")[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{row.contactName ?? formatPhoneDisplay(row.contactPhone ?? "")}</p>
            <p className="text-[11px] text-slate-400 truncate font-mono">{formatPhoneDisplay(row.contactPhone ?? "")}</p>
          </div>
        </div>
      ),
    },
    {
      id: "ad", header: "Anúncio", width: "minmax(200px, 1.2fr)",
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          {row.adThumbnail && (
            <img src={row.adThumbnail} alt="" className="size-8 rounded object-cover shrink-0 border border-slate-200"
                 onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
          )}
          <div className="min-w-0">
            <p className="text-sm text-slate-900 truncate" title={row.adTitle ?? ""}>{row.adTitle ?? "—"}</p>
            <PlatformBadge app={row.adSourceApp} />
          </div>
        </div>
      ),
    },
    {
      id: "status", header: "Status", width: "100px",
      cell: (row) => {
        const s = STATUS_LABEL[row.status] ?? { label: row.status, cls: "bg-slate-100 text-slate-600" }
        return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
      },
    },
    {
      id: "lifecycle", header: "Estágio", width: "110px",
      cell: (row) => {
        if (!row.lifecycle) return <span className="text-slate-400 text-xs">—</span>
        const lc = lifecycleMeta(row.lifecycle as Parameters<typeof lifecycleMeta>[0])
        return (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${lc.bg} ${lc.text}`}>
            {lc.icon} {lc.label}
          </span>
        )
      },
    },
    {
      id: "agent", header: "Atendente", width: "130px",
      cell: (row) => (
        <span className="text-sm text-slate-600 truncate">{row.assignedAgent ?? <span className="text-slate-400">—</span>}</span>
      ),
    },
    {
      id: "date", header: "Recebida", width: "110px", align: "right",
      cell: (row) => (
        <span className="text-xs text-slate-500 tabular-nums">
          {row.firstMessageAt
            ? new Date(row.firstMessageAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" })
            : "—"}
        </span>
      ),
    },
  ]

  return (
    <SectionCard flush>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setView("by_ad")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === "by_ad" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <BarChart3 className="size-3.5" />
            Por anúncio ({byAd.length})
          </button>
          <button
            type="button"
            onClick={() => setView("by_contact")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              view === "by_contact" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <List className="size-3.5" />
            Por contato ({byContact.length})
          </button>
        </div>
        <p className="text-[11px] text-slate-400 hidden md:block">
          {view === "by_ad" ? "Ranking de criativos por leads e taxa de conversão" : "Cada contato vindo de anúncio no período"}
        </p>
      </div>

      {view === "by_ad" ? (
        <DataTable
          rows={byAd}
          columns={adColumns}
          rowKey={(r) => r.sourceId}
          onRowClick={(row) => {
            if (row.sourceUrl) window.open(row.sourceUrl, "_blank", "noopener,noreferrer")
          }}
          empty={{
            icon: Trophy,
            title: "Nenhum anúncio no período",
            description: "Ajuste o período no topo da página ou aguarde leads novos chegarem.",
          }}
        />
      ) : (
        <DataTable
          rows={byContact}
          columns={contactColumns}
          rowKey={(r) => r.conversationId}
          onRowClick={(row) => router.push(`/inbox?conversation=${row.conversationId}`)}
          empty={{
            icon: Megaphone,
            title: "Nenhum contato de anúncio no período",
            description: "Quando um cliente clicar em \"Enviar mensagem\" num anúncio, ele aparece aqui.",
          }}
        />
      )}
    </SectionCard>
  )
}
