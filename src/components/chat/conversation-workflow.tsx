"use client"

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowRightLeft, Check, ChevronDown, ChevronRight, Columns3, Loader2, MoreHorizontal, Search, Tag, UserRound } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { TransferDialog } from "./transfer-dialog"
import { getConversationWorkflow, classifyConversationContact, updateConversationContactTags } from "@/lib/actions/conversation-workflow"
import { moveConversation } from "@/lib/actions/pipeline"
import { transferConversation, updateConversationStatus } from "@/lib/actions/chat"
import { displayContactName } from "@/lib/contact"
import { lifecycleMeta } from "@/lib/lifecycle"

const CLASSIFICATIONS = [
  { id: "contact", label: "Contato", description: "Ainda em avaliação." },
  { id: "lead", label: "Lead", description: "Tem interesse e perfil comercial." },
  { id: "customer", label: "Cliente", description: "Já possui relação comercial." },
  { id: "unfit", label: "Sem fit", description: "Não se encaixa no perfil neste momento." },
] as const
type Classification = typeof CLASSIFICATIONS[number]["id"]
const classificationOf = (value?: string | null): Classification => value === "won" ? "customer" : value === "lost" ? "lead" : CLASSIFICATIONS.some(c => c.id === value) ? value as Classification : "contact"

export type WorkflowData = Awaited<ReturnType<typeof getConversationWorkflow>>
type Action = "stage" | "move" | "qualify" | "tags" | "transfer" | "finish"
type Target = { id: string; status: string; is_group?: boolean; archived_at?: string | null; chat_contacts?: { custom_name: string | null; push_name: string | null; lifecycle_stage?: string | null; phone_number?: string | null } | null }
export type WorkflowExtra = { label: string; run: () => void; disabled?: boolean }
type MenuState = { target: Target; x: number; y: number; origin: HTMLElement; extras: WorkflowExtra[] }
const Context = createContext<{
  kanban: boolean
  revision: number
  open: (action: Action, id: string) => void
  menu: (target: Target, e: { clientX: number; clientY: number; currentTarget: HTMLElement; preventDefault: () => void; stopPropagation: () => void }, extras?: WorkflowExtra[]) => void
} | null>(null)
export const useConversationWorkflow = () => useContext(Context)

