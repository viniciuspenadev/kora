"use client"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import {
  Search, Filter, Inbox, Tag as TagIcon, Plus, Ban, Phone, MessageCircle, Loader2, Check,
  Mail, Building2, Pencil,
} from "lucide-react"
import { createTag, applyTag, removeTag } from "@/lib/actions/tags"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { ContactEditSheet } from "./contact-edit-sheet"

interface Contact {
  id:              string
  whatsapp_id:     string
  phone_number:    string
  push_name:       string | null
  custom_name:     string | null
  email:           string | null
  company:         string | null
  doc_id:          string | null
  birth_date:      string | null
  profile_pic_url: string | null
  is_blocked:      boolean
  notes:           string | null
  source:          string | null
  lifecycle_stage: string | null
  created_at:      string
  updated_at:      string
  tag_ids:         string[]
}

interface Tag {
  id:          string
  name:        string
  color:       string
  description: string | null
}

interface Stats {
  total:    number
  blocked:  number
  withTags: number
}

interface Props {
  contacts: Contact[]
  tags:     Tag[]
  stats:    Stats
}

const inputBase = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"

const TAG_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

function formatPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "")
  if (clean.length === 13) {
    return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  }
  return phone
}

export function ContatosList({ contacts: initialContacts, tags: initialTags, stats }: Props) {
  const [contacts, setContacts] = useState(initialContacts)
  const [tags, setTags]         = useState(initialTags)
  const [search, setSearch]     = useState("")
  const [filter, setFilter]     = useState<"all" | "blocked" | "with_tags" | "with_email" | "with_company" | "no_custom_name">("all")
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [editing, setEditing]   = useState<Contact | null>(null)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (filter === "blocked"        && !c.is_blocked) return false
      if (filter === "with_tags"      && c.tag_ids.length === 0) return false
      if (filter === "with_email"     && !c.email) return false
      if (filter === "with_company"   && !c.company) return false
      if (filter === "no_custom_name" && c.custom_name) return false

      if (selectedTags.size > 0) {
        for (const tId of selectedTags) {
          if (!c.tag_ids.includes(tId)) return false
        }
      }

      if (!q) return true
      return (
        c.custom_name?.toLowerCase().includes(q) ||
        c.push_name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.phone_number.includes(q)
      )
    })
  }, [contacts, search, filter, selectedTags])

  function toggleTagFilter(id: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleTagApplied(contactId: string, tagId: string) {
    setContacts((prev) => prev.map((c) =>
      c.id === contactId ? { ...c, tag_ids: [...c.tag_ids, tagId] } : c
    ))
  }
  function handleTagRemoved(contactId: string, tagId: string) {
    setContacts((prev) => prev.map((c) =>
      c.id === contactId ? { ...c, tag_ids: c.tag_ids.filter((t) => t !== tagId) } : c
    ))
  }
  function handleTagCreated(tag: Tag) {
    setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))
  }

  // Contagens dinâmicas pros filtros novos (cheap pra <500 contatos)
  const withEmailCount     = contacts.filter((c) => !!c.email).length
  const withCompanyCount   = contacts.filter((c) => !!c.company).length
  const noCustomNameCount  = contacts.filter((c) => !c.custom_name).length

  const filterTabs = [
    { value: "all",            label: "Todos",          count: stats.total },
    { value: "with_tags",      label: "Com tags",       count: stats.withTags },
    { value: "with_email",     label: "Com email",      count: withEmailCount },
    { value: "with_company",   label: "Com empresa",    count: withCompanyCount },
    { value: "no_custom_name", label: "Sem nome editado", count: noCustomNameCount },
    { value: "blocked",        label: "Bloqueados",     count: stats.blocked },
  ]

  return (
    <div className="space-y-4">

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <div className="p-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome, telefone, email, empresa..."
              className={`${inputBase} pl-9`}
            />
          </div>
          <TagManagerButton tags={tags} onTagCreated={handleTagCreated} />
        </div>

        <div className="flex items-center gap-1 px-4 py-2 border-t border-slate-100 overflow-x-auto">
          {filterTabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value as typeof filter)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === t.value
                  ? "bg-primary-50 text-primary-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filter === t.value ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-500"}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 py-2 border-t border-slate-100 overflow-x-auto">
            <Filter className="size-3 text-slate-400 shrink-0" />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider shrink-0 mr-1">Tags:</span>
            {tags.map((t) => {
              const active = selectedTags.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTagFilter(t.id)}
                  className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all ${
                    active
                      ? "ring-2 ring-offset-1 ring-primary shadow-sm"
                      : "opacity-60 hover:opacity-100"
                  }`}
                  style={{
                    backgroundColor: t.color + "20",
                    color: t.color,
                    border: `1px solid ${t.color}40`,
                  }}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </button>
              )
            })}
            {selectedTags.size > 0 && (
              <button
                onClick={() => setSelectedTags(new Set())}
                className="shrink-0 text-[10px] text-slate-400 hover:text-red-500 ml-1"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="size-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-900 mb-1">Nenhum contato</p>
            <p className="text-xs text-slate-400">
              {search || filter !== "all" || selectedTags.size > 0
                ? "Ajuste filtros para ver outros contatos."
                : "Contatos aparecem aqui após receber a primeira mensagem no WhatsApp."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <ContactRow
                key={c.id}
                contact={c}
                allTags={tags}
                onTagApplied={handleTagApplied}
                onTagRemoved={handleTagRemoved}
                onEdit={() => setEditing(c)}
              />
            ))}
          </div>
        )}
      </div>

      {feedback && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-lg shadow-soft text-xs ${
          feedback.kind === "ok"
            ? "bg-success-bg border border-emerald-200 text-success"
            : "bg-danger-bg border border-red-200 text-danger"
        }`}>
          {feedback.text}
        </div>
      )}

      {editing && (
        <ContactEditSheet
          contact={editing}
          onClose={() => setEditing(null)}
          onFeedback={(k, t) => {
            flash(k, t)
            // Atualiza local pra refletir mudança sem precisar router.refresh()
            if (k === "ok") {
              // Re-fetch é caro; só limpa o estado e a próxima navegação pega os dados frescos
              // (revalidatePath já marca o cache pra invalidar)
            }
          }}
        />
      )}
    </div>
  )
}

