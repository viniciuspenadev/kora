"use client"

import { ContactPic } from "@/components/chat/contact-pic"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import {
  Search, Filter, Inbox, Tag as TagIcon, Plus, Ban, Phone, MessageCircle, Loader2, Check,
  Pencil, X, MoreHorizontal, ExternalLink, ListChecks,
} from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { createTag, applyTag, removeTag, applyTagToContacts } from "@/lib/actions/tags"
import { addContactsToList } from "@/lib/actions/lists"
import { matchesSegment, type SegmentRules } from "@/lib/crm/segment-rules"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { ContactEditSheet } from "./contact-edit-sheet"
import { SourceLogo } from "@/components/chat/source-logo"
import { ContactSheet } from "@/components/crm/contact-sheet"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"

// Canal (contact_identities) → fonte do logo de marca.
const CHANNEL_SOURCE: Record<string, string> = { whatsapp: "whatsapp_inbound", instagram: "instagram", site: "webform" }

interface Contact {
  id:              string
  whatsapp_id:     string | null
  phone_number:    string | null   // contato pode existir sem telefone (BSUID-only / sem-WhatsApp)
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
  channels:        string[]   // canais que o contato tem no cadastro (whatsapp/instagram/site)
  /** Dados comerciais (negócios GANHOS) — null sem compras / sem módulo crm. */
  commerce:        { total: number; compras: number; ciclo: number | null; ultimaDias: number | null; ticket: number | null } | null
  /** Listas (segmentos salvos) que o contato integra. */
  list_ids:        string[]
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
  /** Listas (segmentos salvos) — bulk "Adicionar à lista" (estáticas) e filtro ?list=. */
  lists:    { id: string; name: string; kind: "static" | "dynamic"; rules: SegmentRules | null }[]
  stats:    Stats
  /** Módulo crm ligado → mostra os dados comerciais (roster) e o Contato 360. */
  crmEnabled?: boolean
}

const inputBase = "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"

const TAG_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
]

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ""
  const clean = phone.replace(/\D/g, "")
  if (clean.length === 13) {
    return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  }
  return phone
}

