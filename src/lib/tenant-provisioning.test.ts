import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),send:vi.fn()}))
vi.mock("server-only",()=>({}))
vi.mock("@/auth",()=>({auth:mocks.auth}))
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}))
vi.mock("@/lib/supabase",()=>({supabaseAdmin:{rpc:mocks.rpc}}))
vi.mock("@/lib/tenant-invitations",()=>({deliverOwnerInvite:mocks.send}))
import { createTenant } from "@/lib/actions/admin"

const request='f9290719-22e0-4531-93aa-124c67f5c800'
function form(mode='manual') {
  const fd=new FormData()
  Object.entries({request_id:request,name:'Empresa teste',slug:'empresa-teste',plan_id:'83825aaa-d4d8-40a6-b84e-e67426be88aa',
    owner_name:'Responsável',owner_email:'owner@example.test',owner_phone:'(11) 98765-4321',billing_mode:mode,access:mode==='manual'?'authorized':'plan'}).forEach(([k,v])=>fd.set(k,v))
  return fd
}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{id:request,isPlatformAdmin:true}});mocks.rpc.mockResolvedValue({data:{tenant_id:'new',invite_id:'invite',activated:true},error:null});mocks.send.mockResolvedValue(true)})
describe('Godmode account boundary',()=>{
  it('denies non-admin before database access',async()=>{mocks.auth.mockResolvedValue({user:{isPlatformAdmin:false}});await expect(createTenant(form())).rejects.toThrow('Acesso negado');expect(mocks.rpc).not.toHaveBeenCalled()})
  it.each(['manual','gateway'])('provisions %s through one transaction without accepting a password',async(mode)=>{
    const fd=form(mode);fd.set('owner_password','must-not-be-used')
    expect(await createTenant(fd)).toEqual({tenantId:'new',inviteSent:true})
    const args=mocks.rpc.mock.calls[0][1];expect(args.p_mode).toBe(mode);expect(args.p_phone).toBe('11987654321');expect(args.p_token).toMatch(/^[a-f0-9]{48}$/)
    expect(JSON.stringify(args)).not.toContain('must-not-be-used');expect(mocks.send).toHaveBeenCalledWith('new','invite')
  })
  it('same submitted payload has stable fingerprint and request identity',async()=>{await createTenant(form());await createTenant(form());expect(mocks.rpc.mock.calls[0][1].p_fingerprint).toBe(mocks.rpc.mock.calls[1][1].p_fingerprint);expect(mocks.rpc.mock.calls[1][1].p_request).toBe(request)})
  it('email failure returns created identity for recovery',async()=>{mocks.send.mockResolvedValue(false);expect(await createTenant(form())).toEqual({tenantId:'new',inviteSent:false})})
  it('definitive rejection allows editing and never sends invitation',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'P0001',message:'slug_unavailable'}});expect(await createTenant(form())).toMatchObject({canEdit:true});expect(mocks.send).not.toHaveBeenCalled()})
  it('uncertain failure preserves request and hides sensitive database details',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{code:'fetch_error',message:'secret owner@example.test'}});const r=await createTenant(form());expect(r.canEdit).toBe(false);expect(r.error).not.toContain('secret');expect(mocks.send).not.toHaveBeenCalled()})
  it('rejects gateway with manual access policy before provisioning',async()=>{const fd=form('gateway');fd.set('access','authorized');expect((await createTenant(fd)).error).toBeTruthy();expect(mocks.rpc).not.toHaveBeenCalled()})
})