function ContactRow({
  contact, allTags, onTagApplied, onTagRemoved, onEdit,
}: {
  contact:      Contact
  allTags:      Tag[]
  onTagApplied: (cId: string, tId: string) => void
  onTagRemoved: (cId: string, tId: string) => void
  onEdit:       () => void
}) {
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [pending, startTransition] = useTransition()

  const name        = displayContactName(contact)
  const initial     = displayContactInitial(contact)
  const contactTags = allTags.filter((t) => contact.tag_ids.includes(t.id))
  const lc          = lifecycleMeta(contact.lifecycle_stage)

  function handleToggleTag(tagId: string, currentlyApplied: boolean) {
    startTransition(async () => {
      try {
        if (currentlyApplied) {
          await removeTag(tagId, "contact", contact.id)
          onTagRemoved(contact.id, tagId)
        } else {
          await applyTag(tagId, "contact", contact.id)
          onTagApplied(contact.id, tagId)
        }
      } catch (err) {
        alert((err as Error).message)
      }
    })
  }

  return (
    <div className="group flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
      <div className="size-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
        {contact.profile_pic_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={contact.profile_pic_url} alt={name} className="size-10 object-cover" />
        ) : (
          <span className="text-sm font-bold text-slate-500">{initial}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
          {contact.is_blocked && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
              <Ban className="size-2.5" /> Bloqueado
            </span>
          )}
          <span
            className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text}`}
            title={lc.label}
          >
            {lc.icon} {lc.label}
          </span>
          {contactTags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: t.color + "20",
                color: t.color,
                border: `1px solid ${t.color}30`,
              }}
            >
              <span className="size-1 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Phone className="size-2.5" /> {formatPhone(contact.phone_number)}
          </span>
          {contact.email && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Mail className="size-2.5" /> {contact.email}
            </span>
          )}
          {contact.company && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Building2 className="size-2.5" /> {contact.company}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          title="Editar contato"
          className="size-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
        >
          <Pencil className="size-3.5" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowTagPicker((v) => !v)}
            title="Gerenciar tags"
            className="size-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <TagIcon className="size-3.5" />
          </button>

          {showTagPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowTagPicker(false)} />
              <div className="absolute top-full right-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-72 overflow-y-auto">
                <div className="p-2 border-b border-slate-100">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2">Tags</p>
                </div>
                {allTags.length === 0 ? (
                  <p className="text-xs text-slate-400 p-3 text-center">Nenhuma tag criada.</p>
                ) : (
                  <ul className="py-1">
                    {allTags.map((t) => {
                      const applied = contact.tag_ids.includes(t.id)
                      return (
                        <li key={t.id}>
                          <button
                            disabled={pending}
                            onClick={() => handleToggleTag(t.id, applied)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 transition-colors disabled:opacity-50"
                          >
                            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                            <span className="flex-1 truncate text-slate-700">{t.name}</span>
                            {applied && <Check className="size-3 text-primary-600" />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <Link
          href={`/inbox?contact=${contact.id}`}
          title="Abrir no inbox"
          className="size-8 rounded-lg text-slate-400 hover:text-primary-700 hover:bg-primary-50 flex items-center justify-center transition-colors"
        >
          <MessageCircle className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

function TagManagerButton({ tags, onTagCreated }: { tags: Tag[]; onTagCreated: (t: Tag) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState(TAG_COLORS[0])
  const [pending, startTransition] = useTransition()

  function handleCreate() {
    if (!name.trim()) return
    startTransition(async () => {
      try {
        const created = await createTag(name, color)
        if (created) onTagCreated({ id: created.id, name: name.trim(), color, description: null })
        setName("")
      } catch (err) {
        alert((err as Error).message)
      }
    })
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
      >
        <TagIcon className="size-3.5" /> Tags <span className="text-slate-400">({tags.length})</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-3 space-y-3">
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Nova tag</p>
              <input
                type="text"
                placeholder="Nome da tag..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputBase}
                maxLength={40}
              />
              <div className="flex items-center gap-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`size-6 rounded-full transition-transform ${color === c ? "ring-2 ring-offset-1 ring-slate-400 scale-110" : "hover:scale-110"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button
                disabled={pending || !name.trim()}
                onClick={handleCreate}
                className="w-full h-8 rounded-lg text-xs font-semibold bg-primary hover:bg-primary-700 text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {pending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                Criar tag
              </button>
            </div>

            {tags.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Existentes</p>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{
                        backgroundColor: t.color + "20",
                        color: t.color,
                        border: `1px solid ${t.color}30`,
                      }}
                    >
                      <span className="size-1 rounded-full" style={{ backgroundColor: t.color }} />
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