export function ContatosList({ contacts: initialContacts, tags: initialTags, lists, stats, crmEnabled = false }: Props) {
  // Deep-link de SEGMENTO: /contatos?tag=<id> ou ?list=<id> chega com o público
  // já filtrado (contagens clicáveis em Configurações → Tags/Listas).
  const params  = useSearchParams()
  const urlTag  = params.get("tag")
  const urlList = params.get("list")
  const [contacts, setContacts] = useState(initialContacts)
  const [tags, setTags]         = useState(initialTags)
  const [search, setSearch]     = useState("")
  const [filter, setFilter]     = useState<"all" | "blocked" | "with_tags" | "with_email" | "with_company" | "no_custom_name">("all")
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(urlTag && initialTags.some((t) => t.id === urlTag) ? [urlTag] : [])
  )
  const [listFilter, setListFilter] = useState<string | null>(
    () => (urlList && lists.some((l) => l.id === urlList) ? urlList : null)
  )
  const [editing, setEditing]   = useState<Contact | null>(null)
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())        // seleção em massa
  const [sheetContact, setSheetContact] = useState<string | null>(null)   // Contato 360

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  // ── Seleção em massa ──────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function bulkTagApplied(tagId: string, ids: Set<string>) {
    setContacts((prev) => prev.map((c) =>
      ids.has(c.id) && !c.tag_ids.includes(tagId) ? { ...c, tag_ids: [...c.tag_ids, tagId] } : c
    ))
  }
  function bulkListApplied(listId: string, ids: Set<string>) {
    setContacts((prev) => prev.map((c) =>
      ids.has(c.id) && !c.list_ids.includes(listId) ? { ...c, list_ids: [...c.list_ids, listId] } : c
    ))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (filter === "blocked"        && !c.is_blocked) return false
      if (filter === "with_tags"      && c.tag_ids.length === 0) return false
      if (filter === "with_email"     && !c.email) return false
      if (filter === "with_company"   && !c.company) return false
      if (filter === "no_custom_name" && c.custom_name) return false

      if (listFilter) {
        const l = lists.find((x) => x.id === listFilter)
        if (l?.kind === "dynamic" && l.rules) {
          // Segmento dinâmico: avalia as regras sobre a linha (mesmo avaliador do server).
          if (!matchesSegment({
            lifecycle_stage: c.lifecycle_stage,
            tag_ids: c.tag_ids,
            created_at: c.created_at,
            ultima_dias: c.commerce?.ultimaDias ?? null,
          }, l.rules)) return false
        } else if (!c.list_ids.includes(listFilter)) return false
      }

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
        (c.phone_number ?? "").includes(q)
      )
    })
  }, [contacts, search, filter, selectedTags, listFilter, lists])

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
          {listFilter && (
            <span className="shrink-0 inline-flex items-center gap-1.5 h-9 pl-3 pr-1.5 text-xs font-semibold bg-primary-50 text-primary-700 border border-primary-200 rounded-lg">
              Lista: {lists.find((l) => l.id === listFilter)?.name ?? "—"}
              <button type="button" onClick={() => setListFilter(null)} title="Limpar filtro de lista"
                className="size-6 grid place-items-center rounded-md hover:bg-primary-100 transition-colors">
                <X className="size-3" />
              </button>
            </span>
          )}
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
          /* Colunas do roster NUNCA comprimem: se a tela for menor que o necessário,
             a lista rola horizontal DENTRO do card (padrão do design system). */
          <div className="overflow-x-auto">
          <div className="lg:min-w-[980px] xl:min-w-[1080px]">
            {/* header do roster: selecionar tudo (filtrado) */}
            <div className="flex items-center gap-3 px-5 py-2 border-b border-slate-100 bg-slate-50/60">
              <RowCheckbox
                checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                onToggle={() => setSelected(filtered.every((c) => selected.has(c.id)) ? new Set() : new Set(filtered.map((c) => c.id)))}
                title="Selecionar todos (filtro atual)"
              />
              <span className="w-10 shrink-0" />
              <span className="text-[11px] font-medium text-slate-400 w-64 xl:w-72 shrink-0">Nome</span>
              <span className="hidden md:block text-[11px] font-medium text-slate-400 flex-1">Tags</span>
              {crmEnabled && <span className="hidden lg:block text-[11px] font-medium text-slate-400 w-[384px] shrink-0">Dados</span>}
              <span className="hidden xl:block text-[11px] font-medium text-slate-400 w-20 text-right shrink-0">Criado em</span>
              <span className="w-8 shrink-0" />
            </div>
            <div className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  allTags={tags}
                  crmEnabled={crmEnabled}
                  checked={selected.has(c.id)}
                  onToggleSelect={() => toggleSelect(c.id)}
                  onOpenSheet={() => setSheetContact(c.id)}
                  onTagApplied={handleTagApplied}
                  onTagRemoved={handleTagRemoved}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </div>
          </div>
          </div>
        )}
      </div>

      {/* barra de ações em massa */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          tags={tags}
          lists={lists.filter((l) => l.kind === "static")}   // dinâmica não recebe membro manual
          onApply={async (tagId) => {
            const ids = new Set(selected)
            try {
              const r = await applyTagToContacts(tagId, Array.from(ids))
              bulkTagApplied(tagId, ids)
              flash("ok", r.applied > 0 ? `Tag aplicada a ${r.applied} contato${r.applied !== 1 ? "s" : ""}.` : "Todos os selecionados já tinham essa tag.")
              setSelected(new Set())
            } catch (err) { flash("error", (err as Error).message) }
          }}
          onApplyList={async (listId) => {
            const ids = new Set(selected)
            try {
              const r = await addContactsToList(listId, Array.from(ids))
              bulkListApplied(listId, ids)
              flash("ok", r.added > 0 ? `${r.added} contato${r.added !== 1 ? "s" : ""} adicionado${r.added !== 1 ? "s" : ""} à lista.` : "Todos os selecionados já estavam na lista.")
              setSelected(new Set())
            } catch (err) { flash("error", (err as Error).message) }
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* Contato 360 — mesma superfície do board (1 sheet, N portas) */}
      <ContactSheet contactId={sheetContact} onClose={() => setSheetContact(null)} />

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
  contact, allTags, crmEnabled, checked, onToggleSelect, onOpenSheet, onTagApplied, onTagRemoved, onEdit,
}: {
  contact:      Contact
  allTags:      Tag[]
  crmEnabled:   boolean
  checked:      boolean
  onToggleSelect: () => void
  onOpenSheet:  () => void
  onTagApplied: (cId: string, tId: string) => void
  onTagRemoved: (cId: string, tId: string) => void
  onEdit:       () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const name        = displayContactName(contact)
  const initial     = displayContactInitial(contact)
  const contactTags = allTags.filter((t) => contact.tag_ids.includes(t.id))
  const lc          = lifecycleMeta(contact.lifecycle_stage)
  const com         = contact.commerce

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

  // Nome já É o telefone formatado? Não repete no subtítulo (contato phone-only).
  const nameIsPhone = !!contact.phone_number && name.replace(/\D/g, "") === contact.phone_number.replace(/\D/g, "")
  const isDefaultLifecycle = !contact.lifecycle_stage || contact.lifecycle_stage === "contact"

  return (
    <div
      onClick={crmEnabled ? onOpenSheet : undefined}
      className={`group flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 transition-colors ${crmEnabled ? "cursor-pointer" : ""} ${checked ? "bg-primary-50/40" : ""}`}
    >
      <RowCheckbox checked={checked} onToggle={onToggleSelect} />

      <div className="size-10 rounded-full bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
        <ContactPic pic={contact.profile_pic_url} initial={initial} imgClass="size-10 object-cover" fallbackClass="text-sm font-bold text-slate-500" />
      </div>

      {/* Col NOME — identidade compacta (largura fixa → estrutura as colunas) */}
      <div className="w-64 xl:w-72 min-w-0 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link href={`/contatos/${contact.id}`} onClick={(e) => e.stopPropagation()} className="block text-sm font-semibold text-slate-900 truncate hover:text-primary-700 transition-colors">{name}</Link>
          {contact.channels.length > 0 && (
            <span className="inline-flex items-center gap-1 shrink-0" title={`Canais: ${contact.channels.join(", ")}`}>
              {contact.channels.map((ch) => CHANNEL_SOURCE[ch] && (
                <SourceLogo key={ch} source={CHANNEL_SOURCE[ch]} size={14} />
              ))}
            </span>
          )}
        </div>
        {crmEnabled && com?.ticket != null && (
          <p className="text-[10.5px] font-semibold text-emerald-600 tabular-nums mt-0.5">Ticket médio {brlFmt(com.ticket)}</p>
        )}
        {/* Só telefone — email/empresa saíram da linha (despoluir; vivem na ficha/360). */}
        <div className="flex items-center gap-3 mt-0.5 min-w-0">
          {contact.phone_number && !nameIsPhone ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 truncate">
              <Phone className="size-2.5 shrink-0" /> {formatPhone(contact.phone_number)}
            </span>
          ) : !contact.phone_number ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-300 italic">
              <Phone className="size-2.5" /> sem telefone
            </span>
          ) : null}
        </div>
      </div>

      {/* Col TAGS — preenche o meio (nunca colapsa abaixo de 120px) */}
      <div className="hidden md:flex items-center gap-1.5 flex-wrap flex-1 min-w-[120px] content-center">
        {contact.is_blocked && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
            <Ban className="size-2.5" /> Bloqueado
          </span>
        )}
        {!isDefaultLifecycle && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text}`} title={lc.label}>
            {lc.icon} {lc.label}
          </span>
        )}
        {contactTags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: t.color + "20", color: t.color, border: `1px solid ${t.color}30` }}
          >
            <span className="size-1 rounded-full" style={{ backgroundColor: t.color }} />
            {t.name}
          </span>
        ))}
      </div>

      {/* Col DADOS — GRID de colunas fixas: o valor cresce DENTRO da célula,
          nada empurra nada; todas as linhas alinham na vertical. Zero = mudo. */}
      {crmEnabled && (
        <div className="hidden lg:grid grid-cols-[104px_80px_88px_88px] items-center gap-2 w-[384px] shrink-0">
          <MiniStat label="Total"           value={com ? brlFmt(com.total) : "R$ 0"} strong={!!com} tone={com ? undefined : "muted"} />
          <PurchasesRing count={com?.compras ?? 0} />
          <MiniStat label="Ciclo de compra" value={com?.ciclo != null ? `${com.ciclo}d` : "—"} tone={com?.ciclo != null ? undefined : "muted"} />
          <MiniStat
            label="Última compra"
            value={com?.ultimaDias != null ? `${com.ultimaDias}d` : "—"}
            tone={com?.ultimaDias == null ? "muted" : com.ultimaDias <= 30 ? "ok" : com.ultimaDias <= 90 ? "warn" : "bad"}
          />
        </div>
      )}

      <span className="hidden xl:block text-[11px] text-slate-400 w-20 text-right tabular-nums shrink-0">
        {new Date(contact.created_at).toLocaleDateString("pt-BR")}
      </span>

      {/* Ações num "…" só — economiza ~70px pra informação respirar */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            title="Ações"
            className="size-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 grid place-items-center transition-colors data-[popup-open]:bg-slate-100 data-[popup-open]:text-slate-700"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => router.push(`/inbox?contact=${contact.id}`)}>
              <MessageCircle className="size-3.5 text-primary-500" /> Abrir conversa
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/contatos/${contact.id}`)}>
              <ExternalLink className="size-3.5 text-slate-400" /> Ficha completa
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5 text-slate-400" /> Editar contato
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-1.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Tags</div>
            {allTags.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-400">Nenhuma tag criada.</p>}
            {allTags.map((t) => {
              const applied = contact.tag_ids.includes(t.id)
              return (
                <DropdownMenuCheckboxItem key={t.id} checked={applied} closeOnClick={false} disabled={pending}
                  onCheckedChange={() => handleToggleTag(t.id, applied)}>
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="truncate">{t.name}</span>
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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

// ── Roster comercial — primitivas ────────────────────────────────
const brlFmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: v >= 100 ? 0 : 2 })

function RowCheckbox({ checked, onToggle, title }: { checked: boolean; onToggle: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={`size-4 rounded border grid place-items-center shrink-0 transition-colors ${
        checked ? "bg-primary border-primary text-white" : "border-slate-300 bg-white hover:border-primary/50"
      }`}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  )
}

function MiniStat({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const color =
    tone === "ok"   ? "text-emerald-600"
    : tone === "warn" ? "text-amber-600"
    : tone === "bad"  ? "text-red-600"
    : tone === "muted" ? "text-slate-300"
    : strong ? "text-slate-800" : "text-slate-600"
  return (
    <div className="min-w-0">
      <p className={`text-xs font-bold tabular-nums leading-tight truncate ${color}`} title={value}>{value}</p>
      <p className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">{label}</p>
    </div>
  )
}

/** Anel de compras (referência): círculo com o nº de compras dentro. */
function PurchasesRing({ count }: { count: number }) {
  const active = count > 0
  return (
    <div className="flex items-center gap-1.5 shrink-0" title={`${count} compra${count !== 1 ? "s" : ""}`}>
      <span className={`size-8 rounded-full border-2 grid place-items-center text-[11px] font-bold tabular-nums shrink-0 ${
        active ? "border-emerald-400 text-emerald-600" : "border-slate-200 text-slate-300"
      }`}>
        {count}
      </span>
      <span className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">Compras</span>
    </div>
  )
}

/** Barra flutuante da seleção em massa — a segmentação virando AÇÃO. */
function BulkBar({ count, tags, lists, onApply, onApplyList, onClear }: {
  count: number
  tags: Tag[]
  lists: { id: string; name: string }[]
  onApply: (tagId: string) => Promise<void>
  onApplyList: (listId: string) => Promise<void>
  onClear: () => void
}) {
  const [open, setOpen] = useState<"tag" | "list" | null>(null)
  const [pending, startTransition] = useTransition()

  function menu(kind: "tag" | "list", items: { id: string; name: string; color?: string }[], run: (id: string) => Promise<void>) {
    if (open !== kind) return null
    return (
      <>
        <div className="fixed inset-0 z-10" onClick={() => setOpen(null)} />
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-64 overflow-y-auto py-1">
          {items.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-400">Nada criado ainda.</p>}
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              disabled={pending}
              onClick={() => { setOpen(null); startTransition(async () => { await run(it.id) }) }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {it.color
                ? <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
                : <ListChecks className="size-3 text-primary-500 shrink-0" />}
              <span className="truncate">{it.name}</span>
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-slate-900 text-white rounded-xl pl-4 pr-2 py-2 shadow-2xl animate-in slide-in-from-bottom-2 fade-in-0 duration-150">
      <span className="text-xs font-semibold tabular-nums mr-1">{count} selecionado{count !== 1 ? "s" : ""}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "tag" ? null : "tag")}
          disabled={pending || tags.length === 0}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <TagIcon className="size-3.5" />}
          Aplicar tag
        </button>
        {menu("tag", tags, onApply)}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "list" ? null : "list")}
          disabled={pending || lists.length === 0}
          title={lists.length === 0 ? "Crie listas em Configurações → Comercial → Listas" : undefined}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
        >
          <ListChecks className="size-3.5" />
          Adicionar à lista
        </button>
        {menu("list", lists, onApplyList)}
      </div>
      <button
        type="button"
        onClick={onClear}
        title="Limpar seleção"
        className="size-8 grid place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
