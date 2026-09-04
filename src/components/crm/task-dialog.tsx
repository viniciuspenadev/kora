"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { SimpleSelect } from "@/components/ui/select"
import { getManagedTask, taskHistory, taskAssignees, updateManagedTask, createManagedTask, type ManagedTask } from "@/lib/actions/task-management"
import type { TaskStatus } from "@/lib/crm/task-rules"

const field = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
const button = "h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-50"
const localInput = (iso: string | null) => iso ? new Date(Date.parse(iso) - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0,16) : ""
const labels: Record<string,string> = { created:"Criada", edited:"Editada", assigned:"Responsável alterado", rescheduled:"Reagendada", done:"Concluída", canceled:"Cancelada", reopened:"Reaberta" }

export function TaskDialog({ id, dealId, initialTitle = "", onClose, onChanged }: { id: string | null; dealId?: string; initialTitle?: string; onClose: () => void; onChanged: () => void }) {
  const [task,setTask] = useState<ManagedTask | null>(null)
  const [title,setTitle] = useState("")
  const [due,setDue] = useState("")
  const [owner,setOwner] = useState("")
  const [people,setPeople] = useState<{id:string;name:string}[]>([])
  const [events,setEvents] = useState<Awaited<ReturnType<typeof taskHistory>>>([])
  const [error,setError] = useState("")
  const [historyError,setHistoryError] = useState("")
  const [busy,setBusy] = useState(false)
  const saving = useRef(false)
  const [loading,setLoading] = useState(true)
  const historyLoading = useRef(false)
  const [historyBusy,setHistoryBusy] = useState(false)
  const [historyPage,setHistoryPage] = useState(0)
  const [more,setMore] = useState(false)
  useEffect(()=>{
    let active=true
    async function load() {
      try {
        const [record,users] = await Promise.all([id ? getManagedTask(id) : null, taskAssignees()])
        if(!active)return
        setTask(record); setTitle(record?.title ?? initialTitle); setDue(localInput(record?.due_at ?? null)); setOwner(record?.assigned_to ?? ""); setPeople(users)
      } catch(e) { if(active)setError(e instanceof Error ? e.message : "Não foi possível carregar.") }
      finally { if(active)setLoading(false) }
      if(id) try { const rows=await taskHistory(id); if(active){setEvents(rows);setMore(rows.length===30)} } catch { if(active)setHistoryError("Não foi possível carregar o histórico.") }
    }
    void load(); return()=>{active=false}
  },[id,initialTitle])
  async function save(status?: TaskStatus) {
    if(saving.current)return
    saving.current=true
    setBusy(true);setError("")
    try {
      const dueAt = task && due === localInput(task.due_at) ? task.due_at : due ? new Date(due).toISOString() : null
      const result = id && task ? await updateManagedTask(id, status ? {status} : {title,dueAt,...(owner?{assignedTo:owner}:{})},task.updated_at)
        : await createManagedTask({dealId,title,dueAt:due?new Date(due).toISOString():null,assignedTo:owner||undefined})
      if("error" in result){setError(result.error);return}
      onChanged();onClose()
    } catch { setError("Não foi possível salvar. Seus campos foram preservados.") } finally {saving.current=false;setBusy(false)}
  }
  async function loadMore() {
    if(!id||historyLoading.current)return
    historyLoading.current=true;setHistoryBusy(true);setHistoryError("")
    try { const rows=await taskHistory(id,historyPage+1);setEvents(prev=>[...prev,...rows]);setHistoryPage(p=>p+1);setMore(rows.length===30) }
    catch{setHistoryError("Não foi possível carregar mais registros.")}
    finally{historyLoading.current=false;setHistoryBusy(false)}
  }
  const editable=!id||!!task?.canEdit
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
    <DialogTitle>{id ? "Detalhes da tarefa" : "Nova tarefa"}</DialogTitle>
    <DialogDescription>{id ? "Prazo, responsável e histórico em um só lugar." : "Organize o próximo passo. Para vincular um negócio, crie a tarefa na ficha dele."}</DialogDescription>
    {loading?<p className="py-6 text-sm text-slate-500">Carregando tarefa…</p>:<>
      {task && <p className="text-xs text-slate-500">{task.status === "pending" ? "Pendente" : task.status === "done" ? "Concluída" : "Cancelada"} · {task.responsible ?? "Sem responsável"}</p>}
      <label className="space-y-1 text-xs font-medium">O que precisa ser feito?<input className={field} value={title} onChange={e=>setTitle(e.target.value)} disabled={!editable||busy} maxLength={240}/></label>
      <label className="space-y-1 text-xs font-medium">Prazo <span className="font-normal text-slate-500">(horário local, opcional)</span><input type="datetime-local" className={field} value={due} onChange={e=>setDue(e.target.value)} disabled={!editable||busy}/></label>
      {people.length>0&&<SimpleSelect ariaLabel="Responsável pela tarefa" value={owner} onChange={setOwner} disabled={!editable||busy} options={[...(!id?[{value:"",label:"Eu"}]:[]),...people.map(p=>({value:p.id,label:p.name}))]}/>}
      {task?.href && task.href!=="/tarefas" && <Link href={task.href} className="text-xs font-semibold text-primary" onClick={onClose}>Abrir {task.deal_id ? "negócio" : "contato"} →</Link>}
      {!editable&&task&&<p className="text-xs text-slate-500">Somente o responsável ou um administrador pode alterar.</p>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {editable&&<div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <button className={`${button} bg-primary text-white`} disabled={busy||!title.trim()} onClick={()=>save()}>{busy?"Salvando…":"Salvar"}</button>
        {task?.status==="pending" ? <><button className={button} disabled={busy} onClick={()=>save("done")}>Concluir</button><button className={button} disabled={busy} onClick={()=>save("canceled")}>Cancelar tarefa</button></> : task&&<button className={button} disabled={busy} onClick={()=>save("pending")}>Reabrir</button>}
      </div>}
      {id&&<section className="border-t border-slate-200 pt-4"><h3 className="mb-3 text-xs font-semibold">Histórico</h3>{historyError&&<p role="alert" className="text-xs text-red-700">{historyError}</p>}
        {!events.length&&!historyError&&<p className="text-xs text-slate-500">Nenhuma alteração registrada nesta versão.</p>}
        <ol className="space-y-3">{events.map(e=><li key={e.id} className="text-xs text-slate-600"><p className="font-medium text-slate-900">{labels[e.kind]??"Alterada"} · {e.actorName}</p><p>{new Date(e.created_at).toLocaleString("pt-BR")}</p>{e.before_state?.assigned_to !== e.after_state?.assigned_to && <p>Responsável: {e.previousOwner} → {e.nextOwner}</p>}{e.before_state?.title && e.before_state.title !== e.after_state?.title && <p>Título: {e.before_state.title} → {e.after_state.title}</p>}{e.before_state?.due_at !== e.after_state?.due_at &&<p>Prazo: {e.before_state?.due_at?new Date(e.before_state.due_at).toLocaleString("pt-BR"):"Sem prazo"} → {e.after_state?.due_at?new Date(e.after_state.due_at).toLocaleString("pt-BR"):"Sem prazo"}</p>}</li>)}</ol>
        {more&&<button className={`${button} mt-3`} disabled={historyBusy} onClick={loadMore}>{historyBusy?"Carregando…":"Ver mais alterações"}</button>}
      </section>}
    </>}
  </DialogContent></Dialog>
}
