"use client"

// Lista de Formulários — espelha a tela 1 do canvas aprovado pelo dono ("Kora Formulários"):
// título + "Ver modelos"/"Novo formulário", 4 números do topo, busca + 4 filtros, tabela com
// Respostas · Conclusão · Conversas · Automação no Studio · Última resposta.
// Respostas são reais desde a Fase 2. Enquanto um número não existe (automação na Fase 3,
// conclusão na Fase 4) a tela mostra "0" ou "—", como o desenho mostra para rascunho — nunca esconde a coluna.

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, ClipboardList, MoreHorizontal, ExternalLink, Copy, Trash2, Loader2, FileText, CheckCircle2, MessageCircle, Clock } from "lucide-react"
import { toast } from "sonner"
import { PageShell } from "@/components/ui/page-shell"
import { KpiTile } from "@/components/ui/kpi-tile"
import { EmptyState } from "@/components/ui/empty-state"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { TemplateGallery } from "@/components/forms/template-gallery"
import { TemplateIcon } from "@/components/forms/template-icons"
import { FormStatusChip } from "@/components/forms/status-chip"
import { duplicateForm, deleteForm, type FormListItem, type FormStatus } from "@/lib/actions/forms"
import { isTemplateKey, templateInfo } from "@/lib/forms/templates"

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return "agora"
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return "ontem"
  if (d < 30) return `há ${d} dias`
  return new Date(iso).toLocaleDateString("pt-BR")
}

/** Passos que a pessoa percorre: as perguntas + "Seus dados". */
const stepsLabel = (n: number) => `${n + 1} passo${n + 1 === 1 ? "" : "s"}`

const HEADER_BTN = "inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg transition-colors"

