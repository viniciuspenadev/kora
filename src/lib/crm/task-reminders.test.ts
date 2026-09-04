import { beforeEach, expect, it, vi } from "vitest"
const h=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),member:vi.fn(),access:vi.fn(),push:vi.fn(),module:vi.fn()}))
vi.mock("server-only",()=>({}))
vi.mock("@/lib/supabase",()=>({supabaseAdmin:{from:(...a:unknown[])=>h.from(...a),rpc:(...a:unknown[])=>h.rpc(...a)}}))
vi.mock("@/lib/modules",()=>({hasModule:(...a:unknown[])=>h.module(...a)}))
vi.mock("./task-access",()=>({taskMemberScope:(...a:unknown[])=>h.member(...a),taskContextAccess:(...a:unknown[])=>h.access(...a)}))
vi.mock("@/lib/push/send",()=>({sendPushToUsers:(...a:unknown[])=>h.push(...a)}))
import { runTaskReminderSweep } from "./task-reminders"
const task=(id:string,owner="active")=>({id,tenant_id:"tenant",title:"Ligar",due_at:"2026-09-03T10:00:00Z",assigned_to:owner,deal_id:"deal",contact_id:null,updated_at:"2026-09-03T09:00:00Z"})
function page(data:unknown[],error:unknown=null){const q:Record<string,unknown>={};for(const k of ["select","eq","is","not","lte","order","or"])q[k]=()=>q;q.limit=async()=>({data,error});return q}
beforeEach(()=>{vi.clearAllMocks();h.module.mockResolvedValue(true);h.member.mockResolvedValue({});h.access.mockResolvedValue(true);h.rpc.mockResolvedValue({data:"notice",error:null});h.push.mockResolvedValue(undefined)})
it("avança além de 500 destinatários inelegíveis",async()=>{h.from.mockReturnValueOnce(page(Array.from({length:500},(_,i)=>task(String(i),"inactive")))).mockReturnValueOnce(page([task("501")]));h.member.mockImplementation(async(_t,id)=>id==="inactive"?null:{});expect(await runTaskReminderSweep()).toEqual({notified:1,skipped:500});expect(h.from).toHaveBeenCalledTimes(2);expect(h.rpc).toHaveBeenCalledTimes(1)})
it("falha de insert não vira sucesso e permite retry pelo banco",async()=>{h.from.mockReturnValue(page([task("one")]));h.rpc.mockResolvedValue({data:null,error:{message:"offline"}});await expect(runTaskReminderSweep()).rejects.toThrow();expect(h.push).not.toHaveBeenCalled()})
it("corrida com tarefa reagendada não envia push",async()=>{h.from.mockReturnValue(page([task("one")]));h.rpc.mockResolvedValue({data:null,error:null});expect(await runTaskReminderSweep()).toEqual({notified:0,skipped:1});expect(h.push).not.toHaveBeenCalled()})
it("sem acesso à origem não cria aviso",async()=>{h.from.mockReturnValue(page([task("one")]));h.access.mockResolvedValue(false);expect(await runTaskReminderSweep()).toEqual({notified:0,skipped:1});expect(h.rpc).not.toHaveBeenCalled()})
it("push falhando mantém sucesso da notificação durável",async()=>{h.from.mockReturnValue(page([task("one")]));h.push.mockRejectedValue(new Error("offline"));expect(await runTaskReminderSweep()).toEqual({notified:1,skipped:0});expect(h.push).toHaveBeenCalledWith(["active"],expect.objectContaining({url:"/negocios/deal?tab=activity",tag:"task_due:one"}))})
