import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({auth:async()=>null}))
const db=new MemoryDb()
vi.mock("@/lib/supabase", () => ({supabaseAdmin:db}))
vi.mock("@/lib/llm/active", () => ({tenantAiActive:async()=>true}))
vi.mock("@/lib/ai-v2/dispatch", () => ({channelDispatchesAI:()=>true}))
vi.mock("@/lib/atendimento/events", () => ({logConversationEvent:async()=>{}}))
const {bumpConversationInbound}=await import("./inbound-bump")
const conv=()=>db.tables.chat_conversations[0]
const input={tenantId:"t",conversationId:"c",preview:"Olá"}
beforeEach(()=>{
  vi.restoreAllMocks(); vi.spyOn(console,"error").mockImplementation(()=>{})
  db.reset({chat_conversations:[{id:"c",tenant_id:"t",contact_id:"contact",instance_id:"n",channel:"whatsapp",
    unread_count:0,status:"open",metadata:{keep:true},updated_at:"2026-01-01T00:00:00Z",
    ai_handling:false,assigned_to:"agent",last_inbound_at:"2026-01-01T00:00:00Z"}],
    chat_contacts:[{id:"contact",tenant_id:"t"}],studio_flow_runs:[]})
})
it("mensagem sobe no inbox com contador e âncora do transporte",async()=>{
  await bumpConversationInbound({...input,lastInboundAt:"2026-02-01T00:00:00Z"})
  expect(conv()).toMatchObject({unread_count:1,last_message_preview:"Olá",last_message_dir:"in",last_inbound_at:"2026-02-01T00:00:00Z"})
})
it("formulário preserva janela do WhatsApp e mescla metadados",async()=>{
  await bumpConversationInbound({...input,touchWindow:false,metadata:{lead:true}})
  expect(conv().last_inbound_at).toBe("2026-01-01T00:00:00Z")
  expect(conv().metadata).toEqual({keep:true,lead:true}); expect(conv().unread_count).toBe(1)
})
it.each(["open","pending","snoozed"])("preserva status %s",async status=>{
  conv().status=status
  await bumpConversationInbound(input)
  expect(conv().status).toBe(status); expect(conv().unread_count).toBe(1)
})
it("dois recebimentos concorrentes não perdem incremento",async()=>{
  await Promise.all([bumpConversationInbound(input),bumpConversationInbound(input)])
  expect(conv().unread_count).toBe(2)
})
it("resolução durante CAS obriga reabertura completa",async()=>{
  let once=true
  db.beforeWrite=(table,patch)=>{if(once&&table==="chat_conversations"&&patch.unread_count){once=false;conv().status="resolved";conv().metadata={ai_routed:{via:"manual"}}}}
  await bumpConversationInbound(input)
  expect(conv()).toMatchObject({status:"open",assigned_to:null,ai_handling:true,unread_count:1})
  expect(conv().metadata.attendance_cycle).toBeTypeOf("string"); expect(conv().metadata.ai_routed).toBeUndefined()
})
it("contagem nula inicia em um",async()=>{
  conv().unread_count=null
  await bumpConversationInbound(input)
  expect(conv().unread_count).toBe(1)
})
it("outro tenant não é atualizado",async()=>{
  await bumpConversationInbound({...input,tenantId:"foreign"})
  expect(conv().unread_count).toBe(0)
})
it("erro de banco é registrado sem invalidar a mensagem já recebida",async()=>{
  db.errors.chat_conversations="offline"
  await expect(bumpConversationInbound(input)).resolves.toBeUndefined()
  expect(console.error).toHaveBeenCalled(); expect(conv().unread_count).toBe(0)
})
it("contenção persistente tem limite e erro observável",async()=>{
  db.beforeWrite=(table)=>{if(table==="chat_conversations")conv().unread_count++}
  await bumpConversationInbound(input)
  expect(db.writes).toHaveLength(8)
  expect(console.error).toHaveBeenCalledWith("[inbound-bump]",expect.stringContaining("concorrida"))
})
it("formulário não abre janela no caller nem nas mensagens",()=>{
  const source=readFileSync(join(process.cwd(),"src/app/api/site/lead/route.ts"),"utf8")
  expect(source).toMatch(/touchWindow:\s*false/)
  expect(source).toMatch(/counts_for_window:\s*false/)
})

