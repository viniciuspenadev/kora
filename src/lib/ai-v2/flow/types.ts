// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — tipos do FLOW (grafo raso + estado)
// ═══════════════════════════════════════════════════════════════
// Grafo = nós + arestas (jsonb tipado em studio_flows.graph). Raso de
// propósito (doc §3). O runtime caminha do `start` até esperar input
// (menu), encaminhar, ou terminar. Estado por conversa em studio_flow_runs.

import type { AgendaBinding } from "../capabilities/types"

export type FlowNodeType =
  | "start"      // entrada
  | "message"    // envia texto e avança (suporta {{variavel}})
  | "send_media" // envia mídia (imagem/vídeo/áudio/doc) por URL e avança
  | "menu"       // pergunta com opções — ESPERA resposta, ramifica
  | "condition"  // checa um fato do contato — ramifica true/false
  | "set_variable"   // define uma ou mais variáveis (em-memória) e avança
  | "switch"         // compara uma variável e ramifica por valor (N casos + senão)
  | "business_hours" // ramifica conforme horário comercial (aberto/fechado)
  | "wait"           // pausa o fluxo por um tempo — acordado por cron (resume_at)
  | "http"       // chama uma API externa, guarda a resposta numa variável
  | "collect"    // pergunta, ESPERA a resposta, guarda numa variável (tipado)
  | "schedule"   // AGENDAR determinístico (zero token): oferta → ESPERA → marca; ramifica agendado/sem_horario
  | "ai_agent"   // a IA conduz a etapa, extrai dados e DEVOLVE o controle (§11.3)
  | "data_source" // FONTE DE CONSULTA (read-only) conectada ao Agente IA — governança campo-a-campo (docs/studio-data-source-node-design.md)
  | "ai_router"  // a IA classifica a intenção e ramifica (§11.4)
  | "call_flow"  // chama outro fluxo (sub-fluxo que volta, ou "ir para") (§11.2)
  | "template"   // envia um TEMPLATE aprovado (Meta oficial) e avança — abre janela/re-engaja
  | "outreach"   // DISPARA no WhatsApp pro número do contato (cross-canal: site→WhatsApp) — ramifica enviado/sem_whatsapp/bloqueado
  | "tag"        // adiciona/remove etiqueta no contato e avança
  | "move_stage" // move a conversa de etapa no pipeline e avança
  | "assign"     // distribui a conversa (round-robin) — ramifica atribuído/pool
  | "transfer"   // encaminha pra departamento — terminal
  | "resolve"    // CONCLUI a conversa (status=resolved) e encerra — terminal
  | "return"     // volta ao fluxo que chamou (pop); na raiz, encerra (§11.5)
  | "end"        // encerra o fluxo

export interface FlowNode {
  id:        string
  type:      FlowNodeType
  config:    Record<string, unknown>
  /** Layout do canvas (editor). O runtime IGNORA — é só pra desenhar. */
  position?: { x: number; y: number }
}

export interface FlowEdge {
  from:    string
  to:      string
  /** menu: id da opção · condition: "true"|"false" · default: ausente */
  branch?: string
}

export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** Orientação do canvas (editor). O runtime IGNORA — vertical (default) ou horizontal. */
  orientation?: "vertical" | "horizontal"
}