export function ConversationWorkflowProvider({ children, kanban = true, agents, departments, onUpdated, onUnavailable }: {
  children: ReactNode; kanban?: boolean
  agents: Array<{ id: string; full_name: string | null; department_id?: string | null }>
  departments: Array<{ id: string; name: string; color: string }>
  onUpdated?: (data: WorkflowData) => void
  onUnavailable?: (id: string) => void
}) {
  const router = useRouter()
  const [revision, setRevision] = useState(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [request, setRequest] = useState<{ action: Action; id: string } | null>(null)
  const [data, setData] = useState<WorkflowData | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [destination, setDestination] = useState("")
  const [stageId, setStageId] = useState("")
  const [selection, setSelection] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [classification, setClassification] = useState<Classification>("contact")
  const [reason, setReason] = useState("")
  const opener = useRef<HTMLElement | null>(null)
  const sequence = useRef(0)
  const close = () => { if (pending) return; sequence.current++; setRequest(null); setData(null); opener.current?.focus() }
  const load = async (action: Action, id: string) => {
    const seq = ++sequence.current
    setLoading(true); setError(""); setData(null)
    try {
      const result = await getConversationWorkflow(id)
      if (seq !== sequence.current) return
      setData(result); setSelection(result.tagIds); setSearch("")
      setClassification(classificationOf(result.contact?.lifecycle_stage)); setReason(result.contact?.unfit_reason ?? "")
      const initialBoard = action === "move" ? "" : result.conversation.pipeline_id ?? ""
      setDestination(initialBoard); setStageId(action === "stage" ? result.conversation.stage_id ?? "" : "")
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : "Não foi possível carregar as opções.") }
    finally { if (seq === sequence.current) setLoading(false) }
  }
  const open = (action: Action, id: string) => {
    opener.current = menu?.origin ?? (document.activeElement as HTMLElement)
    setMenu(null); setRequest({ action, id }); void load(action, id)
  }
  async function refreshed(id: string) {
    // Losing access after a transfer is legitimate; do not turn successful writes into failures.
    try { onUpdated?.(await getConversationWorkflow(id)) } catch { onUnavailable?.(id) }
    setRevision(v => v + 1)
    router.refresh()
  }
  async function save() {
    if (!request || !data || pending) return
    setPending(true); setError("")
    try {
      let warning: string | undefined
      if (request.action === "stage" || request.action === "move") {
        const result = await moveConversation(request.id, stageId, 0, data.conversation.updated_at)
        warning = result.warning
      } else if (request.action === "qualify") await classifyConversationContact(request.id, { stage: classification, expectedUpdatedAt: data.contact!.updated_at, reason })
      else if (request.action === "tags") await updateConversationContactTags(request.id,
        selection.filter(id => !data.tagIds.includes(id)), data.tagIds.filter(id => !selection.includes(id)))
      else if (request.action === "finish") {
        await updateConversationStatus(request.id, data.conversation.status === "resolved" ? "open" : "resolved")
      }
      await refreshed(request.id)
      setRequest(null); setData(null)
      if (warning) toast.warning(warning); else toast.success("Alteração salva.")
      opener.current?.focus()
    } catch (e) {
      const message = e instanceof Error ? e.message : "Não foi possível salvar. Tente novamente."
      // Reload tag selection after a partial failure, so retries send only remaining changes.
      if (request.action === "tags") {
        try { const latest = await getConversationWorkflow(request.id); setData(latest); setSelection(latest.tagIds); onUpdated?.(latest) } catch { setData(null) }
      }
      setError(message)
    } finally { setPending(false) }
  }
  const action = request?.action
  const isMove = action === "stage" || action === "move"
  const options = data?.stages.filter(s => s.pipeline_id === destination) ?? []
  const fromBoard = data?.pipelines.find(p => p.id === data.conversation.pipeline_id)?.name ?? (data?.conversation.pipeline_id ? "Kanban indisponível" : "Sem Kanban")
  const fromStage = data?.stages.find(s => s.id === data.conversation.stage_id)?.name ?? "Sem etapa visível"
  const currentClassification = classificationOf(data?.contact?.lifecycle_stage)
  const customerProtected = currentClassification === "customer"
  const classificationUnchanged = classification === currentClassification && (classification !== "unfit" || reason.trim() === (data?.contact?.unfit_reason ?? "").trim())
  const invalid = !data || loading || pending || (isMove && (!data.kanban || data.conversation.archived_at || data.conversation.is_group || !options.some(s => s.id === stageId) || (stageId === data.conversation.stage_id && destination === data.conversation.pipeline_id))) || (action === "qualify" && (classificationUnchanged || (customerProtected && classification !== "customer"))) || ((action === "qualify" || action === "tags") && (!data.contact || data.conversation.is_group))
  const title = action === "stage" ? "Alterar etapa" : action === "move" ? "Mover para outro Kanban" : action === "qualify" ? "Classificar contato" : action === "tags" ? "Gerenciar etiquetas" : action === "transfer" ? "Transferir atendimento" : data?.conversation.status === "resolved" ? "Reabrir atendimento" : "Concluir atendimento"
  const selectCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
  return <Context.Provider value={{ kanban, revision, open, menu: (target, e, extras = []) => { e.preventDefault(); e.stopPropagation(); setMenu({ target, x: e.clientX, y: e.clientY, origin: e.currentTarget, extras }) } }}>
    {children}
    {menu && <WorkflowMenu state={menu} kanban={kanban} onClose={() => { setMenu(null); menu.origin.focus() }} onAction={a => open(a, menu.target.id)} />}
    <Dialog open={!!request && !(action === "transfer" && data)} onOpenChange={v => { if (!v) close() }}>
      <DialogContent className="sm:max-w-[470px] max-h-[90dvh] overflow-y-auto p-6 max-sm:top-auto max-sm:bottom-3 max-sm:translate-y-0" showCloseButton={!pending}>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{isMove ? "Escolha a posição deste atendimento." : action === "tags" ? "As etiquetas organizam o contato em todas as suas conversas." : "Revise a alteração antes de confirmar."}</DialogDescription></DialogHeader>
        {loading && <div className="flex items-center justify-center gap-2 py-8 text-slate-500" role="status"><Loader2 className="size-4 animate-spin" /> Carregando opções…</div>}
        {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}{!data && !loading && <button className="block mt-2 underline" onClick={() => request && void load(request.action, request.id)}>Tentar novamente</button>}</div>}
        {data && <fieldset disabled={pending} className="min-w-0 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-canvas p-3 text-sm font-semibold">{data.contact ? displayContactName(data.contact) : "Conversa sem contato"}</div>
          {isMove && <>
            {(action === "move" || !data.conversation.pipeline_id) && <label className="block text-xs font-semibold space-y-2">Kanban de destino<select aria-label="Kanban de destino" className={selectCls} value={destination} onChange={e => { setDestination(e.target.value); setStageId("") }}><option value="">Selecione um Kanban</option>{data.pipelines.filter(p => action !== "move" || p.id !== data.conversation.pipeline_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            <label className="block text-xs font-semibold space-y-2">Etapa de destino<select aria-label="Etapa de destino" className={selectCls} value={stageId} onChange={e => setStageId(e.target.value)}><option value="">Selecione uma etapa</option>{options.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            {destination && options.length === 0 && <p className="text-xs text-amber-700">Este Kanban não possui etapas disponíveis.</p>}
            <div className="rounded-lg border border-slate-200 bg-canvas p-3 text-xs space-y-2"><p className="text-slate-500">De</p><p>{fromBoard} · {fromStage}</p><ArrowDown className="size-4 text-primary" /><p className="text-slate-500">Para</p><p className="font-semibold">{data.pipelines.find(p => p.id === destination)?.name ?? "Selecione o Kanban"} · {options.find(s => s.id === stageId)?.name ?? "Selecione a etapa"}</p></div>
            <p className="text-xs leading-relaxed text-slate-500">Atendente, departamento, lembretes, classificação do contato e negócios são mantidos. Mover uma conversa concluída não reabre o atendimento.</p>
          </>}
          {action === "qualify" && <>
            <p className="text-xs text-slate-500">Classificação atual: <strong className="text-slate-700">{lifecycleMeta(data.contact?.lifecycle_stage).label}</strong></p>
            <div role="radiogroup" aria-label="Classificação do contato" className="grid grid-cols-2 gap-3">
              {CLASSIFICATIONS.map(option => {
                const disabled = customerProtected && option.id !== "customer"
                return <label key={option.id} className={`relative flex flex-col gap-2 rounded-xl border p-3.5 transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:border-primary-200"} ${classification === option.id ? "border-primary bg-primary-50" : "border-slate-200 bg-white"}`}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{option.label}</span><input type="radio" name="contact-classification" value={option.id} aria-label={option.label} checked={classification === option.id} disabled={disabled} onChange={() => setClassification(option.id)} className="size-4 accent-primary" /></span>
                  <span className="text-xs leading-relaxed text-slate-500">{option.description}</span>
                </label>
              })}
            </div>
            {classification === "unfit" && <label className="block space-y-2 text-xs font-semibold">Motivo (opcional)<textarea aria-label="Motivo de Sem fit" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} rows={2} placeholder="O que levou a essa avaliação?" className="w-full resize-none rounded-lg border border-slate-200 p-3 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-primary/20" /></label>}
            {customerProtected ? <p className="text-xs text-slate-500">Este contato já é Cliente. O vínculo comercial fica protegido contra rebaixamento por este menu.</p> : <p className="text-xs leading-relaxed text-slate-500">A classificação vale para todas as conversas deste contato. Atendimento, Kanban e negócios permanecem como estão.</p>}
            {!classificationUnchanged && <p className="rounded-lg bg-canvas p-3 text-xs">Ao salvar: <strong>{lifecycleMeta(data.contact?.lifecycle_stage).label} → {lifecycleMeta(classification).label}</strong></p>}
          </>}
          {action === "tags" && <><div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3"><Search className="size-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar etiqueta" aria-label="Buscar etiqueta" className="py-2.5 min-w-0 flex-1 bg-transparent outline-none text-sm" /></div><div className="max-h-60 overflow-y-auto">{data.tags.filter(t => t.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(t => <label key={t.id} className="flex items-center gap-3 py-3 border-b border-slate-100 text-sm cursor-pointer"><input type="checkbox" className="size-4 accent-primary" checked={selection.includes(t.id)} onChange={e => setSelection(old => e.target.checked ? [...old, t.id] : old.filter(id => id !== t.id))} /><span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />{t.name}</label>)}{!data.tags.some(t => t.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="py-4 text-xs text-slate-500">Nenhuma etiqueta encontrada.</p>}</div><p className="text-xs text-slate-500">{selection.length} selecionada(s)</p></>}
          {action === "finish" && <p className="text-sm leading-relaxed text-slate-500">{data.conversation.status === "resolved" ? "A conversa voltará aos atendimentos ativos, na mesma etapa." : "A conversa aparecerá em Concluídos. A etapa, os negócios e a classificação do contato são mantidos."}</p>}
        </fieldset>}
        <DialogFooter className="border-t border-slate-100 pt-4"><Button variant="outline" disabled={pending} onClick={close}>Cancelar</Button><Button disabled={!!invalid} onClick={() => void save()}>{pending && <Loader2 className="size-4 animate-spin" />}{action === "move" ? "Mover conversa" : action === "stage" ? "Salvar etapa" : action === "qualify" ? "Salvar alteração" : action === "tags" ? "Salvar etiquetas" : title}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {action === "transfer" && request && data && <TransferDialog open onClose={close} agents={agents} departments={departments} currentAssignedTo={data.conversation.assigned_to} onTransfer={async opts => { const result = await transferConversation(request.id, opts); if (result.error) throw new Error(result.error); await refreshed(request.id); setRequest(null); toast.success("Atendimento transferido.") }} />}
  </Context.Provider>
}

function WorkflowMenu({ state, kanban, onClose, onAction }: { state: MenuState; kanban: boolean; onClose: () => void; onAction: (a: Action) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.left = `${Math.max(8, Math.min(state.x, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.top = `${Math.max(8, Math.min(state.y, window.innerHeight - el.offsetHeight - 8))}px`
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
  }, [state])
  useEffect(() => { const close = () => onClose(); window.addEventListener("resize", close); return () => window.removeEventListener("resize", close) }, [onClose])
  const itemClass = "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13px] text-slate-700 transition-colors enabled:hover:bg-primary-50 enabled:hover:text-primary-700 focus:bg-primary-50 focus:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
  const item = (a: Action, Icon: typeof Tag, text: string, disabled = false) => <button role="menuitem" type="button" disabled={disabled} onMouseEnter={e => { if (!disabled) e.currentTarget.focus({ preventScroll: true }) }} onClick={() => onAction(a)} className={itemClass}><Icon className="size-4 opacity-70" />{text}</button>
  const label = (text: string) => <div className="px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{text}</div>
  return createPortal(<><div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} /><div ref={ref} role="menu" aria-label="Ações da conversa" className="fixed z-[61] w-[270px] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-900/10" onKeyDown={e => {
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === "Escape" || e.key === "Tab") { onClose(); return }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) { e.preventDefault(); buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus() }
  }}><div className="border-b border-slate-100 px-2.5 py-2 text-xs font-semibold truncate">{state.target.chat_contacts ? displayContactName(state.target.chat_contacts) : "Conversa"}</div>
    {kanban && !state.target.is_group && <>{label("Kanban de atendimento")}{item("stage", Columns3, "Alterar etapa", !!state.target.archived_at)}{item("move", ArrowRightLeft, "Mover para outro Kanban", !!state.target.archived_at)}</>}
    {!!state.target.chat_contacts && !state.target.is_group && <>{label("Contato")}{item("qualify", UserRound, "Classificar contato")}{item("tags", Tag, "Gerenciar etiquetas")}</>}
    {label("Atendimento")}{item("transfer", ArrowRightLeft, "Transferir atendimento")}{item("finish", Check, state.target.status === "resolved" ? "Reabrir atendimento" : "Concluir atendimento")}
    {state.extras.length > 0 && <><div className="my-1 border-t border-slate-100" />{state.extras.map((extra, i) => <button key={i} role="menuitem" type="button" disabled={extra.disabled} className={itemClass} onMouseEnter={e => { if (!extra.disabled) e.currentTarget.focus({ preventScroll: true }) }} onClick={() => { onClose(); extra.run() }}>{extra.label}</button>)}</>}
  </div></>, document.body)
}

export function ConversationActionsButton({ conversation, extras = [] }: { conversation: Target; extras?: WorkflowExtra[] }) {
  const workflow = useConversationWorkflow()
  if (!workflow) return null
  return <button type="button" aria-label="Ações da conversa" aria-haspopup="menu" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary" onPointerDown={e => e.stopPropagation()} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); workflow.menu(conversation, { ...e, clientX: rect.right - 270, clientY: rect.bottom + 4, currentTarget: e.currentTarget, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() }, extras) }}><MoreHorizontal className="size-4" /></button>
}

export function ConversationKanbanPosition({ conversation, pipelines, stages, card = false }: {
  conversation: { id: string; pipeline_id: string | null; stage_id: string | null; archived_at?: string | null; is_group?: boolean }
  pipelines: Array<{ id: string; name: string }>; stages: Array<{ id: string; name: string }>; card?: boolean
}) {
  const workflow = useConversationWorkflow()
  if (!workflow?.kanban || conversation.is_group) return null
  const pipeline = pipelines.find(p => p.id === conversation.pipeline_id)
  const stage = stages.find(s => s.id === conversation.stage_id)
  const disabled = !!conversation.archived_at
  if (card) return <div className="mx-4 mb-3 rounded-xl border border-slate-200 bg-white p-3.5"><div className="flex items-center justify-between mb-3"><h3 className="text-[13px] font-semibold">Kanban de atendimento</h3><Columns3 className="size-4 text-slate-400" /></div><p className="text-xs text-slate-500">{pipeline?.name ?? (conversation.pipeline_id ? "Kanban indisponível" : "Sem Kanban")}</p><button disabled={disabled} onClick={() => workflow.open("stage", conversation.id)} className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-canvas px-3 py-2.5 text-xs font-medium disabled:opacity-50"><span className="truncate">{stage?.name ?? "Selecionar etapa"}</span><ChevronDown className="size-3.5 shrink-0" /></button><div className="border-t border-slate-100 mt-3 pt-3"><button disabled={disabled} onClick={() => workflow.open("move", conversation.id)} className="flex items-center gap-2 text-xs font-semibold text-primary disabled:opacity-50"><ArrowRightLeft className="size-3.5" />Mover para outro Kanban</button></div></div>
  return <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 text-[11px]"><Columns3 className="size-3.5 shrink-0 text-slate-400" /><span className="truncate text-slate-500">{pipeline?.name ?? (conversation.pipeline_id ? "Kanban indisponível" : "Sem Kanban")}</span><ChevronRight className="size-3 shrink-0 text-slate-400" /><strong className="truncate font-semibold text-slate-700">{stage?.name ?? "Sem etapa"}</strong><button disabled={disabled} className="ml-auto shrink-0 font-semibold text-primary disabled:opacity-50" onClick={() => workflow.open("stage", conversation.id)}>Alterar etapa</button></div>
}
