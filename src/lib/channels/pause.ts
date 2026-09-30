import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { decryptSecret } from "@/lib/crypto/secrets"

/**
 * PAUSAR OS CANAIS DE ENTRADA DE UM TENANT — server-only, **não é Server Action**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 O BURACO QUE ISTO FECHA (medido em produção, 2026-08-12)
 * ═══════════════════════════════════════════════════════════════════════════
 * *Bernardo Concept* estava `suspended` + `active=false` **com a instância baileys
 * CONECTADA**. A cascata de suspensão revogava sessão, token, push e a assinatura no
 * gateway — tudo que dá ACESSO e tudo que gera COBRANÇA — e não encostava no canal.
 *
 * O efeito: clientes finais mandavam mensagem para um número que **atendia**, o webhook
 * descartava por `canAccess` (evolution/[secret]/route.ts:77), e a mensagem sumia. Ninguém
 * era avisado — nem o remetente, que via "entregue", nem o dono do número. E a instância
 * seguia custando na Evolution.
 *
 * 🔑 A DISTINÇÃO QUE ESTE MÓDULO EXISTE PRA FAZER: **pausar o canal ≠ descartar o inbound.**
 *    Pausado, o remetente recebe sinal real e nada é destruído. Descartando, o cliente do
 *    nosso cliente fala com o vazio — e quem é punido não é o inadimplente, é um terceiro
 *    que não deve nada e nem sabe que a Kora existe.
 *    A escada estava invertida: o degrau 5 (encerramento) RETÉM o dado, e o 4 o DESTRUÍA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ PAUSAR ≠ REVOGAR — e a diferença é a credencial
 * ═══════════════════════════════════════════════════════════════════════════
 * Verificado na doc da Meta (12/08): `DELETE /{WABA_ID}/subscribed_apps` *"stops all webhook
 * deliveries for this WABA"*, imediato e **só daquela WABA**. Não encosta em registro de
 * número, PIN de duas etapas, templates nem na WABA. **É uma torneira, não uma fechadura.**
 *
 * Por isso este módulo **PRESERVA o token**: a volta é um `POST` nosso, sem o cliente tocar
 * em nada. Apagá-lo obrigaria a refazer o Embedded Signup — que exige **admin do Business
 * Manager** daquela WABA. No modelo de agência (4 de 5 tenants) quem paga e quem tem esse
 * acesso frequentemente não são a mesma pessoa, e a reconexão passaria a depender de um
 * terceiro que nunca recebeu a cobrança.
 *
 * Revogar de verdade (`DELETE /{user-id}/permissions`) é o verbo do CLIENTE ("não quero
 * mais") e do encerramento — não o da cobrança. Ver docs/billing-paywall-escalation-design.md §4.
 *
 * ⚠️ **Baileys é a exceção e não há como evitar:** o provider só expõe `logout` e `restart`
 *    (evolution-provider.ts:80) — não existe pausa não-destrutiva. `logout` mata a sessão,
 *    então a volta **exige QR**. Quem chama precisa avisar o cliente ANTES do corte.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v25.0"}`

/** Por que o canal está sendo pausado. Vai pra trilha — ver `pendencias` sobre a coluna. */
export type MotivoPausa = "suspensao" | "cobranca" | "encerramento"

export interface ResultadoPausa {
  /** Canais efetivamente pausados. */
  pausados: { canal: string; instancia: string }[]
  /** Falhou — o chamador NÃO desfaz a transição, mas isto tem que aparecer na trilha. */
  falhas: { canal: string; instancia: string; erro: string }[]
  /**
   * Canais que este módulo ainda **não sabe** pausar. Nunca fica vazio por omissão: um canal
   * sem método aparece aqui, não some. Ver o bloco do Instagram abaixo.
   */
  pendentes: { canal: string; instancia: string; motivo: string }[]
}

/**
 * Pausa todos os canais de ENTRADA do tenant.
 *
 * ⚠️ **Best-effort, e nunca lança** — segue o contrato da cascata de `transitionLifecycleCore`:
 *    o estado já foi escrito e o acesso já caiu; segurar a transição porque um provedor não
 *    respondeu trocaria um problema por outro maior. Falha vira linha em `falhas`, que o
 *    chamador põe na trilha.
 */