export function FormsClient({ items, canManage, businessName }: { items: FormListItem[]; canManage: boolean; businessName: string }) {
  const [gallery, setGallery] = useState(false)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<FormStatus | "all">("all")

  const counts = useMemo(() => ({
    all: items.length,
    published: items.filter((i) => i.status === "published").length,
    draft: items.filter((i) => i.status === "draft").length,
    paused: items.filter((i) => i.status === "paused").length,
  }), [items])

  const shown = useMemo(() => {
    const term = q.trim().toLocaleLowerCase("pt-BR")
    return items.filter((i) => (filter === "all" || i.status === filter) && (!term || i.name.toLocaleLowerCase("pt-BR").includes(term)))
  }, [items, q, filter])

  const actions = canManage ? (
    <>
      <button type="button" onClick={() => setGallery(true)} className={`${HEADER_BTN} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`}>Ver modelos</button>
      <button type="button" onClick={() => setGallery(true)} className={`${HEADER_BTN} bg-primary hover:bg-primary-700 text-white`}><Plus className="size-3.5" /> Novo formulário</button>
    </>
  ) : undefined

  const published = counts.published
  const responses30d = items.reduce((n, i) => n + i.responses30d, 0)
  return (
    <PageShell variant="list" title="Formulários" actions={actions}
      description="Capte pedidos no seu site e no seu link. Cada envio pode disparar um fluxo do Kora Studio.">
      {items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhum formulário ainda"
          description={canManage
            ? "Comece por um modelo pronto: orçamento guiado, fale conosco, agendamento… Você ajusta perguntas, textos e cores depois."
            : "Quando alguém da equipe criar um formulário, ele aparece aqui."}
          action={canManage ? <button type="button" onClick={() => setGallery(true)} className={`${HEADER_BTN} bg-primary hover:bg-primary-700 text-white`}><Plus className="size-3.5" /> Novo formulário</button> : undefined} />
      ) : (
        <div className="space-y-5">
          {/* Números do topo — zerados até existirem respostas (Fase 2). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile icon={FileText} label="Respostas · 30 dias" value={responses30d.toLocaleString("pt-BR")} caption={`em ${published} formulário${published === 1 ? "" : "s"} publicado${published === 1 ? "" : "s"}`} />
            <KpiTile icon={CheckCircle2} iconClass="text-sky-600" label="Taxa de conclusão" value="—" caption="de quem começou, terminou" />
            <KpiTile icon={MessageCircle} iconClass="text-emerald-700" label="Viraram conversa" value="0" caption="responderam a mensagem do Kora" />
            <KpiTile icon={Clock} iconClass="text-amber-700" label="Até a 1ª mensagem" value="—" caption="em média, depois do envio" />
          </div>

          <Toolbar
            search={{ value: q, onChange: setQ, placeholder: "Buscar formulário" }}
            filters={<>
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>Todos · {counts.all}</FilterChip>
              <FilterChip active={filter === "published"} onClick={() => setFilter("published")}>Publicados · {counts.published}</FilterChip>
              <FilterChip active={filter === "draft"} onClick={() => setFilter("draft")}>Rascunhos · {counts.draft}</FilterChip>
              <FilterChip active={filter === "paused"} onClick={() => setFilter("paused")}>Pausados · {counts.paused}</FilterChip>
            </>}
          />

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50/60 whitespace-nowrap">
                  <th className="text-left py-3 px-5">Formulário</th>
                  <th className="text-left py-3 px-3">Situação</th>
                  <th className="text-right py-3 px-3 hidden md:table-cell">Respostas</th>
                  <th className="text-right py-3 px-3 hidden md:table-cell">Conclusão</th>
                  <th className="text-right py-3 px-3 hidden md:table-cell">Conversas</th>
                  <th className="text-left py-3 px-3 hidden lg:table-cell">Automação no Studio</th>
                  <th className="text-left py-3 px-3 hidden lg:table-cell">Última resposta</th>
                  <th className="py-3 px-3 w-12"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((f) => <Row key={f.id} f={f} canManage={canManage} />)}
                {shown.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-xs text-slate-400">Nenhum formulário com esse filtro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {gallery && <TemplateGallery businessName={businessName} onClose={() => setGallery(false)} />}
    </PageShell>
  )
}

function Row({ f, canManage }: { f: FormListItem; canManage: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  const origin = f.templateKey && isTemplateKey(f.templateKey) ? templateInfo(f.templateKey).name : "Formulário"
  const open = () => router.push(`/formularios/${f.id}`)
  const live = f.status !== "draft"   // rascunho nunca recebeu resposta: "—" (como no desenho)

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

  const dash = <span className="text-slate-400">—</span>
  return (
    <tr className="hover:bg-slate-50/70 cursor-pointer" onClick={open}>
      {/* `w-full max-w-0`: o nome ocupa a sobra e encolhe com reticências (sem empurrar as ações para fora no celular). */}
      <td className="py-3.5 px-5 w-full max-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="size-9 rounded-lg bg-primary-50 text-primary grid place-items-center shrink-0"><TemplateIcon templateKey={f.templateKey} className="size-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{f.name}</p>
            <p className="text-xs text-slate-500 truncate">{origin} · {stepsLabel(f.questionCount)}</p>
          </div>
        </div>
      </td>
      <td className="py-3.5 px-3"><FormStatusChip status={f.status} /></td>
      <td className="py-3.5 px-3 text-right tabular-nums font-semibold text-slate-800 hidden md:table-cell">{live ? f.responsesTotal.toLocaleString("pt-BR") : dash}</td>
      {/* Conclusão (quem começou × quem enviou) e Conversas chegam com os números da Fase 4 e o Studio. */}
      <td className="py-3.5 px-3 text-right tabular-nums text-slate-700 hidden md:table-cell">{dash}</td>
      <td className="py-3.5 px-3 text-right tabular-nums text-slate-700 hidden md:table-cell">{live ? "0" : dash}</td>
      <td className="py-3.5 px-3 text-xs hidden lg:table-cell whitespace-nowrap">
        {/* O bloco Formulário do Studio chega na Fase 3 — até lá, nenhum formulário tem fluxo. */}
        <span className="font-semibold text-amber-700" title="O bloco Formulário do Kora Studio chega na próxima etapa.">Sem fluxo</span>
      </td>
      <td className="py-3.5 px-3 text-xs text-slate-500 hidden lg:table-cell whitespace-nowrap">
        {/* Tempo relativo: servidor e navegador calculam em instantes diferentes. */}
        {f.lastResponseAt
          ? <time dateTime={f.lastResponseAt} title={new Date(f.lastResponseAt).toLocaleString("pt-BR")} suppressHydrationWarning>{ago(f.lastResponseAt)}</time>
          : live ? <span className="text-slate-400">sem respostas</span>
          : <time dateTime={f.updatedAt} title={new Date(f.updatedAt).toLocaleString("pt-BR")} suppressHydrationWarning>editado {ago(f.updatedAt)}</time>}
      </td>
      <td className="py-3.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
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
