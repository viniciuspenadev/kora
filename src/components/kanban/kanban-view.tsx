"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ChevronDown, Plus, Settings, ZoomIn, ZoomOut } from "lucide-react"
import { ConversationKanban, type GroupBy } from "@/components/kanban/conversation-kanban"

const ZOOM_MIN = 0.5
const ZOOM_MAX = 1.1
const ZOOM_KEY = "kora.kanban.zoom"

interface PipelineMini { id: string; name: string; color: string }
interface AgentMini    { id: string; full_name: string | null; department_id?: string | null }
interface DeptMini     { id: string; name: string; color: string }

interface Props {
  pipelines:       PipelineMini[]
  currentPipeline: PipelineMini
  convCount:       number
  isAdminOrOwner:  boolean
  isManager:       boolean
  // Dados do board (repassados direto pro ConversationKanban)
  stages:          Parameters<typeof ConversationKanban>[0]["stages"]
  conversations:   Parameters<typeof ConversationKanban>[0]["conversations"]
  agents:          AgentMini[]
  departments:     DeptMini[]
  tintColumns:     boolean
  showChannel:     boolean
  tenantId:        string
  supabaseToken:   string
}

/**
 * Casca do Kanban: header compacto de 1 linha (seletor de funil + contagem +
 * switcher de gestão + ações) que segura o estado `groupBy` e renderiza o board.
 * Funde título/breadcrumb/switcher numa barra só — recupera área útil pro board.
 */
export function KanbanView({
  pipelines, currentPipeline, convCount, isAdminOrOwner, isManager,
  stages, conversations, agents, departments, tintColumns, showChannel,
  tenantId, supabaseToken,
}: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>("stage")
  const [pipeOpen, setPipeOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const readOnly = groupBy !== "stage"

  // Zoom do board (encolhe colunas+cards proporcionalmente → cabe mais funil).
  // Persiste por atendente. Carrega no mount pra evitar mismatch de hidratação.
  useEffect(() => {
    const saved = parseFloat(localStorage.getItem(ZOOM_KEY) ?? "")
    if (saved >= ZOOM_MIN && saved <= ZOOM_MAX) setZoom(saved)
  }, [])
  function changeZoom(delta: number) {
    setZoom((z) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10))
      try { localStorage.setItem(ZOOM_KEY, String(next)) } catch {}
      return next
    })
  }

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-slate-50 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {/* Seletor de funil (dropdown com 2+; texto com 1) */}
          {pipelines.length > 1 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPipeOpen((v) => !v)}
                className="flex items-center gap-2 text-base font-bold text-slate-900 hover:bg-slate-50 rounded-lg px-2 py-1 -ml-2"
              >
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: currentPipeline.color }} />
                <span className="truncate max-w-[40vw]">{currentPipeline.name}</span>
                <ChevronDown className="size-4 text-slate-400 shrink-0" />
              </button>
              {pipeOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPipeOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg py-1 min-w-[200px] z-20">
                    {pipelines.map((p) => (
                      <Link
                        key={p.id}
                        href={`/kanban?pipeline=${p.id}`}
                        onClick={() => setPipeOpen(false)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${p.id === currentPipeline.id ? "text-slate-900 font-semibold" : "text-slate-600"}`}
                      >
                        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-2 text-base font-bold text-slate-900 min-w-0">
              <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: currentPipeline.color }} />
              <span className="truncate">{currentPipeline.name}</span>
            </span>
          )}

          <span className="text-xs text-slate-400 shrink-0">· {convCount} conversas</span>

          {isManager && (
            <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1 ml-1 shrink-0">
              {(["stage", "agent", "department"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setGroupBy(k)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${groupBy === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {k === "stage" ? "Funil" : k === "agent" ? "Atendente" : "Departamento"}
                </button>
              ))}
            </div>
          )}
          {readOnly && (
            <span className="text-[11px] text-slate-400 shrink-0 hidden lg:inline">somente leitura · clique no card pra transferir</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => changeZoom(-0.1)}
              disabled={zoom <= ZOOM_MIN}
              title="Diminuir zoom (cabe mais funil)"
              className="size-6 rounded inline-flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="text-[10px] font-semibold text-slate-500 tabular-nums w-8 text-center">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => changeZoom(0.1)}
              disabled={zoom >= ZOOM_MAX}
              title="Aumentar zoom"
              className="size-6 rounded inline-flex items-center justify-center text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>
          {isAdminOrOwner && pipelines.length === 1 && (
            <Link href="/kanban/configuracao" className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-primary-600 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors">
              <Plus className="size-3" /> Novo funil
            </Link>
          )}
          {isAdminOrOwner && (
            <Link href="/kanban/configuracao" title="Configurar funis" className="size-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors">
              <Settings className="size-4" />
            </Link>
          )}
        </div>
      </header>

      <div className="p-4 flex-1 min-h-0">
        {/* zoom encolhe colunas+cards proporcionalmente E reflui (cabe mais funil).
            height compensa o zoom: pré-zoom = 100/zoom% → escalado bate 100% (sem buraco). */}
        <div style={{ zoom, height: `${(100 / zoom).toFixed(3)}%` }}>
          <ConversationKanban
            stages={stages}
            conversations={conversations}
            tintColumns={tintColumns}
            showChannel={showChannel}
            groupBy={groupBy}
            agents={agents}
            departments={departments}
            tenantId={tenantId}
            supabaseToken={supabaseToken}
          />
        </div>
      </div>
    </div>
  )
}
