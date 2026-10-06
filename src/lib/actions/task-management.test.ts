import { beforeEach, describe, expect, it, vi } from "vitest"

const h=vi.hoisted(()=>({ scope:{tenantId:"tenant",userId:"agent",isAdmin:false,viewAll:false,supervisesDepartments:[] as string[]}, row:{id:"task",assigned_to:"agent",updated_at:"2026-09-03T10:00:00Z",deal_id:null,contact_id:null}, rpc:vi.fn(), gate:vi.fn(), member:vi.fn(), access:vi.fn(), from:vi.fn() }))
vi.mock("server-only",()=>({}))
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}))
vi.mock("@/lib/visibility",()=>({getViewerScope:async()=>h.scope}))
vi.mock("@/lib/modules",()=>({requireModule:()=>h.gate()}))
vi.mock("@/lib/supabase",()=>({supabaseAdmin:{from:(...a:unknown[])=>h.from(...a),rpc:(...a:unknown[])=>h.rpc(...a)}}))
vi.mock("@/lib/crm/task-access",()=>({taskMemberScope:(...a:unknown[])=>h.member(...a),taskContextAccess:(...a:unknown[])=>h.access(...a),taskContextIds:async()=>({all:false,contacts:["visible-contact"],deals:[]})}))
import { createManagedTask, updateManagedTask, listManagedTasks } from "./task-management"
import { validateTaskPatch } from "@/lib/crm/task-rules"

beforeEach(()=>{
  vi.clearAllMocks();h.scope={tenantId:"tenant",userId:"agent",isAdmin:false,viewAll:false,supervisesDepartments:[]};h.row={id:"task",assigned_to:"agent",updated_at:"2026-09-03T10:00:00Z",deal_id:null,contact_id:null}
  h.gate.mockResolvedValue(undefined);h.member.mockResolvedValue(h.scope);h.access.mockResolvedValue(true);h.rpc.mockResolvedValue({data:"task",error:null})
  h.from.mockImplementation(()=>{const q:Record<string,unknown>={};for(const k of ["select","eq","in","order","range"])q[k]=vi.fn(()=>q);q.maybeSingle=async()=>({data:h.row,error:null});return q})
})
describe("gestão: autorização e encaminhamento",()=>{
  it("bloqueia colega mesmo tendo visão geral",async()=>{h.scope.viewAll=true;h.row.assigned_to="other";expect(await updateManagedTask("task",{status:"done"})).toHaveProperty("error");expect(h.rpc).not.toHaveBeenCalled()})
  it("admin altera tarefa de outro mantendo CAS da tela",async()=>{h.scope.isAdmin=true;h.row.assigned_to="other";expect(await updateManagedTask("task",{status:"done"},"version-seen")).toEqual({ok:true});expect(h.rpc).toHaveBeenCalledWith("crm_task_mutate",expect.objectContaining({p_tenant:"tenant",p_actor:"agent",p_expected:"version-seen",p_patch:{status:"done"}}))})
  it("reagendamento não conclui ou troca responsável",async()=>{await updateManagedTask("task",{dueAt:"2026-10-10T12:00:00Z"});expect(h.rpc.mock.calls[0][1].p_patch).toEqual({due_at:"2026-10-10T12:00:00.000Z"})})
  it("erro de banco não retorna sucesso",async()=>{h.rpc.mockResolvedValue({error:{message:"Tarefa alterada por outra pessoa"}});expect(await updateManagedTask("task",{status:"done"})).toEqual({error:"Tarefa alterada por outra pessoa"})})
  it("nega módulo desligado",async()=>{h.gate.mockRejectedValue(new Error("CRM desativado"));expect(await updateManagedTask("task",{status:"done"})).toHaveProperty("error");expect(h.from).not.toHaveBeenCalled()})
  it("agente não atribui a terceiros",async()=>{expect(await createManagedTask({title:"Ligar",assignedTo:"00000000-0000-0000-0000-000000000001"})).toHaveProperty("error");expect(h.rpc).not.toHaveBeenCalled()})
  it("admin não atribui a membro inválido",async()=>{h.scope.isAdmin=true;h.member.mockResolvedValue(null);expect(await updateManagedTask("task",{assignedTo:"00000000-0000-0000-0000-000000000001"})).toHaveProperty("error");expect(h.rpc).not.toHaveBeenCalled()})
  it("admin não atribui a membro sem acesso à origem",async()=>{h.scope.isAdmin=true;h.access.mockResolvedValue(false);expect(await updateManagedTask("task",{assignedTo:"00000000-0000-0000-0000-000000000001"})).toHaveProperty("error");expect(h.rpc).not.toHaveBeenCalled()})
  it("recusa datas e status inválidos",()=>{expect(validateTaskPatch({dueAt:"amanhã"})).toBeTruthy();expect(validateTaskPatch({status:"invalid" as "done"})).toBeTruthy();expect(validateTaskPatch({dueAt:null,title:"Ligar"})).toBeNull()})
  it("listagem aplica dono e contexto antes de paginar no banco",async()=>{h.rpc.mockResolvedValue({data:{items:[],total:0},error:null});await listManagedTasks({scope:"team"});expect(h.rpc).toHaveBeenCalledWith("crm_task_list",expect.objectContaining({p_tenant:"tenant",p_owners:["agent"],p_all:false,p_contacts:["visible-contact"]}))})
  it("perder acesso ao contexto bloqueia alteração da própria tarefa",async()=>{h.access.mockResolvedValue(false);expect(await updateManagedTask("task",{status:"done"})).toHaveProperty("error");expect(h.rpc).not.toHaveBeenCalled()})
})
