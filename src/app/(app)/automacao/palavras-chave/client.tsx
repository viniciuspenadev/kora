"use client"

import { useState, useTransition } from "react"
import {
  Wand2, Plus, Pencil, Trash2, ArrowUp, ArrowDown,
  CheckCircle2, AlertCircle,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { DataTable, type Column } from "@/components/ui/data-table"
import { StatusDot } from "@/components/ui/status-dot"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  toggleKeywordTrigger,
  deleteKeywordTrigger,
  reorderKeywordTriggers,
} from "@/lib/actions/keyword-triggers"
import { TriggerSheet } from "./trigger-sheet"

export type MatchType = "exact" | "contains" | "starts_with"

export interface TagOption {
  id:    string
  name:  string
  color: string
}

export interface TriggerRow {
  id:                  string
  name:                string
  patterns:            string[]
  match_type:          MatchType
  case_sensitive:      boolean
  response_text:       string | null
  apply_tag_id:        string | null
  apply_tag:           TagOption | null
  cooldown_min:        number
  enabled:             boolean
  position:            number
  pause_when_assigned: boolean
}

interface Props {
  rows: TriggerRow[]
  tags: TagOption[]
}

const MATCH_LABEL: Record<MatchType, string> = {
  exact:       "Idêntica",
  contains:    "Contém",
  starts_with: "Começa com",
}

export function KeywordsClient({ rows, tags }: Props) {
  const [editing, setEditing]   = useState<TriggerRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const columns: Column<TriggerRow>[] = [
    {
      id: "status",
      header: "Status",
      width: "44px",
      mobile: true,
      cell: (r) => (
        <ToggleEnabled
          row={r}
          onFeedback={flash}
        />
      ),
    },
    {
      id: "name",
      header: "Gatilho",
      width: "minmax(220px, 1.5fr)",
      mobile: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{r.name}</p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {r.patterns.slice(0, 3).map((p) => (
              <span key={p} className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                {p}
              </span>
            ))}
            {r.patterns.length > 3 && (
              <span className="text-[10px] text-slate-400">+{r.patterns.length - 3}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "match",
      header: "Tipo",
      width: "120px",
      cell: (r) => (
        <span className="text-xs text-slate-600">{MATCH_LABEL[r.match_type]}</span>
      ),
    },
    {
      id: "actions",
      header: "Ações",
      width: "minmax(180px, 1fr)",
      cell: (r) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          {r.response_text && (
            <span className="inline-flex items-center text-[10px] font-semibold text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">
              Responde
            </span>
          )}
          {r.apply_tag && (
            <span
              className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: r.apply_tag.color + "20", color: r.apply_tag.color }}
            >
              {r.apply_tag.name}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "cooldown",
      header: "Cooldown",
      width: "100px",
      cell: (r) => (
        <span className="text-xs text-slate-500 tabular-nums">
          {r.cooldown_min === 0 ? "—" : `${r.cooldown_min}min`}
        </span>
      ),
    },
    {
      id: "reorder",
      header: "Ordem",
      width: "120px",
      cell: (r) => <ReorderControls row={r} allRows={rows} onFeedback={flash} />,
    },
    {
      id: "edit",
      header: "",
      width: "80px",
      align: "right",
      cell: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button
            type="button"
            onClick={() => setEditing(r)}
            className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            title="Editar"
          >
            <Pencil className="size-3.5" />
          </button>
          <DeleteButton row={r} onFeedback={flash} />
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          {rows.length === 0
            ? "Sem gatilhos ainda. Crie o primeiro abaixo."
            : `${rows.length} ${rows.length === 1 ? "gatilho" : "gatilhos"} configurados. Ordem importa — o primeiro que bater é o que dispara.`}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0"
        >
          <Plus className="size-3.5" />
          Novo gatilho
        </button>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-100 text-success"
            : "bg-danger-bg border border-red-100 text-danger"
        }`}>
          {feedback.kind === "ok"
            ? <CheckCircle2 className="size-3.5" />
            : <AlertCircle  className="size-3.5" />}
          {feedback.text}
        </div>
      )}

      {rows.length === 0 && !creating ? (
        <EmptyState
          icon={Wand2}
          title="Crie seu primeiro gatilho"
          description={"Exemplos: \"preço\" → manda tabela; \"horário\" → manda horário de atendimento; \"falar com humano\" → aplica tag de urgência."}
        />
      ) : (
        <SectionCard flush>
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            empty={{
              icon: Wand2,
              title: "Sem gatilhos",
              description: "Adicione o primeiro pelo botão acima.",
            }}
          />
        </SectionCard>
      )}

      {(creating || editing) && (
        <TriggerSheet
          trigger={editing}
          tags={tags}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onFeedback={flash}
        />
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

function ToggleEnabled({
  row, onFeedback,
}: {
  row:        TriggerRow
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [enabled, setEnabled]      = useState(row.enabled)

  function handleToggle() {
    const next = !enabled
    setEnabled(next)
    startTransition(async () => {
      const result = await toggleKeywordTrigger(row.id, next)
      if ("error" in result && result.error) {
        setEnabled(!next)
        onFeedback("error", result.error)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-label={enabled ? "Desativar" : "Ativar"}
      className="inline-flex items-center"
    >
      <StatusDot tone={enabled ? "success" : "neutral"} />
    </button>
  )
}

function ReorderControls({
  row, allRows, onFeedback,
}: {
  row:        TriggerRow
  allRows:    TriggerRow[]
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const sorted   = [...allRows].sort((a, b) => a.position - b.position)
  const idx      = sorted.findIndex((r) => r.id === row.id)
  const canUp    = idx > 0
  const canDown  = idx < sorted.length - 1

  function move(direction: "up" | "down") {
    if (direction === "up" && !canUp) return
    if (direction === "down" && !canDown) return

    const newOrder = [...sorted]
    const swap     = direction === "up" ? idx - 1 : idx + 1
    ;[newOrder[idx], newOrder[swap]] = [newOrder[swap], newOrder[idx]]

    startTransition(async () => {
      const result = await reorderKeywordTriggers(newOrder.map((r) => r.id))
      if ("error" in result && result.error) onFeedback("error", result.error)
    })
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => move("up")}
        disabled={!canUp || pending}
        className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Subir prioridade"
      >
        <ArrowUp className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => move("down")}
        disabled={!canDown || pending}
        className="size-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label="Descer prioridade"
      >
        <ArrowDown className="size-3" />
      </button>
      <span className="text-[10px] text-slate-400 font-mono ml-1 tabular-nums">{idx + 1}</span>
    </div>
  )
}

function DeleteButton({
  row, onFeedback,
}: {
  row:        TriggerRow
  onFeedback: (kind: "ok" | "error", text: string) => void
}) {
  const [confirm, setConfirm] = useState(false)

  async function handleDelete() {
    const result = await deleteKeywordTrigger(row.id)
    if ("error" in result && result.error) onFeedback("error", result.error)
    else onFeedback("ok", `Gatilho "${row.name}" excluído`)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="size-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors"
        title="Excluir"
      >
        <Trash2 className="size-3.5" />
      </button>
      <DangerConfirm
        open={confirm}
        title={`Excluir "${row.name}"?`}
        body={<>O histórico de disparos também será removido. Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}