// ── Config tipada por nó (lida via `as unknown as X` + validação) ──
export interface MessageNodeConfig {
  text: string
  /**
   * Formato rico (texto · imagem · botões · cartão) — o MESMO objeto do direct de abertura.
   * Quando existe, VENCE o `text`.
   *
   * ⚠️ ADITIVO: nó salvo antes disto não tem o campo e segue pelo `text` puro, byte a byte
   *    igual ao de antes. O compositor grava os DOIS (o `text` recebe o texto) — mesmo
   *    padrão do gatilho de comentário (`dm` × `dmRich`), pelo mesmo motivo: durante um
   *    deploy a versão anterior do app ainda lê a coluna antiga.
   *
   * 🔴 **Botão de resposta faz o nó ESPERAR e RAMIFICAR** (uma saída por botão + a saída
   *    "Escreveu"). Não há caixinha de "esperar resposta?": pôr um botão de resposta já é
   *    dizer que espera. Botão de LINK não espera nem ramifica — o toque abre o navegador e
   *    não devolve evento nenhum.
   */
  rich?: RichMessage
}
export interface SendMediaNodeConfig {
  url:       string
  mediaType: "image" | "audio" | "video" | "document"
  caption?:  string
}
/** Como renderizar as opções de um nó interativo (Menu/Agendar):
 *  • auto (default): botões nativos (≤3) / lista (4+) no Meta; numerado no Baileys.
 *  • interactive: força o interativo nativo (no Baileys, sem suporte, cai p/ numerado).
 *  • numbered: SEMPRE texto numerado, inclusive no Meta ("digite o número"). */
export type RenderMode = "auto" | "interactive" | "numbered"

export interface MenuNodeConfig {
  text:     string
  options:  { id: string; label: string }[]
  noMatch?: string
  /** Estilo de exibição das opções (default auto). */
  render?:  RenderMode
}
export type ConditionCheck =
  | "has_email" | "has_phone" | "has_name" | "has_document" | "has_company"
  | "lifecycle_is"  // contato.lifecycle == value (novo/lead/cliente/…)
  | "has_tag"       // contato tem a etiqueta `value`
  | "channel_is"    // conversa veio do canal `value`
  // "É novo × É da casa" (owner: "da casa = já está na base", inclui importado).
  // NOVO ⇔ o contato NASCEU junto do disparo deste run — régua congelada em
  // variables.__run_started_at (gravada no startFlowRunAt; sobrescrita a cada novo
  // disparo na conversa). docs/studio-client-awareness-design.md §2.
  | "is_new_contact"
export interface ConditionNodeConfig {
  check:  ConditionCheck
  /** Parâmetro pros checks que precisam (lifecycle/etiqueta/canal). */
  value?: string
}
export interface SetVariableNodeConfig {
  /** Pares chave→valor. O value aceita {{outraVar}} (interpolado). */
  assignments: { key: string; value: string }[]
}
export interface SwitchNodeConfig {
  /** O que comparar: variável de fluxo (default) · canal · lifecycle. */
  source?:  "variable" | "channel" | "lifecycle"
  /** Nome da variável a comparar (quando source=variable; suporta a.b.c). */
  variable: string
  /** Cada caso = uma saída (id = handle). Compara por igualdade case-insensitive. */
  cases:    { id: string; equals: string }[]
}
export interface BusinessHoursNodeConfig {
  /** Dias úteis (0=domingo … 6=sábado). */
  days:      number[]
  /** "HH:MM" — abertura e fechamento. */
  open:      string
  close:     string
  /** Fuso IANA (default America/Sao_Paulo). */
  timezone?: string
}
export interface WaitNodeConfig {
  /** Quantidade a esperar (>= 1). */
  amount: number
  unit:   "minutes" | "hours" | "days"
}
/** Destino da transferência (F1 do nó robusto — docs/transfer-node-design.md). */
export type TransferTarget = "department" | "agent" | "owner" | "pool"
/** Plano B quando o destino está indisponível (fora do horário / ninguém ativo). */
export type TransferFallback = "queue" | "wait_message" | "keep_ai"
export interface TransferNodeConfig {
  /** Destino. Ausente = "department" (retro-compat com nós antigos). */
  target?:     TransferTarget
  /** Nome do departamento (target=department). */
  department: string
  /** user_id do atendente (target=agent). */
  agentId?:    string
  summary?:   string
  handoff?:   string
  /** Plano B. Ausente = "queue" (enfileira mesmo assim — comportamento clássico). */
  whenUnavailable?: TransferFallback
  /** Mensagem ao cliente quando o Plano B dispara (wait_message/keep_ai). */
  waitMessage?:     string
}
export interface HttpNodeConfig {
  url:      string
  method?:  string
  headers?: Record<string, string>
  body?:    string
  /** Nome da variável onde a resposta é guardada (default: http_response). */
  saveAs?:  string
}
/** Um dado pedido pelo nó Coletar. Vários deles = um cadastro numa conversa só. */
export interface CollectField {
  /** A pergunta que o cliente final vê. Uma por vez, sempre. */
  question:  string
  /** Nome da variável do fluxo. */
  saveAs:    string
  validate?: "text" | "email" | "phone" | "number" | "cpf" | "cnpj"
  /** O que dizer quando a resposta não passa na validação. */
  retry?:    string
  /** Além da variável, grava na COLUNA REAL do contato. */
  mapTo?:    "name" | "phone" | "email" | "document" | "company" | "birthdate"
  /**
   * 🔴 Não perguntar se o contato JÁ TEM esse dado. É o que separa conversa de
   *    formulário — ninguém pede de novo o e-mail de quem já mandou. Só faz sentido
   *    com `mapTo` (é a coluna do contato que responde "já tenho?").
   */
  skipIfKnown?: boolean
}

