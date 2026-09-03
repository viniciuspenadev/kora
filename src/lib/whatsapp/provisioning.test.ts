import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks=vi.hoisted(()=>({rpc:vi.fn(),update:vi.fn(),getStatus:vi.fn(),createInstance:vi.fn(),setWebhook:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/auth',()=>({auth:vi.fn()}))
vi.mock('@/lib/crypto/secrets',()=>({encryptSecret:()=> 'encrypted'}))
vi.mock('@/lib/providers',()=>({getProvider:()=>mocks}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{rpc:mocks.rpc,from:()=>({update:mocks.update})}}))
import { autoProvisionWhatsApp } from './provisioning'
const id='77f8e166-c157-4acb-9213-0bf9f5d3d6dd'
const call=(verifyRemote=false)=>autoProvisionWhatsApp('tenant','teste','WhatsApp',{actorId:'admin',requestId:id,verifyRemote})
beforeEach(()=>{
  vi.resetAllMocks()
  vi.stubEnv('EVOLUTION_API_URL','https://evolution.example.test');vi.stubEnv('EVOLUTION_API_KEY','secret');vi.stubEnv('WEBHOOK_BASE_URL','https://kora.example.test')
  mocks.rpc.mockResolvedValue({data:{id,instance_name:'same-instance',webhook_secret:'same-secret',settings:{provisioning:'pending'}},error:null})
  mocks.update.mockReturnValue({eq:()=>({eq:()=>Promise.resolve({error:null})})})
  mocks.getStatus.mockResolvedValue({status:'disconnected'});mocks.setWebhook.mockResolvedValue({configured:true})
})
afterEach(()=>vi.unstubAllEnvs())
describe('recoverable QR provisioning',()=>{
  it('network uncertainty never creates a remote instance',async()=>{
    mocks.getStatus.mockRejectedValue(new Error('network timeout'))
    expect(await call()).toMatchObject({ok:false,instanceId:id});expect(mocks.createInstance).not.toHaveBeenCalled();expect(mocks.setWebhook).not.toHaveBeenCalled()
  })
  it('a timed-out create checks the same instance then confirms its webhook',async()=>{
    mocks.getStatus.mockRejectedValueOnce(new Error('Evolution API error 404: absent')).mockResolvedValueOnce({status:'disconnected'})
    mocks.createInstance.mockRejectedValue(new Error('timeout with possibly sensitive response'))
    expect(await call()).toMatchObject({ok:true,instanceId:id});expect(mocks.createInstance).toHaveBeenCalledTimes(1);expect(mocks.getStatus).toHaveBeenCalledTimes(2)
    expect(mocks.setWebhook).toHaveBeenCalledWith('https://kora.example.test/api/webhooks/evolution/same-secret')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({settings:{provisioning:'ready'}}))
  })
  it('a ready reservation whose remote instance disappeared is recreated and reconfigured',async()=>{
    mocks.rpc.mockResolvedValue({data:{id,instance_name:'same-instance',webhook_secret:'same-secret',settings:{provisioning:'ready'}},error:null})
    mocks.getStatus.mockRejectedValueOnce(new Error('Evolution API error 404: absent'))
    expect(await call(true)).toMatchObject({ok:true,instanceId:id});expect(mocks.createInstance).toHaveBeenCalledTimes(1);expect(mocks.setWebhook).toHaveBeenCalledTimes(1)
  })
  it('divergent webhook stays pending and provider details never leak',async()=>{
    mocks.setWebhook.mockRejectedValue(new Error('payload with secret'))
    const result=await call();expect(result.ok).toBe(false);expect(result.instanceId).toBe(id);expect(JSON.stringify(result)).not.toContain('secret')
    expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({settings:{provisioning:'ready'}}))
  })
})
