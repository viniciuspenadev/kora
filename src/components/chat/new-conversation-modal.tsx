"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import { X, Search, Phone, User, Loader2, MessageCircle, RotateCcw } from "lucide-react"
import { searchContacts, createManualConversation } from "@/lib/actions/chat"
import { formatPhoneDisplay } from "@/lib/phone-utils"

interface ContactResult {
  id:           string
  phone_number: string
  push_name:    string | null
  custom_name?: string | null
  email?:       string | null
  company?:     string | null
  conversation_state?: "active" | "resolved" | null
}

interface Props {
  open:    boolean
  onClose: () => void
}

export function NewConversationModal({ open, onClose }: Props) {
  const router = useRouter()
  const [tab, setTab]                = useState<"search" | "phone">("search")
  const [search, setSearch]          = useState("")
  const [contacts, setContacts]      = useState<ContactResult[]>([])
  const [phone, setPhone]            = useState("")
  const [name, setName]              = useState("")
  const [searching, setSearching]    = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSearch("")
      setPhone("")
      setName("")
      setContacts([])
      setError(null)
      setTab("search")
    }
  }, [open])

  useEffect(() => {
    if (tab !== "search" || search.trim().length < 2) {
      setContacts([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await searchContacts(search)
        setContacts(r as ContactResult[])
      } catch (e) {
        console.error(e)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [search, tab])

  function handleCreate(input: { phone?: string; contactId?: string; pushName?: string }) {
    setError(null)
    startTransition(async () => {
      try {
        const r = await createManualConversation(input)
        // Sinaliza pro inbox-client se reusou ou reabriu (banner temporário lá)
        const params = new URLSearchParams({ conversation: r.id })
        if (r.reused)   params.set("reused", "1")
        if (r.reopened) params.set("reopened", "1")
        onClose()
        router.push(`/inbox?${params.toString()}`)
        router.refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-900">Nova conversa</h2>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          <button
            type="button"
            onClick={() => setTab("search")}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
              tab === "search" ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Search className="size-3.5 inline mr-1" />
            Buscar contato
          </button>
          <button
            type="button"
            onClick={() => setTab("phone")}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
              tab === "phone" ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Phone className="size-3.5 inline mr-1" />
            Novo telefone
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "search" ? (
            <div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nome ou telefone..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-primary-600 animate-spin" />
                )}
              </div>

              {search.length < 2 && (
                <p className="text-[11px] text-slate-400 text-center py-6">
                  Digite ao menos 2 caracteres para buscar contatos existentes.
                </p>
              )}

              {contacts.length > 0 && (
                <div className="space-y-1">
                  {contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={isPending}
                      onClick={() => handleCreate({ contactId: c.id })}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-left transition-colors disabled:opacity-50"
                    >
                      <div className="size-7 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <User className="size-3.5 text-primary-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-700 truncate">
                          {c.custom_name ?? c.push_name ?? formatPhoneDisplay(c.phone_number)}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {formatPhoneDisplay(c.phone_number)}
                        </p>
                      </div>
                      {c.conversation_state === "active" && (
                        <span
                          title="Esse contato já tem conversa ativa — vamos abrir ela"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 shrink-0"
                        >
                          <MessageCircle className="size-2.5" />
                          Em atendimento
                        </span>
                      )}
                      {c.conversation_state === "resolved" && (
                        <span
                          title="Esse contato já teve conversa — vamos reabrir ela"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 shrink-0"
                        >
                          <RotateCcw className="size-2.5" />
                          Reabrir
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {search.length >= 2 && !searching && contacts.length === 0 && (
                <p className="text-[11px] text-slate-400 text-center py-6">
                  Nada encontrado. Tente a aba <strong>Novo telefone</strong>.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Telefone com DDD <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="11999998888"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Apenas dígitos. DDI 55 (Brasil) é adicionado automaticamente.
                </p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Nome (opcional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Como salvar este contato"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
              </div>

              {error && (
                <p className="text-[11px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="button"
                disabled={isPending || phone.replace(/\D/g, "").length < 10}
                onClick={() => handleCreate({ phone, pushName: name || undefined })}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg transition-colors"
              >
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
                Iniciar conversa
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