export interface CollectNodeConfig {
  /**
   * Vários dados no MESMO nó (2026-08-01, ideia do dono).
   *
   * 🔴 Por que importa mais que arrumar o canvas: o nó `ai_agent` já coleta vários campos,
   *    mas custa token e exige a licença de IA. Isto é a versão **determinística e de custo
   *    zero** — pra quem não tem IA, é a diferença entre ter e não ter cadastro
   *    automatizado.
   *
   * ⚠️ Junta a CONFIGURAÇÃO, não as perguntas: o cliente final continua respondendo uma
   *    de cada vez. Pedir 4 dados numa mensagem só volta um texto embolado e tem taxa de
   *    resposta ruim.
   *
   * ⚠️ ADITIVO: nó antigo não tem `fields` e segue valendo pelos campos soltos abaixo.
   *    `normalizeCollect()` (runtime) é quem unifica as duas formas.
   */
  fields?:   CollectField[]

  // ── Forma LEGADA (um dado por nó). Mantida: há fluxo em produção com ela. ──
  question:  string
  saveAs:    string
  validate?: "text" | "email" | "phone" | "number" | "cpf" | "cnpj"
  retry?:    string
  /** Além de guardar na variável, grava a resposta na COLUNA REAL do contato
   *  (mesma normalização/guardas da tool update_contact — telefone/CPF só se
   *  vazios). Ausente = só variável (comportamento clássico). Destrava o número
   *  pro nó de disparo cross-canal (docs/studio-outreach-node-design.md). */
  mapTo?:    "name" | "phone" | "email" | "document" | "company" | "birthdate"
}
export interface ScheduleNodeConfig {
  /** Destino (binding): fixed (agenda/serviço) · owner (carteira). Sem "ai" (não há IA aqui). */
  target?:      AgendaBinding
  // ⚠️ `aiParse` ("Entender o pedido com IA") REMOVIDO em 2026-08-06 — decisão do owner:
  //    **este nó não usa IA.** Config antiga que ainda tenha o campo é simplesmente
  //    ignorada (jsonb; nada a migrar), e o fluxo passa a se comportar como já se
  //    comportava pra quem não tinha o add-on `ai`. Não reintroduzir sem pedido.
  /** Como oferecer: "slots" (lista plana dos próximos horários, default) ·
   *  "by_day" (cliente escolhe o DIA primeiro → depois o horário do dia). */
  offerMode?:   "slots" | "by_day"
  /** Estilo de exibição das opções (default auto). */
  render?:      RenderMode
  /** Oferecer remarcação quando o cliente já tem horário (detecção de colisão).
   *  AUSENTE = true (preserva o comportamento em produção). false = nó só cria. */
  offerReschedule?: boolean
  /** Texto de abertura acima dos horários/dias. */
  intro?:       string
  /** Quantos horários oferecer no modo slots (default 6, máx 9 — +"nenhum" ≤ 10 rows). */
  maxSlots?:    number
  /** Horizonte de busca em dias (default 21). */
  horizonDays?: number
  /** Mensagem ao concluir (suporta {{horario}}); default amigável. */
  successText?: string
}

