"use client"

import { useRouter } from "next/navigation"
import { Download, Receipt } from "lucide-react"
import { DataTable, type Column } from "@/components/ui/data-table"
import { SectionCard } from "@/components/ui/section-card"
import { brl, dataCheia, dataCurta } from "../format"
import type { Fatura, FaturaStatus } from "../types"

// ═══════════════════════════════════════════════════════════════
// B4 · Histórico de faturas
// ═══════════════════════════════════════════════════════════════
// DECISÃO: esta tela é DE PROPÓSITO a mais simples das quatro. Quem entra aqui
// tem uma tarefa só e ela é chata: achar o comprovante de um mês pro contador.
// Investir em gráfico de evolução de gasto seria bonito e inútil — e roubaria
// atenção das telas onde a decisão do cliente acontece. Lista, status, PDF.

const STATUS: Record<FaturaStatus, { label: string; cls: string }> = {
  paid:    { label: "Paga",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  open:    { label: "Em aberto",  cls: "bg-slate-100 text-slate-600 border-slate-200" },
  overdue: { label: "Vencida",    cls: "bg-red-50 text-red-700 border-red-200" },
  void:    { label: "Cancelada",  cls: "bg-slate-100 text-slate-400 border-slate-200" },
}

export function FaturasClient({ faturas }: { faturas: Fatura[] }) {
  const router = useRouter()

  const cols: Column<Fatura>[] = [
    {
      id: "ref", header: "Fatura", width: "minmax(180px,1.4fr)", mobile: true,
      cell: (f) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{f.referencia}</p>
          <p className="text-[11px] text-slate-400 tabular-nums">
            {dataCurta(f.periodoInicio)} a {dataCurta(f.periodoFim)}
          </p>
        </div>
      ),
    },
    {
      id: "venc", header: "Vencimento", width: "120px",
      cell: (f) => <span className="text-xs text-slate-500 tabular-nums">{dataCheia(f.vencimento)}</span>,
    },
    {
      id: "status", header: "Situação", width: "120px", mobile: true,
      cell: (f) => (
        <span className={`inline-flex text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${STATUS[f.status].cls}`}>
          {STATUS[f.status].label}
        </span>
      ),
    },
    {
      id: "total", header: "Valor", width: "120px", align: "right", mobile: true,
      cell: (f) => <span className="text-sm font-bold text-slate-900 tabular-nums">{brl(f.totalCents)}</span>,
    },
    {
      id: "acao", header: "", width: "140px", align: "right",
      cell: (f) => (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600">
          {f.status === "paid" ? <><Download className="size-3.5" /> Comprovante</> : <>Ver fatura</>}
        </span>
      ),
    },
  ]

  return (
    <SectionCard title="Faturas" description="Todas as cobranças da sua conta, da mais recente pra mais antiga" flush>
      <DataTable
        rows={faturas}
        columns={cols}
        rowKey={(f) => f.id}
        onRowClick={(f) => router.push(`/configuracoes/assinatura/faturas/${f.id}`)}
        empty={{
          icon: Receipt,
          title: "Nenhuma fatura ainda",
          description: "Sua primeira fatura aparece aqui no fechamento do primeiro ciclo.",
        }}
      />
    </SectionCard>
  )
}