describe("toda porta de entrada usa a fonte única", () => {
  // Este teste lê o FONTE de propósito. A regra que ele protege não é uma função —
  // é "não existe uma cópia divergente".
  //
  // 🔴 A VERSÃO ANTERIOR DESTE TESTE FALHOU NO PRÓPRIO PROPÓSITO. Ela listava QUATRO
  //    portas na mão e se dizia guardiã contra "uma 5ª cópia" — enquanto a 5ª
  //    (`/api/site/message`, o webchat) já existia, divergente, deployada. Uma lista
  //    escrita à mão só protege contra o que quem a escreveu lembrou de listar.
  //    Medido quando finalmente foi olhada: 35 de 35 conversas de site com mensagem
  //    de cliente e ZERO bolinha azul, porque aquela cópia não somava `unread_count`.
  //
  // ✅ Agora a lista é DERIVADA: quem insere mensagem de cliente É uma porta de
  //    entrada, por definição. Uma 6ª porta nasce coberta — ou reprova aqui.
  const RAIZ = join(process.cwd(), "src")

  function arquivosQueInseremMensagemDeCliente(dir: string): string[] {
    const achados: string[] = []
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name)
      if (entrada.isDirectory()) { achados.push(...arquivosQueInseremMensagemDeCliente(caminho)); continue }
      if (!/\.tsx?$/.test(entrada.name) || /\.test\.tsx?$/.test(entrada.name)) continue
      const src = readFileSync(caminho, "utf8")
      if (/sender_type:\s*"contact"/.test(src)) achados.push(caminho)
    }
    return achados
  }

  const ENTRADAS = arquivosQueInseremMensagemDeCliente(RAIZ)

  it("acha as portas de entrada pelo que elas FAZEM, não por uma lista", () => {
    // Se este número cair, alguém removeu uma porta — ou quebrou a varredura.
    expect(ENTRADAS.length).toBeGreaterThanOrEqual(5)
  })

  it.each(ENTRADAS)("%s chama bumpConversationInbound", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).toContain("bumpConversationInbound")
  })

  it.each(ENTRADAS)("%s não soma a não-lida em JavaScript", (arquivo) => {
    // Pega `unread_count: (x ?? 0) + 1` em qualquer forma. O INSERT de conversa
    // nova (`unread_count: 1`) é legítimo — ali não há valor anterior pra perder.
    expect(readFileSync(arquivo, "utf8")).not.toMatch(/unread_count:\s*[^,\n]*\+\s*1/)
  })

  it.each(ENTRADAS)("%s não faz UPDATE artesanal da linha do inbox", (arquivo) => {
    // 🔴 O defeito exato da 5ª porta: ela chamava `.update({ last_message_dir: "in" })`
    //    à mão, e o que faltava no objeto (não-lida, reabertura) sumia em silêncio.
    //    Quem escreve a direção do inbound tem que ser a fonte única, não o caller.
    expect(readFileSync(arquivo, "utf8")).not.toMatch(/last_message_dir:\s*"in"/)
  })
})

describe("opt-out de campanha vale nos dois números do tenant", () => {
  // 🔴 `marketing_opt_in` mora no CONTATO, e o contato é o mesmo no número oficial e
  //    no Baileys. Enquanto isto existiu só no canal oficial, quem respondia "SAIR"
  //    pro outro número continuava recebendo campanha — descadastro ignorado.
  it.each([
    ["lib/channels/meta-inbound.ts",        "WhatsApp Oficial"],
    ["app/api/webhooks/evolution/route.ts", "Baileys"],
  ])("%s (%s) trata o inbound de campanha", (arquivo) => {
    const src = readFileSync(join(process.cwd(), "src", arquivo), "utf8")
    expect(src).toContain("handleCampaignInbound")
  })
})