export interface AiAgentNodeConfig {
  /** Missão deste passo (Vendas ≠ Suporte). Vira "# SUA MISSÃO". */
  instruction?: string
  /** Sub-opções das tools de CONSULTA ({ toolId: { chave: boolean } }) — só regulam
   *  o QUANTO mostrar; defaults seguros. studio-client-awareness-design.md §1. */
  toolConfig?:  Record<string, Record<string, boolean>>
  /** Campos que a IA deve extrair antes de concluir → entram nas variáveis. */
  collect?:     { key: string; description?: string }[]
  /** Saídas nomeadas (ramos). A IA escolhe uma ao concluir (finish_step).
   *  Vazio = saída única (aresta default). */
  outcomes?:    { id: string; label?: string }[]
  /** Ferramentas EXTRA que a IA pode usar neste nó (além das core):
   *  "tag" (etiquetar/qualificar) · "move_stage" (mover no pipeline). */
  tools?:       string[]
  /** Destino da agenda FIXADO por este nó (sobrepõe a escolha livre da IA).
   *  Só relevante quando as tools de agenda estão ligadas. Ausente = IA decide. */
  agenda_target?: AgendaBinding
}
/**
 * Nó FONTE DE CONSULTA (read-only) — conecta ao Agente IA e o alimenta com dado do
 * sistema, campo a campo, respeitando tenant + contato + só-o-que-libera.
 * docs/studio-data-source-node-design.md. `fields` = toggles dos campos OPCIONAIS
 * (🔵); os 🟢 Sempre são implícitos; os 🔴 Nunca não têm toggle (doutrina).
 */
export interface DataSourceNodeConfig {
  /** Qual fonte nativa. (Externa/genérica = F3.) */
  source: "agenda" | "deals" | "quotes"
  /** Campos opcionais ligados (por fonte — ver o editor). Ex: { value: true, closed: false }. */
  fields?: Record<string, boolean>
  /** Negócios: IDs dos campos personalizados (tenant_custom_fields) a expor. */
  customFields?: string[]
  /** Verificação leve: exige a IA confirmar a identidade do cliente (últimos 3 dígitos
   *  do CPF, ou o nome se não houver CPF) ANTES de detalhar. Opt-in, default off —
   *  resposta ao número reciclado. Deriva o dado por contato; ver confirm-identity.ts. */
  verify?: boolean
  /** Fonte "quotes" apenas — AÇÃO opt-in: deixar a IA REENVIAR ao cliente uma proposta
   *  JÁ gerada/aprovada (send_quote). Nunca cria cotação. Off por padrão. Enforcement no
   *  servidor (send-quote.ts): só doc active/sent do próprio contato, janela fail-closed. */
  resendQuote?: boolean
}
export interface AiRouterNodeConfig {
  instruction?: string
  routes:       { id: string; label: string; description?: string }[]
  /** outcome usado quando nada casa (default: aresta default). */
  fallback?:    string
}
export interface CallFlowNodeConfig {
  /** Fluxo alvo (studio_flows.id). */
  flowId: string
  /** subflow = empilha e VOLTA · goto = troca o frame ativo (pai sai). */
  mode:   "subflow" | "goto"
}
export interface TemplateNodeConfig {
  /** Nome + idioma do template APROVADO na Meta. */
  name:     string
  language: string
  /** Variáveis do corpo, na ordem (texto fixo ou {{var}} do fluxo — interpolado). */
  params?:  string[]
}
/** Nó de disparo cross-canal (site→WhatsApp) — docs/studio-outreach-node-design.md.
 *  Envia pro número do CONTATO no WhatsApp, não no canal onde o fluxo roda.
 *  Ramos: "sent" | "no_whatsapp" | "blocked". */