export async function pausarCanaisDoTenant(
  tenantId: string,
  motivo: MotivoPausa,
): Promise<ResultadoPausa> {
  const out: ResultadoPausa = { pausados: [], falhas: [], pendentes: [] }

  // ── WhatsApp (baileys + meta_cloud) ────────────────────────────────────────
  const { data: instancias, error: erroInst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, provider, status, instance_name, evolution_url, evolution_key, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", tenantId)

  if (erroInst) {
    // 🔴 Erro de leitura NÃO vira "nenhuma instância". Foi assim que uma coluna inexistente
    //    fez um card sumir por meses (subscription-view, 12/08): `data:null` → `?? []` →
    //    silêncio. Aqui o silêncio significaria "não havia canal pra pausar", que é
    //    exatamente a conclusão errada.
    out.falhas.push({ canal: "whatsapp", instancia: "-", erro: `leitura: ${erroInst.message}` })
    return out
  }

  for (const inst of (instancias ?? []) as InstanciaRow[]) {
    // Já desconectada = nada a fazer. Não é falha nem pendência.
    if (inst.status === "disconnected" || inst.status === "revoked") continue

    const canal = inst.provider ?? "baileys"
    try {
      if (canal === "meta_cloud") await pausarWaba(inst)
      else                        await getProvider(inst).logout()

      // ⚠️ `status` só muda DEPOIS do provedor confirmar. Marcar antes faria o banco afirmar
      //    um desligamento que talvez não aconteceu — e um canal "desconectado" no banco e
      //    vivo na Meta é precisamente o estado do Bernardo, escrito de propósito.
      const { error } = await supabaseAdmin.from("whatsapp_instances")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("id", inst.id)
      if (error) throw new Error(`banco: ${error.message}`)

      out.pausados.push({ canal, instancia: inst.id })
    } catch (e) {
      out.falhas.push({ canal, instancia: inst.id, erro: (e as Error).message })
    }
  }

  // ── Instagram ──────────────────────────────────────────────────────────────
  // 🔴 AINDA NÃO SEI PAUSAR, E DIGO ISSO EM VEZ DE FINGIR. A doc da Meta para Instagram
  //    Business Login afirma *"Account level webhooks customization is not supported"* e não
  //    confirma o comportamento de `DELETE /me/subscribed_apps` por conta. Enquanto não for
  //    validado ao vivo (item 0.1 do desenho), este módulo NÃO chama nada.
  // ⚠️ E de propósito NÃO faço o revoke local que `disconnectInstagramAccount` faz: apagar o
  //    token local pára de RESPONDER mas não pára de RECEBER — a mensagem continua chegando e
  //    sendo descartada. Isso é o padrão Bernardo com outro nome, e o objetivo deste módulo é
  //    justamente sair dele. Melhor um canal declaradamente pendente do que um "pausado" que
  //    segue destruindo mensagem em silêncio.
  const { data: igs } = await supabaseAdmin
    .from("channel_connections")
    .select("id, external_account_id")
    .eq("tenant_id", tenantId).eq("channel", "instagram").eq("status", "active")

  for (const ig of (igs ?? []) as { id: string; external_account_id: string | null }[]) {
    out.pendentes.push({
      canal: "instagram", instancia: ig.id,
      motivo: "metodo-de-desassinatura-nao-validado — ver desenho §4.4 item 0.1",
    })
  }

  // ── Site ───────────────────────────────────────────────────────────────────
  // Nada a fazer, e isso é correto: `/api/site/config/[slug]` devolve `enabled:false` via
  // `isTenantServiceable`, e o script no site do cliente simplesmente não renderiza. Desliga
  // sozinho já no degrau 2, e falha no BOOTSTRAP em vez de a cada interação — o visitante do
  // cliente nunca vê um chat quebrado.

  console.log(JSON.stringify({
    src: "channels", kind: "canais-pausados", tenant: tenantId, motivo,
    pausados: out.pausados.length, falhas: out.falhas.length, pendentes: out.pendentes.length,
  }))

  return out
}

/**
 * Canais que ficaram DERRUBADOS quando o tenant volta a ser servível.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 A REGRESSÃO QUE ISTO COBRE — e ela foi CRIADA por `pausarCanaisDoTenant`
 * ═══════════════════════════════════════════════════════════════════════════
 * Antes de a pausa existir, suspender não encostava no canal ⇒ reativar restaurava tudo
 * sozinho. Depois dela: suspende → canal derrubado → **reativa → o canal continua morto**.
 * O dono entra, a conta está ativa, a tela diz "tudo certo", e nenhuma mensagem chega.
 * Trocaríamos um silêncio (mensagem destruída) por outro (canal morto sem aviso).
 *
 * 🔴 POR QUE ISTO **NÃO** RELIGA SOZINHO — e não é preguiça:
 *    `whatsapp_instances.status = 'disconnected'` não diz **QUEM** desligou. A mesma linha
 *    descreve "a cobrança derrubou" e "o cliente clicou em desconectar". Religar sem
 *    distinguir os dois faria a Kora **se re-autorizar sozinha na conta de alguém que pediu
 *    para sair** — o pior erro possível nesta superfície, e o que o §4.5 do desenho proíbe.
 * 🔑 A volta automática exige o MOTIVO carimbado (item 3 do desenho). Até lá, o certo é
 *    **avisar**: quem decide reconectar é gente, com a informação na mão.
 * ⚠️ E no baileys a volta nunca será automática de qualquer forma — `logout` mata a sessão,
 *    então exige QR. Ver o cabeçalho deste módulo.
 */
export async function canaisDerrubados(tenantId: string): Promise<{
  canal: string; instancia: string; precisaQr: boolean
}[]> {
  const fora: { canal: string; instancia: string; precisaQr: boolean }[] = []

  const { data, error } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, provider, status")
    .eq("tenant_id", tenantId)
    .eq("status", "disconnected")

  // ⚠️ Erro aqui NÃO vira lista vazia — vira uma linha que grita. "Não consegui perguntar" e
  //    "está tudo conectado" são conclusões opostas, e a segunda é a que cala.
  if (error) {
    console.error(JSON.stringify({
      src: "channels", kind: "CANAIS-DERRUBADOS-NAO-LIDOS", tenant: tenantId, msg: error.message,
    }))
    return [{ canal: "?", instancia: "?", precisaQr: false }]
  }

  for (const inst of (data ?? []) as { id: string; provider: string | null }[]) {
    const canal = inst.provider ?? "baileys"
    fora.push({ canal, instancia: inst.id, precisaQr: canal !== "meta_cloud" })
  }
  return fora
}

interface InstanciaRow {
  id: string
  provider: string | null
  status: string | null
  instance_name: string | null
  evolution_url: string | null
  evolution_key: string | null
  meta_phone_number_id: string | null
  meta_business_account_id: string | null
  meta_access_token: string | null
  meta_app_secret: string | null
}

/**
 * Desassina o app da WABA — o webhook daquela conta para na hora.
 *
 * 🔴 A ORDEM É A REGRA: o token é o que AUTENTICA a desassinatura. Quem apagasse a credencial
 *    antes faria este `fetch` falhar — e em `disconnectWhatsAppOfficial` ele vive dentro de um
 *    `try/catch` vazio, então "falhou" e "deu certo" terminam iguais. O tenant ficaria
 *    assinado para sempre, recebendo e descartando.
 * 🔑 Por isso aqui a resposta é **conferida**, não ignorada. Para o botão do cliente um
 *    best-effort mudo passa (ele vê a tela e reclama); para uma rotina automática que roda sem
 *    ninguém olhando, não existe "provavelmente desassinou".
 */
async function pausarWaba(inst: InstanciaRow): Promise<void> {
  const token = decryptSecret(inst.meta_access_token)
  if (!token || !inst.meta_business_account_id) {
    throw new Error("sem token ou WABA id — impossível desassinar")
  }

  const res = await fetch(`${GRAPH}/${inst.meta_business_account_id}/subscribed_apps`, {
    method:  "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`meta ${res.status}: ${body.slice(0, 200)}`)

  // A Meta responde `{"success": true}`. Um 200 com `success:false` é recusa silenciosa.
  if (body && !/"success"\s*:\s*true/.test(body)) {
    throw new Error(`meta recusou: ${body.slice(0, 200)}`)
  }

  // ⚠️ `meta_access_token` NÃO é apagado — ver o cabeçalho. A volta é um POST nosso.
}
