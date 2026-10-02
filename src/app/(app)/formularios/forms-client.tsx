"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, ClipboardList, MoreHorizontal, ExternalLink, Copy, Trash2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusDot } from "@/components/ui/status-dot"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { TemplateGallery } from "@/components/forms/template-gallery"
import { duplicateForm, deleteForm, type FormListItem, type FormStatus } from "@/lib/actions/forms"
import { isTemplateKey, templateInfo } from "@/lib/forms/templates"

const STATUS: Record<FormStatus, { label: string; tone: "neutral" | "success" | "warning" }> = {
  draft:     { label: "Rascunho",  tone: "neutral" },
  published: { label: "Publicado", tone: "success" },
  paused:    { label: "Pausado",   tone: "warning" },
}

function updatedLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "agora"
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return "ontem"
  if (d < 30) return `há ${d} dias`
  return new Date(iso).toLocaleDateString("pt-BR")
}

export function FormsClient({ items, canManage, businessName }: { items: FormListItem[]; canManage: boolean; businessName: string }) {
  const [gallery, setGallery] = useState(false)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<FormStatus | "all">("all")

  const counts = useMemo(() => ({
    all: items.length,
    draft: items.filter((i) => i.status === "draft").length,
    published: items.filter((i) => i.status === "published").length,
    paused: items.filter((i) => i.status === "paused").length,
  }), [items])

  const shown = useMemo(() => {
    const term = q.trim().toLocaleLowerCase("pt-BR")
    return items.filter((i) => (filter === "all" || i.status === filter) && (!term || i.name.toLocaleLowerCase("pt-BR").includes(term)))
  }, [items, q, filter])

  const novo = canManage && (
    <button type="button" onClick={() => setGallery(true)}
      className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
      <Plus className="size-3.5" /> Novo formulário
    </button>
  )

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhum formulário ainda"
          description={canManage
            ? "Comece por um modelo pronto: orçamento guiado, fale conosco, agendamento… Você ajusta perguntas, textos e cores depois."
            : "Quando alguém da equipe criar um formulário, ele aparece aqui."}
          action={novo || undefined} />
      ) : (
        <>
          <Toolbar
            search={{ value: q, onChange: setQ, placeholder: "Buscar formulário" }}
            filters={<>
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Todos · {counts.all}</FilterChip>
              <FilterChip active={filter === "draft"} onClick={() => setFilter("draft")}>Rascunhos · {counts.draft}</FilterChip>
              {counts.published > 0 && <FilterChip active={filter === "published"} onClick={() => setFilter("published")}>Publicados · {counts.published}</FilterChip>}
              {counts.paused > 0 && <FilterChip active={filter === "paused"} onClick={() => setFilter("paused")}>Pausados · {counts.paused}</FilterChip>}
            </>}
            actions={novo || undefined}
          />
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Formulário</th>
                  <th className="text-left font-medium py-2.5 px-3">Situação</th>
                  <th className="text-right font-medium py-2.5 px-3 hidden sm:table-cell">Perguntas</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Atualizado</th>
                  <th className="py-2.5 px-4 w-12"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((f) => <Row key={f.id} f={f} canManage={canManage} />)}
                {shown.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">Nenhum formulário com esse filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
        <b className="text-slate-500">Etapa de montagem:</b> crie e ajuste os formulários com a prévia ao vivo. Publicar no site e no link próprio, com as respostas chamando a pessoa no WhatsApp, chega na próxima etapa.
      </p>

      {gallery && <TemplateGallery businessName={businessName} onClose={() => setGallery(false)} />}
    </div>
  )
}

function Row({ f, canManage }: { f: FormListItem; canManage: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  const st = STATUS[f.status]
  const origin = f.templateKey && isTemplateKey(f.templateKey) ? templateInfo(f.templateKey).name : "Formulário"
  const open = () => router.push(`/formularios/${f.id}`)

  function duplicate() {
    start(async () => {
      const r = await duplicateForm(f.id)
      if ("error" in r) { toast.error(r.error); return }
      toast.success("Cópia criada")
      router.push(`/formularios/${r.id}`)
    })
  }

  async function remove() {
    const ok = await confirm({ title: `Excluir "${f.name}"?`, body: "O rascunho e as perguntas somem. Isso não pode ser desfeito.", confirmLabel: "Excluir" })
    if (!ok) return
    start(async () => {
      const r = await deleteForm(f.id)
      if (r.error) { toast.error(r.error); return }
      toast.success("Formulário excluído")
      router.refresh()
    })
  }

  return (
    <tr className="hover:bg-slate-50/70 cursor-pointer" onClick={open}>
      {/* `w-full max-w-0`: a célula do nome ocupa a sobra e ENCOLHE com reticências — sem isso
          a tabela estica e empurra as ações para fora da tela no celular. */}
      <td className="py-3 px-4 w-full max-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="size-9 rounded-lg bg-primary-50 text-primary grid place-items-center shrink-0"><ClipboardList className="size-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{f.name}</p>
            <p className="text-xs text-slate-500 truncate">{origin}<span className="sm:hidden"> · {f.questionCount} perguntas</span></p>
          </div>
        </div>
      </td>
      <td className="py-3 px-3 whitespace-nowrap"><StatusDot tone={st.tone} label={st.label} size="sm" /></td>
      <td className="py-3 px-3 text-right tabular-nums text-slate-700 hidden sm:table-cell">{f.questionCount}</td>
      {/* Tempo relativo: servidor e navegador calculam em instantes diferentes — o texto pode
          mudar de minuto entre os dois. `suppressHydrationWarning` é o padrão para isso. */}
      <td className="py-3 px-3 text-xs text-slate-500 hidden md:table-cell">
        <time dateTime={f.updatedAt} title={new Date(f.updatedAt).toLocaleString("pt-BR")} suppressHydrationWarning>{updatedLabel(f.updatedAt)}</time>
      </td>
      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger title="Ações" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={open}><ExternalLink className="size-3.5 text-slate-400" /> {canManage ? "Abrir editor" : "Ver formulário"}</DropdownMenuItem>
            {canManage && <DropdownMenuItem onClick={duplicate}><Copy className="size-3.5 text-slate-400" /> Duplicar</DropdownMenuItem>}
            {canManage && f.status === "draft" && <DropdownMenuSeparator />}
            {canManage && f.status === "draft" && <DropdownMenuItem onClick={remove} className="text-red-600"><Trash2 className="size-3.5" /> Excluir rascunho</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
        {confirmDialog}
      </td>
    </tr>
  )
}