export interface OutreachNodeConfig {
  /** Qual número de saída: oficial (meta_cloud) · baileys · auto (prefere oficial). */
  channel:   "official" | "baileys" | "auto"
  /** Instância (número) de saída. Ausente = 1ª do canal resolvido (selector = F2c). */
  instanceId?: string
  /** Variável com o telefone destino. Ausente = contato.phone_number. */
  toVar?:    string
  /** Oficial: template aprovado (fora da janela 24h só template passa). */
  template?: { name: string; language: string; params?: string[] }
  /** Template é categoria MARKETING? Se sim, exige marketing_opt_in (fail-closed, I5). */
  marketing?: boolean
  /** Baileys: texto livre (suporta {{var}} — interpolado). */
  text?:     string
}
export interface TagNodeConfig {
  tag:    string
  action: "add" | "remove"
}
export interface MoveStageNodeConfig {
  /** Nome da etapa do pipeline (resolvido em pipeline_stages do tenant). */
  stage: string
}

// ── Trigger (quando o fluxo dispara) ──

/** Snapshot do post do Instagram CONGELADO na config do gatilho.
 *  `thumbUrl` guarda a URL ESTÁVEL nossa (`/api/ig-thumb/<mediaId>`), gravada por
 *  `freezeInstagramThumbs` — os bytes ficam no Storage privado. Nunca gravar aqui a URL
 *  de CDN da Meta: ela é assinada e morre em ~1-2 dias, e o card do canvas quebra junto.
 *  (Fluxo antigo pode ter a URL de CDN legada — o render tem fallback e o painel
 *  re-congela ao abrir.) O que o runtime usa de fato é o `id` (media_id). */
export interface IgCommentPostRef {
  id:        string
  permalink: string | null
  caption:   string | null
  isReel:    boolean
  timestamp: string | null
  thumbUrl:  string | null
}

// ── Mensagem rica (compositor compartilhado) ──
// Desenho: docs/message-composer-design.md
//
// 🔴 UM formato pras três superfícies que escrevem mensagem (DM do gatilho, nó `message`,
//    nó de Cartões). Independente de canal: quem traduz pro veículo de cada canal é o
//    renderizador. Se cada superfície tivesse o seu, divergiriam em semanas — foi a lição
//    do motor de proposta e das 18 larguras do dropdown.

export interface RichMedia {
  kind:  "image" | "video" | "document"
  /** Caminho no Storage PRIVADO (`card-images/<tenant>/<id>.<ext>`), não URL.
   *  Quem transforma em URL é quem envia — e só no formato que o canal exige. */
  path:  string
  name?: string
}

export interface RichButton {
  /** 🔴 Payload ESTÁVEL, e é ele que conserta um buraco real: hoje o toque no Instagram
   *  volta e acorda o fluxo pelo RÓTULO do botão (`instagram-inbound.ts` manda só
   *  `incomingText` pro motor, sem `interactiveId` — o WhatsApp manda). Dois botões com o
   *  mesmo texto casam errado. Este `id` também vira o nome do RAMO que sai do nó (F3). */
  id:    string
  label: string
  kind:  "reply" | "url"
  url?:  string
}

/** Uma mensagem — nunca uma sequência. Sequência é o canvas (nós `wait`, `collect`). */
export interface RichMessage {
  /**
   * Formato ESCOLHIDO pela pessoa (decisão do dono, 2026-08-01 — a 1ª versão derivava do
   * conteúdo e foi recusada). É ele que manda no envio e no que a tela mostra.
   *
   * ⚠️ Opcional porque dado antigo não tem: aí `richFormat()` deriva do conteúdo.
   * Valores: "text" | "buttons" | "card" | "media" (ver lib/messaging/rich-format.ts).
   */
  format?:  "text" | "buttons" | "card" | "media"
  text?:    string
  media?:   RichMedia
  buttons?: RichButton[]
}

