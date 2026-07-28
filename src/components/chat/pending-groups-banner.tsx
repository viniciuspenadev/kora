"use client"

import { useEffect, useState, useTransition } from "react"
import { Users, Check, X, ChevronDown } from "lucide-react"
import { listPendingGroups, decideGroup } from "@/lib/actions/chat"

interface PendingGroup {
  id:           string
  group_jid:    string
  group_name:   string | null
  member_count: number | null
  detected_at:  string
}

export function PendingGroupsBanner() {
  const [groups, setGroups]   = useState<PendingGroup[]>([])
  const [expanded, setExpanded] = useState(false)
  const [, startTransition]   = useTransition()
  const [busyId, setBusyId]   = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function tick() {
      try {
        const r = await listPendingGroups()
        if (active) setGroups(r as PendingGroup[])
      } catch { /* silent */ }
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => { active = false; clearInterval(id) }
  }, [])

  function decide(id: string, decision: "monitor" | "ignore") {
    setBusyId(id)
    startTransition(async () => {
      try {
        await decideGroup(id, decision)
        setGroups((prev) => prev.filter((g) => g.id !== id))
      } finally {
        setBusyId(null)
      }
    })
  }

  if (groups.length === 0) return null

  return (
    <div className="bg-amber-50 border-b border-amber-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-amber-100 transition-colors"
      >
        <Users className="size-4 text-amber-600 shrink-0" />
        <span className="text-xs font-semibold text-amber-900">
          {groups.length} grupo(s) aguardando sua decisão
        </span>
        <ChevronDown className={`size-3.5 text-amber-600 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="border-t border-amber-200 divide-y divide-amber-100">
          {groups.map((g) => (
            <div key={g.id} className="px-4 py-3 flex items-center gap-3 bg-white/50">
              <div className="size-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <Users className="size-4 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {g.group_name ?? <span className="italic text-slate-500">Grupo sem nome</span>}
                </p>
                <p className="text-[10px] text-slate-400 font-mono truncate">
                  {g.group_jid}
                </p>
              </div>
              <button
                type="button"
                onClick={() => decide(g.id, "monitor")}
                disabled={busyId === g.id}
                title="Monitorar este grupo"
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-md disabled:opacity-50"
              >
                <Check className="size-3" />
                Monitorar
              </button>
              <button
                type="button"
                onClick={() => decide(g.id, "ignore")}
                disabled={busyId === g.id}
                title="Ignorar este grupo permanentemente"
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-md disabled:opacity-50"
              >
                <X className="size-3" />
                Ignorar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
