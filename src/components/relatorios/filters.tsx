"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import { Users, Globe, Smartphone, X, ChevronDown } from "lucide-react"
import { sourceMeta } from "@/lib/lifecycle"
import { SourceLogo } from "@/components/chat/source-logo"

interface Props {
  agents: { id: string; name: string }[]
  /** Lista de sources que aparecem nos dados do tenant — calculada server-side */
  availableChannels: string[]
  /** Números (instâncias) do tenant — o filtro só aparece com 2+. Opcional (Funil omite). */
  availableInstances?: { id: string; label: string }[]
}

const ALL_CHANNELS = ["whatsapp_inbound", "whatsapp_outbound", "manual", "import", "instagram", "webform"]

export function Filters({ agents, availableChannels, availableInstances = [] }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const agentId  = searchParams.get("agent")
  const channel  = searchParams.get("channel")
  const instance = searchParams.get("instance")

  const [agentOpen,    setAgentOpen]    = useState(false)
  const [channelOpen,  setChannelOpen]  = useState(false)
  const [instanceOpen, setInstanceOpen] = useState(false)
  const agentRef    = useRef<HTMLDivElement>(null)
  const channelRef  = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) setAgentOpen(false)
      if (channelRef.current && !channelRef.current.contains(e.target as Node)) setChannelOpen(false)
      if (instanceRef.current && !instanceRef.current.contains(e.target as Node)) setInstanceOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === null) params.delete(key)
    else params.set(key, value)
    router.push(`${pathname}?${params.toString()}`)
  }

  const activeAgent    = agents.find((a) => a.id === agentId)
  const activeChannel  = channel ? sourceMeta(channel) : null
  const activeInstance = availableInstances.find((i) => i.id === instance)
  const channelOptions = ALL_CHANNELS.filter((c) => availableChannels.includes(c))

  return (
    <div className="flex items-center gap-2">
      {/* Filtro atendente */}
      <div className="relative" ref={agentRef}>
        <button
          type="button"
          onClick={() => setAgentOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            activeAgent
              ? "bg-primary-50 text-primary-700 border-primary-200"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Users className="size-3.5" />
          {activeAgent ? activeAgent.name : "Atendente"}
          {activeAgent && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setParam("agent", null) }}
              className="ml-1 hover:text-primary-900"
            >
              <X className="size-3" />
            </button>
          )}
          {!activeAgent && <ChevronDown className="size-3.5" />}
        </button>
        {agentOpen && (
          <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-56 max-h-72 overflow-y-auto">
            <button
              type="button"
              onClick={() => { setParam("agent", null); setAgentOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 text-slate-500"
            >
              Todos
            </button>
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setParam("agent", a.id); setAgentOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 ${
                  agentId === a.id ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filtro canal */}
      <div className="relative" ref={channelRef}>
        <button
          type="button"
          onClick={() => setChannelOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            activeChannel
              ? "bg-primary-50 text-primary-700 border-primary-200"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          <Globe className="size-3.5" />
          {activeChannel ? activeChannel.label : "Canal"}
          {activeChannel && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setParam("channel", null) }}
              className="ml-1 hover:text-primary-900"
            >
              <X className="size-3" />
            </button>
          )}
          {!activeChannel && <ChevronDown className="size-3.5" />}
        </button>
        {channelOpen && (
          <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-56">
            <button
              type="button"
              onClick={() => { setParam("channel", null); setChannelOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 text-slate-500"
            >
              Todos
            </button>
            {channelOptions.map((c) => {
              const meta = sourceMeta(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setParam("channel", c); setChannelOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 inline-flex items-center gap-2 ${
                    channel === c ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"
                  }`}
                >
                  <SourceLogo source={c} size={13} />
                  {meta.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Filtro número — só com 2+ números (senão não há o que filtrar) */}
      {availableInstances.length > 1 && (
        <div className="relative" ref={instanceRef}>
          <button
            type="button"
            onClick={() => setInstanceOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeInstance
                ? "bg-primary-50 text-primary-700 border-primary-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Smartphone className="size-3.5" />
            {activeInstance ? activeInstance.label : "Número"}
            {activeInstance && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setParam("instance", null) }}
                className="ml-1 hover:text-primary-900"
              >
                <X className="size-3" />
              </button>
            )}
            {!activeInstance && <ChevronDown className="size-3.5" />}
          </button>
          {instanceOpen && (
            <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg p-1 z-50 w-56 max-h-72 overflow-y-auto">
              <button
                type="button"
                onClick={() => { setParam("instance", null); setInstanceOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 text-slate-500"
              >
                Todos
              </button>
              {availableInstances.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => { setParam("instance", i.id); setInstanceOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs rounded-lg hover:bg-slate-50 ${
                    instance === i.id ? "bg-primary-50 text-primary-700 font-medium" : "text-slate-700"
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