/**
 * Configuração do gatilho `ig_comment` (comentário no Instagram → Direct).
 *
 * Mora no TRIGGER, não num nó do canvas: a private reply acontece ANTES de existir
 * conversa, e a Meta proíbe a 2ª mensagem até a pessoa responder — um passo no meio do
 * fluxo quebraria no nó seguinte (docs/instagram-studio-node-design.md §8.3).
 *
 * ⚠️ Espelho estrutural de `IgCommentTriggerConfig`
 * (src/components/integrations/instagram/ig-comment-config.tsx) — o componente de UI é a
 * fonte visual, este é o contrato persistido. Mudou um, muda o outro.
 */
export interface IgCommentTrigger {
  /** Posts alvo (v1: 1 a 3 — "mesma campanha em vários reels"). Vazio = inerte. */
  posts:         IgCommentPostRef[]
  /** Palavras no comentário. Vazio = qualquer comentário. */
  keywords:      string[]
  keywordMatch:  "contains" | "exact"
  /** O Direct (private reply). Limite da Meta: 1000 caracteres.
   *  ⚠️ LEGADO desde 2026-08-01 — continua sendo a fonte quando `dmRich` não existe.
   *  Aditivo de propósito: há fluxo em produção com só este campo preenchido. */
  dm:            string
  /**
   * O Direct em formato rico (texto + imagem + botões). Quando presente, VENCE o `dm`.
   *
   * 🔴 Por que botão importa aqui mais que em qualquer outro lugar do produto: a Meta dá
   *    **uma** mensagem por comentário e a conversa só continua se a pessoa responder.
   *    Toque em botão CONTA como resposta dela → abre a janela de 24h sem ela digitar.
   *    Verificado ao vivo em 2026-08-01 (o card com botão foi entregue, tocado, e o
   *    postback chegou com o payload intacto).
   *
   * ⚠️ Card com botão é o PADRÃO, chip não: chip vive colado no campo de digitar e a
   *    mensagem seguinte o apaga — medido. Quem não segue a conta recebe o direct em
   *    Solicitações e pode abrir dias depois, quando o chip já sumiu.
   */
  dmRich?:       RichMessage
  /** Variações da resposta pública ao comentário (a Kora alterna entre elas). */
  publicReplies: string[]
}

/**
 * Configuração do gatilho `ig_story_reply` (a pessoa RESPONDEU um story nosso).
 *
 * 🔴 Diferente do `ig_comment` em duas coisas que mudam o desenho:
 *   1. **Não é bala única.** A resposta ao story JÁ abre a janela de 24h — o fluxo pode
 *      conversar à vontade depois. Nada de "uma mensagem e acabou".
 *   2. **Já existe conversa** quando o evento chega (é DM), então não há private reply
 *      nem descoberta de identidade: entra pelo inbound normal.
 *
 * ⚠️ **STORY EXPIRA EM 24H.** `storyIds` preenchido = o fluxo para de casar quando aquele
 *    story morre. É por isso que o default é vazio (= todos) e a tela avisa em vez de
 *    deixar a pessoa descobrir sozinha semanas depois.
 */
export interface IgStoryTrigger {
  /** Stories alvo. **Vazio = TODOS** (o modo que não apodrece). */
  storyIds:      string[]
  /** Palavras na resposta. Vazio = qualquer resposta (inclusive só uma reação/emoji). */
  keywords:      string[]
  keywordMatch:  "contains" | "exact"
  /**
   * ❤️ Curtir a resposta automaticamente. **Recurso PRO** — gate `hasModulePro`.
   *
   * ⚠️ A licença é checada NO ENVIO, não aqui: downgrade de plano precisa parar de curtir
   *    mesmo com a config gravada no fluxo publicado. Guardar `true` no jsonb não é
   *    permissão — é intenção.
   */
  autoReact?:    boolean
}

