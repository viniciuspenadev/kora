import { afterEach, describe, expect, it, vi } from "vitest"
import { EvolutionProvider } from "./evolution-provider"
const provider=()=>new EvolutionProvider({evolution_url:'https://evolution.example.test',evolution_key:'test-key',instance_name:'new-test-instance'})
afterEach(()=>vi.unstubAllGlobals())
describe('new Evolution instance contract',()=>{
  it('sends explicit new instance defaults',async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({instance:{state:'close'}}));vi.stubGlobal('fetch',fetch)
    await provider().createInstance()
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({integration:'WHATSAPP-BAILEYS',qrcode:true,groupsIgnore:true,alwaysOnline:false,readMessages:false,readStatus:false,syncFullHistory:false,rejectCall:false})
  })
  it('verifies stored webhook settings instead of trusting POST success',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({enabled:true,url:'https://kora.example.test/webhook',events:['MESSAGES_UPSERT','MESSAGES_UPDATE','CONNECTION_UPDATE','QRCODE_UPDATED'],webhookByEvents:false,webhookBase64:false}));vi.stubGlobal('fetch',fetch)
    await expect(provider().setWebhook('https://kora.example.test/webhook')).resolves.toEqual({configured:true})
    expect(JSON.parse(fetch.mock.calls[0][1].body).webhook).toMatchObject({byEvents:false,base64:false})
    expect(fetch.mock.calls[1][0]).toContain('/webhook/find/new-test-instance')
  })
  it.each([{events:[]},{url:'https://other.example.test'},{webhookByEvents:true},{enabled:false}])('rejects divergent webhook configuration %j',async(patch)=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({enabled:true,url:'https://kora.example.test/webhook',events:['MESSAGES_UPSERT','MESSAGES_UPDATE','CONNECTION_UPDATE','QRCODE_UPDATED'],webhookByEvents:false,webhookBase64:false,...patch}));vi.stubGlobal('fetch',fetch)
    await expect(provider().setWebhook('https://kora.example.test/webhook')).rejects.toThrow('Webhook não confirmado')
  })
})
