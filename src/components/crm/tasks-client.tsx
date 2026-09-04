"use client"
import { useEffect, useState } from "react"
import { listManagedTasks, taskAssignees, type ManagedTask } from "@/lib/actions/task-management"
import { TaskDialog } from "./task-dialog"
import { SimpleSelect } from "@/components/ui/select"
import { PageShell } from "@/components/ui/page-shell"
import type { TaskStatus } from "@/lib/crm/task-rules"

export function TasksClient() {
  const [scope,setScope]=useState<"me"|"team">("me")
  const [status,setStatus]=useState<TaskStatus|"all">("pending")
  const [timing,setTiming]=useState("")
  const [owner,setOwner]=useState("")
  const [people,setPeople]=useState<{id:string;name:string}[]>([])
  const [from,setFrom]=useState("")
  const [to,setTo]=useState("")
  const [page,setPage]=useState(0)
  const [refresh,setRefresh]=useState(0)
  const [data,setData]=useState<Awaited<ReturnType<typeof listManagedTasks>>|null>(null)
  const [resolvedKey,setResolvedKey]=useState("")
  const [now,setNow]=useState(0)
  const requestKey=JSON.stringify([scope,status,owner,timing,from,to,page,refresh])
  const loading=resolvedKey!==requestKey
  const [error,setError]=useState("")
  const [dialog,setDialog]=useState<{id:string|null}|null>(null)
  useEffect(()=>{void taskAssignees(true).then(setPeople).catch(()=>{})},[])
  useEffect(()=>{
    let active=true
    listManagedTasks({scope,status,ownerId:owner||undefined,timing:timing as "overdue"|"undated"|undefined,
      from:from?new Date(`${from}T00:00:00`).toISOString():undefined,to:to?new Date(`${to}T23:59:59.999`).toISOString():undefined,page})
      .then(result=>{if(active){setData(result);setError("");setNow(Date.now())}}).catch(()=>{if(active)setError("Não foi possível carregar as tarefas. Tente novamente.")}).finally(()=>{if(active)setResolvedKey(requestKey)})
    return()=>{active=false}
  },[scope,status,owner,timing,from,to,page,refresh,requestKey])
  const reset=()=>setPage(0)
  const row=(t:ManagedTask)=><button key={t.id} onClick={()=>setDialog({id:t.id})} className="grid w-full gap-2 border-b border-slate-100 px-4 py-4 text-left hover:bg-slate-50 md:grid-cols-[2fr_1fr_1fr_100px] md:items-center">
    <div><p className="text-sm font-semibold text-slate-900">{t.title}</p><p className="mt-1 text-xs text-slate-500">{t.deal_id?"Negócio":t.contact_id?"Contato":"Tarefa interna"}</p></div>
    <p className="text-xs text-slate-600">{t.responsible??"Sem responsável"}</p>
    <p className={`text-xs ${t.status==="pending"&&t.due_at&&Date.parse(t.due_at)<now?"text-red-700":"text-slate-600"}`}>{t.due_at?new Date(t.due_at).toLocaleString("pt-BR"):"Sem prazo"}</p>
    <span className="text-xs text-slate-600">{t.status==="pending"?"Pendente":t.status==="done"?"Concluída":"Cancelada"}</span>
  </button>
  return <PageShell variant="list" title="Gestão de tarefas" description="Distribua responsabilidades e acompanhe prazos e histórico." actions={<button className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white" onClick={()=>setDialog({id:null})}>Nova tarefa</button>}>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
        <SimpleSelect className="w-full sm:w-44" ariaLabel="Visão de tarefas" value={scope} onChange={v=>{setScope(v as "me"|"team");setOwner("");reset()}} options={[{value:"me",label:"Minhas tarefas"},...(data?.canSeeTeam?[{value:"team",label:"Equipe"}]:[])]}/>
        <SimpleSelect className="w-full sm:w-44" ariaLabel="Situação das tarefas" value={status} onChange={v=>{setStatus(v as TaskStatus|"all");reset()}} options={[{value:"pending",label:"Pendentes"},{value:"done",label:"Concluídas"},{value:"canceled",label:"Canceladas"},{value:"all",label:"Todas as situações"}]}/>
        <SimpleSelect className="w-full sm:w-44" ariaLabel="Filtro de prazo" value={timing} onChange={v=>{setTiming(v);reset()}} options={[{value:"",label:"Todos os prazos"},{value:"overdue",label:"Atrasadas"},{value:"undated",label:"Sem prazo"}]}/>
        {scope==="team"&&people.length>0&&<SimpleSelect className="w-full sm:w-44" ariaLabel="Filtrar responsável" value={owner} onChange={v=>{setOwner(v);reset()}} options={[{value:"",label:"Todos os responsáveis"},...people.map(p=>({value:p.id,label:p.name}))]}/>}
        <label className="text-xs text-slate-500">De<input aria-label="Prazo inicial" type="date" value={from} onChange={e=>{setFrom(e.target.value);reset()}} className="ml-2 h-9 rounded-lg border border-slate-200 px-2"/></label>
        <label className="text-xs text-slate-500">Até<input aria-label="Prazo final" type="date" value={to} onChange={e=>{setTo(e.target.value);reset()}} className="ml-2 h-9 rounded-lg border border-slate-200 px-2"/></label>
      </div>
      <div className="hidden grid-cols-[2fr_1fr_1fr_100px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 md:grid"><span>Tarefa / origem</span><span>Responsável</span><span>Prazo</span><span>Situação</span></div>
      {error&&!loading?<div role="alert" className="p-8 text-sm text-red-700">{error}<button className="ml-3 underline" onClick={()=>setRefresh(v=>v+1)}>Tentar novamente</button></div>:loading?<p className="p-8 text-sm text-slate-500">Carregando tarefas…</p>:data?.items.length?data.items.map(row):<div className="p-10 text-center"><p className="font-semibold text-slate-900">Nenhuma tarefa nesta seleção</p><p className="mt-1 text-sm text-slate-500">Ajuste os filtros ou crie o próximo passo.</p></div>}
      <footer className="flex items-center justify-between gap-3 p-4 text-xs text-slate-500"><span>{data?.total??0} {(data?.total??0)===1?"tarefa":"tarefas"} nesta seleção</span><div className="flex items-center gap-3"><button disabled={loading||page===0} onClick={()=>setPage(p=>p-1)} className="disabled:opacity-40">Anterior</button><span>Página {page+1}</span><button disabled={loading||(page+1)*30>=(data?.total??0)} onClick={()=>setPage(p=>p+1)} className="disabled:opacity-40">Próxima</button></div></footer>
    </section>{dialog&&<TaskDialog key={dialog.id??"new"} id={dialog.id} onClose={()=>setDialog(null)} onChanged={()=>setRefresh(v=>v+1)}/>}
  </PageShell>
}