export interface FlowTrigger {
  type:       "any_message" | "keyword" | "new_contact" | "reopened" | "from_ad" | "inactivity"
              // Instagram: NÃO é mensagem — não existe conversa quando o comentário chega.
              // Nunca casa no inbound (`matchesTrigger` → default:false); quem dispara é o
              // webhook de `comments`, e o fluxo é retomado no 1º reply (carimba-e-espera).
              | "ig_comment"
              // Instagram: a pessoa RESPONDEU um story nosso. Diferente de `ig_comment`
              // (aquele não tem conversa ainda); aqui já é DM — entra pelo inbound normal
              // e é o `signals.isStoryReply` que distingue.
              | "ig_story_reply"
              // Instagram: alguém COMEÇOU A SEGUIR a conta.
              // 🔴 DEPENDE DE LIBERAÇÃO DA META. O campo `follow` existe no schema, mas a
              //    assinatura devolve `success:false` enquanto a permissão não é concedida
              //    — e ela é dada seletivamente, fora do catálogo da Análise do App
              //    (verificado 2026-08-01). O estado real é carimbado em
              //    `channel_connections.meta.webhook_follow`; a tela mostra "a Meta não
              //    liberou" em vez de deixar o gatilho parecendo ligado.
              | "ig_follow"
  keywords?:  string[]
  /** Match da palavra-chave: "contains" (default, substring) | "exact" (palavra inteira). Ambos ignoram acento. */
  keywordMatch?: "contains" | "exact"
  /** receptivo (escuta inbound) | ativo (disparo manual/campanha) | auto (o sistema dispara sozinho,
   *  ex: inatividade — NÃO casa no inbound; quem aciona é o cron). Default: receptive. */
  mode?:      "receptive" | "active" | "auto"
  /** Só p/ type "inactivity" (modo auto): quanto tempo sem resposta do cliente pra disparar. */
  inactivityValue?: number
  inactivityUnit?:  "minutes" | "hours"
  /** Filtro de canal (ausente/vazio = qualquer). Ex: ["whatsapp", "site", "instagram"]. */
  channels?:  string[]
  /** Filtro de instância/número (ausente/vazio = qualquer). Ids de whatsapp_instances. */
  instances?: string[]
  /** Só p/ type "from_ad": mira anúncios específicos (sourceId). Ausente/vazio = qualquer anúncio. */
  adIds?:     string[]
  /** Só p/ type "ig_comment": post + palavra + Direct + resposta pública.
   *  A REGRA derivada daqui vive em `instagram_comment_rules` (o runtime lê a tabela,
   *  indexada por conexão+post; o fluxo continua sendo a fonte de edição). */
  ig?:        IgCommentTrigger
  /** Só p/ type "ig_story_reply": quais stories + palavra na resposta. */
  story?:     IgStoryTrigger
}

// ── Linhas do banco ──
export interface FlowRow {
  id:           string
  tenant_id:    string
  name:         string
  version:      number
  trigger:      FlowTrigger
  graph:        FlowGraph
}

/** Frame suspenso da pilha de chamadas (§11.1). */
export interface CallFrame {
  flow_id:        string
  flow_version:   number
  return_node_id: string | null
}

export interface FlowRunRow {
  id:              string
  conversation_id: string
  flow_id:         string
  flow_version:    number
  current_node_id: string | null
  variables:       Record<string, unknown>
  /** Pais suspensos (sub-fluxos). Topo do "stack" = frame ativo acima. */
  call_stack:      CallFrame[]
  status:          "active" | "waiting" | "done" | "failed"
  /** Só setado quando dorme num nó `wait` (relógio). Ausente/null nas esperas por
   *  input (menu/collect/schedule/ai_agent). Discrimina "voltou" de "espera de input". */
  resume_at?:      string | null
}
