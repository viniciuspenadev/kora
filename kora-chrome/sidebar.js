// Kora Companion — sidebar (página da extensão dentro do iframe).
// Recebe o chat aberto via postMessage do content script e busca tudo no
// background (que é quem fala com a API). Nenhum fetch direto daqui.

const view = document.getElementById("view")
const footUser = document.getElementById("foot-user")
const acct = document.getElementById("acct")
const acctName = document.getElementById("acct-name")

let session = null      // { loggedIn, user, tenant, baseUrl }
let currentChat = null  // { kind, phone?, name? }
let lastResolvedPhone = null
let lastResolve = null      // { contact, deals } do último resolve (base dos forms F1)
let pipelinesCache = null   // funis+etapas (carrega 1x por sessão)

async function getPipelines() {
  if (pipelinesCache) return pipelinesCache
  const r = await send({ type: "pipelines" })
  pipelinesCache = (r && r.ok && r.data.pipelines) || []
  return pipelinesCache
}

/** Re-busca o contato atual (após criar/mover/nota). */
function refreshResolve() {
  lastResolvedPhone = null
  renderState()
}

document.getElementById("close").addEventListener("click", () => {
  parent.postMessage({ type: "kora:close" }, "*")
})

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

const brl = (v) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "")
  if (d.length === 13 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`
  return d ? `+${d}` : "—"
}

const initials = (name) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()

let holdRender = false // segura o re-render do storage durante a animação de login

/** Troca o conteúdo com entrada em cascata (re-dispara o stagger do CSS).
 *  O dock só existe na ficha — todo setView esconde; renderFicha religa. */
function setView(html) {
  document.getElementById("dock").hidden = true
  closeSheet()
  closeAgSheet()
  view.classList.add("canvas") // fundo canvas (spec) — só o login remove
  view.innerHTML = html
  view.classList.remove("enter")
  void view.offsetWidth
  view.classList.add("enter")
}

// ── sheet de modelos pré-definidos ──
const sheet = document.getElementById("sheet")
const sheetBackdrop = document.getElementById("sheet-backdrop")
let qrCache = { contactId: null, replies: null }

function openSheet() {
  sheetBackdrop.hidden = false
  void sheet.offsetWidth
  sheetBackdrop.classList.add("open")
  sheet.classList.add("open")
  sheet.setAttribute("aria-hidden", "false")
  loadQuickReplies()
  // preventScroll: o focus era o gatilho do glitch — rolava a página atrás do
  // input em trânsito e revelava o sheet de agendamento estacionado abaixo.
  document.getElementById("qr-search").focus({ preventScroll: true })
}
function closeSheet() {
  sheet.classList.remove("open")
  sheetBackdrop.classList.remove("open")
  sheet.setAttribute("aria-hidden", "true")
  setTimeout(() => { sheetBackdrop.hidden = true }, 260)
}
document.getElementById("sheet-close").addEventListener("click", closeSheet)
sheetBackdrop.addEventListener("click", () => { closeSheet(); closeAgSheet() })
document.getElementById("qr-open").addEventListener("click", openSheet)
document.getElementById("qr-search").addEventListener("input", () => renderQuickList())

async function loadQuickReplies() {
  const contactId = (lastResolve && lastResolve.contact && lastResolve.contact.id) || null
  if (qrCache.contactId !== contactId || !qrCache.replies) {
    document.getElementById("qr-list").innerHTML = `<div class="qr-empty">Carregando modelos…</div>`
    const r = await send({ type: "quickReplies", contactId })
    qrCache = { contactId, replies: (r && r.ok && r.data.replies) || [] }
  }
  renderQuickList()
}

function renderQuickList() {
  const list = document.getElementById("qr-list")
  const q = document.getElementById("qr-search").value.trim().toLowerCase()
  const all = qrCache.replies || []
  const rows = q
    ? all.filter((r) => (r.title + " " + (r.shortcut || "") + " " + r.preview).toLowerCase().includes(q))
    : all

  if (!all.length) {
    list.innerHTML = `<div class="qr-empty">Nenhum modelo ainda.<br/>Crie em <a href="${esc((session && session.baseUrl) || "")}/configuracoes/respostas" target="_blank">Configurações → Respostas rápidas</a>.</div>`
    return
  }
  if (!rows.length) {
    list.innerHTML = `<div class="qr-empty">Nada com "${esc(q)}".</div>`
    return
  }
  list.innerHTML = rows.map((r) => `
    <button class="qr-row" data-id="${esc(r.id)}" type="button">
      <span class="qr-t"><b>${esc(r.title)}</b><small>${esc(r.preview)}</small></span>
      <span class="go">Inserir</span>
    </button>`).join("")
  list.querySelectorAll(".qr-row").forEach((row) => {
    row.addEventListener("click", () => {
      const reply = (qrCache.replies || []).find((x) => x.id === row.dataset.id)
      if (reply) parent.postMessage({ type: "kora:insert", text: reply.preview }, "*")
    })
  })
}

// resultado da inserção vem do content script
let insertOkMsg = null // toast customizado pro próximo kora:inserted (ex: fluxo do agendamento)
window.addEventListener("message", (ev) => {
  const d = ev.data || {}
  if (d.type !== "kora:inserted") return
  if (d.ok) {
    closeSheet()
    alertHint(insertOkMsg || "Inserido no campo — revise e envie ✓", true)
  } else {
    alertHint("Não achei o campo de mensagem. Clique no chat e tente de novo.")
  }
  insertOkMsg = null
})

function empty(ico, title, text, extraHtml = "") {
  setView(`<div class="empty"><div class="ico">${ico}</div><b>${esc(title)}</b><p>${esc(text)}</p>${extraHtml}</div>`)
}

/** Estado-guarda: contato existe na base mas fora do alcance do atendente.
 *  Mesmo texto pra COM dono e SEM dono — nunca vazar de quem é. */
function renderBaseGuard() {
  empty(
    "🗂",
    "Já está na base da empresa",
    "Este número pertence à base do time. Peça ao gestor pra atribuir o contato a você — aí a ficha abre aqui.",
  )
}

function renderChrome() {
  const brandLogo = document.getElementById("brand-logo")
  const navRadar = document.getElementById("nav-radar")
  if (session && session.loggedIn) {
    brandLogo.hidden = false
    navRadar.hidden = false
    acct.hidden = false
    acctName.textContent = (session.tenant && session.tenant.name) || "Kora"
    footUser.textContent = (session.user && session.user.name) || (session.user && session.user.email) || "—"
  } else {
    // deslogado: o logo mora DENTRO do bloco de login, acima do título
    brandLogo.hidden = true
    navRadar.hidden = true
    acct.hidden = true
    footUser.textContent = "Desconectado"
  }
}

// navegação: o Radar é alcançável SEMPRE (com ou sem chat aberto)
document.getElementById("nav-radar").addEventListener("click", () => renderRadar())

function renderLogin() {
  const base = esc((session && session.baseUrl) || "")
  setView(`
    <div class="login">
      <img src="assets/logo.svg" alt="Kora" class="login-logo" />
      <div class="login-title">Conecte sua conta do Kora<br>para começar</div>
      <form id="login-form">
        <label>Email:
          <input id="lg-email" type="email" placeholder="exemplo@email.com" autocomplete="username" required />
        </label>
        <label>Senha:
          <input id="lg-pass" type="password" placeholder="Digite sua senha" autocomplete="current-password" required />
        </label>
        <a class="forgot" href="${base}/auth/signin" target="_blank" rel="noreferrer">Esqueci minha senha</a>
        <div id="lg-err" class="err" hidden></div>
        <button id="lg-btn" class="btn btn-primary" type="submit">Conectar</button>
      </form>
      <div class="or"><span></span>ou<span></span></div>
      <div class="hint">Não tem uma conta? <a class="lnk" href="${base}/setup" target="_blank" rel="noreferrer">Você pode testar de graça por 7 dias.</a></div>
      <details class="adv"><summary>Servidor</summary>
        <input id="lg-base" type="url" value="${base}" placeholder="http://localhost:3000" />
      </details>
    </div>`)
  view.classList.remove("canvas") // login é a única tela toda branca
  document.getElementById("login-form").addEventListener("submit", onLogin)
}

async function onLogin(ev) {
  ev.preventDefault()
  const btn = document.getElementById("lg-btn")
  const formEl = document.getElementById("login-form")
  const errEl = document.getElementById("lg-err")
  errEl.hidden = true
  btn.disabled = true

  // Morph: congela a largura atual em px pro CSS interpolar até o círculo.
  btn.style.width = btn.offsetWidth + "px"
  void btn.offsetWidth
  btn.classList.add("loading")

  holdRender = true // o check verde termina antes do re-render da sessão
  const r = await send({
    type: "login",
    email: document.getElementById("lg-email").value,
    password: document.getElementById("lg-pass").value,
    baseUrl: document.getElementById("lg-base").value || undefined,
    label: `Chrome · ${navigator.platform || "?"}`,
  })

  if (!r || !r.ok) {
    holdRender = false
    btn.classList.remove("loading")
    btn.style.width = ""
    btn.disabled = false
    errEl.textContent = (r && r.error) || "Não deu pra conectar. Confira o servidor."
    errEl.hidden = false
    formEl.classList.remove("shake")
    void formEl.offsetWidth
    formEl.classList.add("shake")
    return
  }

  btn.classList.add("success") // ✓ desenha no círculo verde
  setTimeout(async () => {
    holdRender = false
    session = await send({ type: "status" })
    lastResolvedPhone = null
    renderState() // entra em cascata (setView)
  }, 750)
}

function renderState() {
  renderChrome()

  if (!session || !session.loggedIn) {
    renderLogin()
    return
  }
  if (!currentChat || currentChat.kind === "none") {
    renderRadar() // sem chat aberto = home do Radar do Dia
    return
  }
  if (currentChat.kind === "group") {
    empty("👥", "Conversa de grupo", "Grupos não têm ficha 1:1. Abra uma conversa individual.")
    return
  }
  if (currentChat.kind === "lid") {
    empty(
      "🪪",
      "Chat com ID protegido",
      "O WhatsApp esconde o telefone deste chat (@lid) e ainda não achei o número por outro caminho. Manda o print do diagnóstico.",
      currentChat.diag
        ? `<details class="diag"><summary>Diagnóstico pra suporte</summary><pre>${esc(currentChat.diag)}</pre></details>`
        : "",
    )
    return
  }
  if (currentChat.kind === "unknown") {
    empty(
      "🔍",
      "Não consegui ler este chat",
      "O WhatsApp pode ter mudado o layout. Abra o diagnóstico abaixo e mande um print pro suporte.",
      currentChat.diag
        ? `<details class="diag"><summary>Diagnóstico pra suporte</summary><pre>${esc(currentChat.diag)}</pre></details>`
        : "",
    )
    return
  }
  resolveChat()
}

async function resolveChat() {
  const phone = currentChat.phone
  if (phone === lastResolvedPhone) return
  lastResolvedPhone = phone

  empty("⏳", "Buscando no Kora…", fmtPhone(phone))
  const r = await send({ type: "resolve", phone })
  if (phone !== (currentChat && currentChat.phone)) return // trocou de chat no meio

  if (!r || !r.ok) {
    if (r && r.status === 401) { session = { loggedIn: false }; renderState(); return }
    if (r && (r.code === "companion_disabled" || r.code === "companion_access_off")) {
      empty("🔒", "Extensão desativada", r.error || "Fale com o administrador da conta.")
      return
    }
    empty("⚠️", "Não deu pra buscar", (r && r.error) || "Erro de conexão com o servidor.")
    return
  }

  if (!r.data.found) {
    // já existe na base mas FORA do alcance → estado-guarda imediato (decisão do
    // owner: não fazer o atendente preencher cadastro pra bater na parede)
    if (r.data.inBase) {
      renderBaseGuard()
      return
    }
    setView(`
      <div class="empty" style="flex:none;padding:18px 8px 4px">
        <div class="ico">👤</div>
        <b>Contato não cadastrado</b>
        <p>Não encontramos ninguém com este número no Kora. Vamos criar?</p>
      </div>
      <form id="cc-form" class="frm">
        ${currentChat.avatar ? `
        <div class="cc-photo">
          <img src="${esc(currentChat.avatar)}" alt="Foto do WhatsApp" />
          <label class="cc-check"><input id="cc-save-photo" type="checkbox" checked /> Salvar foto do WhatsApp</label>
        </div>` : ""}
        <label>Nome<input id="cc-name" type="text" value="${esc(currentChat.name || "")}" placeholder="Nome do contato" required /></label>
        <label>Telefone<input type="text" value="${fmtPhone(phone)}" disabled /></label>
        <div id="cc-err" class="err" hidden></div>
        <button id="cc-btn" class="btn btn-primary" type="submit">Cadastrar contato</button>
        <div class="hint">Se o número já existir por outro canal, o Kora funde em vez de duplicar.</div>
      </form>`)
    document.getElementById("cc-form").addEventListener("submit", async (ev) => {
      ev.preventDefault()
      const btn = document.getElementById("cc-btn")
      const errEl = document.getElementById("cc-err")
      morphStart(btn)
      const chk = document.getElementById("cc-save-photo")
      const res = await send({
        type: "createContact",
        name: document.getElementById("cc-name").value,
        phone,
        photoUrl: chk && chk.checked ? currentChat.avatar : undefined,
      })
      if (!res || !res.ok) {
        // corrida: o número entrou na base entre o resolve e o cadastro
        if (res && res.code === "already_in_base") {
          renderBaseGuard()
          return
        }
        morphFail(btn, "Cadastrar contato")
        errEl.textContent = (res && res.error) || "Não deu pra cadastrar."
        errEl.hidden = false
        shakeForm(document.getElementById("cc-form"))
        return
      }
      morphSuccess(btn, () => {
        alertHint("Contato cadastrado ✓", true)
        refreshResolve()
      })
    })
    return
  }

  lastResolve = { contact: r.data.contact, deals: r.data.deals || [] }
  await renderFicha()
}

// ── ficha do contato + negócios (F1: mover etapa, nota, novo negócio) ──
async function renderFicha() {
  const c = lastResolve.contact
  const deals = lastResolve.deals
  const pipes = await getPipelines()

  const stageOptions = (deal) => {
    const pipe = pipes.find((p) => p.id === deal.pipelineId)
    const stages = pipe ? pipe.stages.filter((s) => !s.terminal) : []
    if (!stages.length) return `<option>${esc(deal.stageName || "—")}</option>`
    return stages.map((s) =>
      `<option value="${esc(s.id)}" ${s.id === deal.stageId ? "selected" : ""}>${esc(s.name)}</option>`).join("")
  }

  const dealsHtml = deals.length
    ? deals.map((d) => `
        <div class="deal">
          <button class="deal-open" data-deal="${esc(d.id)}" type="button" title="Ver itens e cotações">
            <b>${esc(d.name || "Negócio")}</b><span class="deal-v">${brl(d.value)}<i class="chev">›</i></span>
          </button>
          <div class="deal-m">
            <select class="stage-sel" data-deal="${esc(d.id)}" title="Mover etapa">${stageOptions(d)}</select>
            <small>${esc(d.pipelineName || "")}</small>
            <button class="mini-btn note-btn" data-deal="${esc(d.id)}" type="button">Nota</button>
          </div>
          <div class="notebox" id="nb-${esc(d.id)}" hidden>
            <textarea id="nt-${esc(d.id)}" placeholder="Escreva a nota — vai pra linha do tempo…"></textarea>
            <button class="mini-btn pri save-note" data-deal="${esc(d.id)}" type="button">Salvar nota</button>
          </div>
        </div>`).join("")
    : `<div class="hint">Nenhum negócio aberto com este contato.</div>`

  const dealsBlock = deals.length
    ? `<div class="sec">Negócios abertos · ${deals.length}</div>
       ${dealsHtml}
       <div class="hint">Ganhar ou perder um negócio tem fluxo próprio — finalize no app.</div>`
    : `<div class="empty inline">
         <div class="ico">💼</div>
         <b>Nenhum negócio aberto</b>
         <p>Que tal abrir o primeiro? É só clicar em "＋ Novo negócio".</p>
       </div>`

  // corpo da aba Negócio (spec §3): ações em par + cards dos negócios
  const negocioBody = `
    <div class="btn-row">
      <button id="new-deal" class="btn btn-primary" type="button">＋ Novo negócio</button>
      <a class="btn btn-white" target="_blank" rel="noreferrer" href="${esc(session.baseUrl)}/contatos/${esc(c.id)}">Ficha completa ↗</a>
    </div>
    ${dealsBlock}`

  setView(`
    <div class="ficha-head">
      <div class="contact">
        <div class="avatar">${esc(initials(c.name || (currentChat && currentChat.name)))}</div>
        <div style="min-width:0">
          <span class="nm-row"><b>${esc(c.name || (currentChat && currentChat.name) || "Sem nome")}</b></span>
          <span class="ph">${fmtPhone(c.phone || (currentChat && currentChat.phone))}</span>
        </div>
      </div>
      <div class="tabs">
        <button class="tab${fichaTab === "negocio" ? " on" : ""}" data-tab="negocio" type="button">Negócio</button>
        <button class="tab${fichaTab === "agenda" ? " on" : ""}" data-tab="agenda" type="button">Agenda</button>
      </div>
    </div>
    <div id="tab-body" class="tab-body">
      ${fichaTab === "negocio" ? negocioBody : ""}
    </div>`)

  document.getElementById("dock").hidden = false
  view.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      if (t.dataset.tab === fichaTab) return
      fichaTab = t.dataset.tab
      renderFicha()
    })
  })
  if (fichaTab === "agenda") renderAgendaTab()

  // mover etapa — confirma com anel verde no card + toast antes do refresh
  view.querySelectorAll(".stage-sel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      sel.disabled = true
      const res = await send({ type: "moveStage", dealId: sel.dataset.deal, stageId: sel.value })
      if (!res || !res.ok) {
        alertHint((res && res.error) || "Não deu pra mover a etapa.")
        refreshResolve()
        return
      }
      const card = sel.closest(".deal")
      if (card) card.classList.add("saved")
      alertHint("Etapa movida ✓", true)
      setTimeout(refreshResolve, 950)
    })
  })
  // nota por negócio
  view.querySelectorAll(".note-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const box = document.getElementById(`nb-${b.dataset.deal}`)
      box.hidden = !box.hidden
      if (!box.hidden) document.getElementById(`nt-${b.dataset.deal}`).focus()
    })
  })
  view.querySelectorAll(".save-note").forEach((b) => {
    b.addEventListener("click", async () => {
      const ta = document.getElementById(`nt-${b.dataset.deal}`)
      if (!ta.value.trim()) return
      b.disabled = true
      b.textContent = "Salvando…"
      const res = await send({ type: "addNote", dealId: b.dataset.deal, text: ta.value })
      if (!res || !res.ok) {
        alertHint((res && res.error) || "Não deu pra salvar a nota.")
        b.disabled = false
        b.textContent = "Salvar nota"
        return
      }
      // confirmação no PRÓPRIO botão antes de recolher
      b.textContent = "✓ Nota salva"
      b.classList.add("ok-mini")
      alertHint("Nota salva na linha do tempo ✓", true)
      setTimeout(() => {
        b.classList.remove("ok-mini")
        b.disabled = false
        b.textContent = "Salvar nota"
        ta.value = ""
        document.getElementById(`nb-${b.dataset.deal}`).hidden = true
      }, 1200)
    })
  })
  const newDealBtn = document.getElementById("new-deal")
  if (newDealBtn) newDealBtn.addEventListener("click", renderNewDeal)
  // drill-down: negócio por dentro (itens + cotações)
  view.querySelectorAll(".deal-open").forEach((b) => {
    b.addEventListener("click", () => renderDealDetail(b.dataset.deal))
  })
}

// ── Radar do Dia — home da sidebar quando não há chat aberto ──
// Filas derivadas do CRM/Agenda no alcance do viewer; clicar abre a conversa
// (rota /send do WhatsApp) com o rascunho de follow-up JÁ no composer.

function radarBadge(count) {
  const n = Number(count) || 0
  parent.postMessage({ type: "kora:badge", count: n }, "*")
  const chip = document.getElementById("nav-radar-n")
  chip.textContent = n > 99 ? "99+" : String(n)
  chip.hidden = n <= 0
}

async function refreshBadge() {
  if (!session || !session.loggedIn) { radarBadge(0); return }
  const r = await send({ type: "radar" })
  radarBadge(r && r.ok && r.data.radar ? r.data.radar.count : 0)
}
setInterval(refreshBadge, 5 * 60_000)

function openChatFromRadar(phone, text) {
  if (!phone) {
    alertHint("Contato sem número de WhatsApp — abra pelo app.")
    return
  }
  parent.postMessage({ type: "kora:open-chat", phone, text: text || "" }, "*")
}

async function renderRadar() {
  // navegação: com chat aberto, o Radar ganha o ‹ de volta pra ficha — em TODOS
  // os estados (carregando/erro/vazio/cheio), nunca deixar o usuário preso.
  const hasChat = () => currentChat && currentChat.kind !== "none"
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
  const head = () =>
    `<div class="rd-head">${hasChat() ? `<button id="rd-back" class="back-btn" type="button" title="Voltar pra conversa aberta">‹</button>` : ""}<b>Radar do dia</b><small>${esc(today)}</small></div>`
  const wireBack = () => {
    const b = document.getElementById("rd-back")
    if (b) b.addEventListener("click", () => refreshResolve())
  }
  const radarState = (ico, title, text) => {
    setView(`${head()}<div class="empty inline"><div class="ico">${ico}</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`)
    wireBack()
  }

  const chatKey = JSON.stringify(currentChat)
  radarState("📡", "Radar do dia", "Buscando suas pendências…")
  const r = await send({ type: "radar" })
  // trocou de chat no meio → o renderState já assumiu a tela; não sobrescrever
  if (JSON.stringify(currentChat) !== chatKey) return
  if (session && !session.loggedIn) return // deslogou no meio
  if (!r || !r.ok) {
    if (r && r.status === 401) { session = { loggedIn: false }; renderState(); return }
    radarState("⚠️", "Radar indisponível", (r && r.error) || "Erro de conexão com o servidor.")
    return
  }
  const rd = r.data.radar
  radarBadge(rd.count)

  if (!rd.count) {
    radarState("🌤️", "Tudo em dia", "Nenhuma pendência no seu radar. Abra uma conversa no WhatsApp pra ver a ficha do contato.")
    return
  }
  const row = (chip, chipCls, title, sub, phone, draft) => `
    <button class="rd-row" type="button" data-phone="${esc(phone || "")}" data-draft="${esc(draft || "")}">
      <span class="rd-chip ${chipCls}">${esc(chip)}</span>
      <span class="rd-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
      <span class="go">Abrir</span>
    </button>`

  const apptsHtml = rd.appointments.length
    ? `<div class="sec">Agenda de hoje · ${rd.appointments.length}</div>
       <div class="card slim"><div class="list">${rd.appointments.map((a) => row(
         fmtApptTime(a.startsAt),
         "time",
         a.contactName || "Contato",
         [a.serviceName || "Compromisso", a.resourceName].filter(Boolean).join(" · ") + (a.status === "confirmed" ? " · confirmado" : ""),
         a.contactPhone,
         "",
       )).join("")}</div></div>`
    : ""

  const dealsHtml = rd.staleDeals.length
    ? `<div class="sec">Negócios parados · ${rd.staleDeals.length}</div>
       <div class="card slim"><div class="list">${rd.staleDeals.map((d) => row(
         `${d.days}d`,
         "late",
         d.name || "Negócio",
         [d.contactName, d.value != null ? brl(d.value) : null, d.stageName].filter(Boolean).join(" · "),
         d.contactPhone,
         d.draft,
       )).join("")}</div></div>`
    : ""

  const quotesHtml = rd.pendingQuotes.length
    ? `<div class="sec">Cotações sem resposta · ${rd.pendingQuotes.length}</div>
       <div class="card slim"><div class="list">${rd.pendingQuotes.map((qd) => row(
         `${qd.days}d`,
         "late",
         `${qd.code} · ${brl2((qd.totalCents || 0) / 100)}`,
         [qd.contactName, qd.dealName].filter(Boolean).join(" · "),
         qd.contactPhone,
         qd.draft,
       )).join("")}</div></div>`
    : ""

  setView(`
    ${head()}
    ${apptsHtml}
    ${dealsHtml}
    ${quotesHtml}
    <div class="hint">Clique numa pendência pra abrir a conversa — nos follow-ups a mensagem já chega pronta no campo, é só revisar e enviar.</div>`)

  wireBack()
  view.querySelectorAll(".rd-row").forEach((b) => {
    b.addEventListener("click", () => openChatFromRadar(b.dataset.phone, b.dataset.draft))
  })
}

// ── Ficha com abas (spec §3–§6): Negócio | Agenda | Automação ──
let fichaTab = "negocio" // lembra a última aba entre contatos

const fmtApptTime = (iso) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

/** Card do compromisso — bloco de data em tinta (spec §5 .appt-date). */
function apptCard(a) {
  const d = new Date(a.startsAt)
  const mon = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
  const wd = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")
  return `
    <div class="appt">
      <div class="appt-date"><b>${d.getDate()}</b><span>${esc(mon)}</span></div>
      <div class="appt-info">
        <b>${esc(a.serviceName || "Compromisso")}</b>
        <small>${esc(wd)} ${esc(fmtApptTime(a.startsAt))}${a.resourceName ? ` · ${esc(a.resourceName)}` : ""}</small>
      </div>
      <span class="chip ${a.status === "confirmed" ? "st-ok" : "st-sent"}">${a.status === "confirmed" ? "Confirmado" : "Agendado"}</span>
    </div>`
}

// Aba Automação (spec §6) REMOVIDA por decisão do owner 2026-07-16: o conceito
// ("quem fala com esse cliente — eu ou a máquina?" + inscrever em fluxo) fica
// guardado pra quando a IA v2 estiver de pé; placeholder por meses seria ruído.

// Aba Agenda: próximo agendamento + "＋ Novo agendamento" abre o SHEET com
// calendário do mês (decisão do owner 2026-07-16: chips de 5 dias limitavam a
// data; a grade de horários aprovada fica, agora agrupada por período).
let agDay = null   // dia selecionado (YYYY-MM-DD)
let agMonth = null // mês exibido no calendário ("YYYY-MM")
// escolhas GRAVADAS (pedido do owner: "precisa gravar qual é o serviço correto")
// — sobrevivem ao F5 da página (sessionStorage do iframe da extensão).
// agSvc: null = nunca escolhido conscientemente · "" = "sem serviço" explícito · id
let agSvc = sessionStorage.getItem("kora-ag-svc")
let agRes = sessionStorage.getItem("kora-ag-res") || ""
// modo REMARCAR: serviço/agenda ficam travados no compromisso (não é re-escolha)
let agReschedule = null // { appointmentId, resourceId, serviceId, serviceName, resourceName }

async function renderAgendaTab() {
  const body = document.getElementById("tab-body")
  if (!body) return
  const c = lastResolve.contact
  body.innerHTML = `<div class="ag-empty">Carregando agenda…</div>`

  let ag = lastResolve.agenda
  if (!ag) {
    const r = await send({ type: "agenda", contactId: c.id })
    if (fichaTab !== "agenda" || !document.getElementById("tab-body")) return
    if (!r || !r.ok) {
      document.getElementById("tab-body").innerHTML =
        `<div class="empty inline"><div class="ico">⚠️</div><b>Não deu pra carregar</b><p>${esc((r && r.error) || "Erro de conexão com o servidor.")}</p></div>`
      return
    }
    ag = r.data.agenda
    lastResolve.agenda = ag
  }
  const bodyNow = document.getElementById("tab-body")
  if (!bodyNow || fichaTab !== "agenda") return

  if (!ag.enabled) {
    bodyNow.innerHTML = `<div class="empty inline"><div class="ico">🗓️</div><b>Agenda desativada</b><p>O módulo Agenda não está habilitado nesta conta.</p></div>`
    return
  }

  const nextHtml = ag.next
    ? apptCard(ag.next) +
      (ag.upcoming > 1 ? `<div class="ag-empty">+ ${ag.upcoming - 1} outro(s) horário(s) futuro(s) — detalhes na agenda do app.</div>` : "")
    : `<div class="ag-empty">Sem horário marcado${ag.resources.length ? " — marque o primeiro abaixo." : "."}</div>`

  // ações do compromisso (o pedido chega pelo chat): confirmar em 1 clique
  // (cliente disse "confirmado" em texto livre) + remarcar sem sair da conversa
  const actsHtml = ag.next
    ? `<div class="btn-row">
        ${ag.next.status === "scheduled" ? `<button id="ag-confirm" class="btn btn-white" type="button">✓ Confirmar</button>` : ""}
        <button id="ag-move" class="btn btn-white" type="button">Remarcar</button>
      </div>`
    : ""

  bodyNow.innerHTML = `
    <div class="sec">Próximo agendamento</div>
    ${nextHtml}
    ${actsHtml}
    ${ag.resources.length
      ? `<button id="ag-new" class="btn btn-primary" type="button">＋ Novo agendamento</button>`
      : `<div class="hint">Nenhuma agenda configurada — configure em Agenda no app.</div>`}`
  const b = document.getElementById("ag-new")
  if (b) b.addEventListener("click", openAgendaSheet)
  const bc = document.getElementById("ag-confirm")
  if (bc) bc.addEventListener("click", async () => {
    bc.disabled = true
    bc.textContent = "Confirmando…"
    const r = await send({ type: "agendaConfirm", appointmentId: ag.next.id })
    if (!r || !r.ok) {
      bc.disabled = false
      bc.textContent = "✓ Confirmar"
      alertHint((r && r.error) || "Não deu pra confirmar.")
      return
    }
    alertHint("Horário confirmado ✓", true)
    refreshResolve()
  })
  const bm = document.getElementById("ag-move")
  if (bm) bm.addEventListener("click", () => openRescheduleSheet(ag.next))
}

// ── sheet "Novo agendamento": serviço/agenda → calendário do mês → horários ──
const agSheet = document.getElementById("ag-sheet")

function openAgendaSheet() {
  const ag = lastResolve && lastResolve.agenda
  if (!ag || !ag.resources.length) return
  agReschedule = null
  const today = new Date().toLocaleDateString("en-CA")
  if (!agDay || agDay < today) agDay = today
  agMonth = agDay.slice(0, 7)
  document.getElementById("ag-sheet-title").textContent = "Novo agendamento"
  buildAgendaSheet()
  sheetBackdrop.hidden = false
  void agSheet.offsetWidth
  sheetBackdrop.classList.add("open")
  agSheet.classList.add("open")
  agSheet.setAttribute("aria-hidden", "false")
}

/** Remarcar: mesmo sheet "2 andares", com serviço/agenda TRAVADOS no compromisso. */
function openRescheduleSheet(next) {
  agReschedule = {
    appointmentId: next.id,
    resourceId: next.resourceId,
    serviceId: next.serviceId || null,
    serviceName: next.serviceName || null,
    resourceName: next.resourceName || null,
  }
  const cur = new Date(next.startsAt).toLocaleDateString("en-CA")
  const today = new Date().toLocaleDateString("en-CA")
  agDay = cur >= today ? cur : today // abre no dia atual do compromisso
  agMonth = agDay.slice(0, 7)
  document.getElementById("ag-sheet-title").textContent = "Remarcar horário"
  buildAgendaSheet()
  sheetBackdrop.hidden = false
  void agSheet.offsetWidth
  sheetBackdrop.classList.add("open")
  agSheet.classList.add("open")
  agSheet.setAttribute("aria-hidden", "false")
}

function closeAgSheet() {
  if (!agSheet.classList.contains("open")) return
  agReschedule = null
  agSheet.classList.remove("open")
  agSheet.setAttribute("aria-hidden", "true")
  sheetBackdrop.classList.remove("open")
  setTimeout(() => {
    if (!sheet.classList.contains("open") && !agSheet.classList.contains("open")) sheetBackdrop.hidden = true
  }, 260)
}
document.getElementById("ag-sheet-close").addEventListener("click", closeAgSheet)

// ── UX "2 andares" (decisão do owner 2026-07-16): andar 1 = resumo vivo de
// serviço/agenda + CALENDÁRIO protagonista; andar 2 = horários grandes do dia.
// O serviço é 1ª classe: 1º uso abre expandido e o calendário só libera depois
// da escolha (a DURAÇÃO do serviço muda os horários — escolher errado = agendar
// errado); depois colapsa em resumo sempre visível e fica gravado.
function buildAgendaSheet() {
  const ag = lastResolve.agenda
  const c = lastResolve.contact
  const re = agReschedule // modo remarcar: serviço/agenda fixos no compromisso
  const body = document.getElementById("ag-sheet-body")
  const todayYmd = () => new Date().toLocaleDateString("en-CA")

  const hasServices = ag.services.length > 0
  if (agSvc && !ag.services.some((x) => x.id === agSvc)) agSvc = null // lembrado sumiu → re-escolher
  if (!hasServices) agSvc = "" // tenant sem serviços: caminho único

  let sumOpen = !re && hasServices && agSvc === null // 1º uso: escolhas abertas
  let selSlot = null

  const svcById = (id) => ag.services.find((x) => x.id === id)
  const resPoolFor = (svcId) => {
    const svc = svcId ? svcById(svcId) : null
    let pool = svc && svc.resourceIds && svc.resourceIds.length
      ? ag.resources.filter((r) => svc.resourceIds.includes(r.id))
      : ag.resources
    if (!pool.length) pool = ag.resources
    return pool
  }
  const ensureRes = () => {
    if (re) return
    const pool = resPoolFor(agSvc)
    if (!pool.some((r) => r.id === agRes)) agRes = pool[0].id
  }
  const effRes = () => (re ? re.resourceId : agRes)
  const effSvc = () => (re ? (re.serviceId || "") : agSvc)
  const resName = () => {
    const r = ag.resources.find((x) => x.id === effRes())
    return r ? r.name : (re && re.resourceName) || ""
  }
  const svcLabel = () => {
    if (re) return re.serviceName || "Sem serviço"
    return agSvc ? `${svcById(agSvc).name} · ${svcById(agSvc).durationMinutes}min` : "Sem serviço · duração padrão"
  }
  const saveChoices = () => {
    if (agSvc === null) sessionStorage.removeItem("kora-ag-svc")
    else sessionStorage.setItem("kora-ag-svc", agSvc)
    sessionStorage.setItem("kora-ag-res", agRes)
  }
  ensureRes()

  body.innerHTML = `
    <div id="ags-cal-stage" class="ags-stage">
      <div id="ags-sum"></div>
      <div class="cal" id="ags-cal"></div>
      <div id="ags-cal-hint" class="hint" hidden>Escolha o serviço pra liberar os horários certos.</div>
    </div>
    <div id="ags-slot-stage" class="ags-stage" hidden>
      <div class="ags-day-head">
        <button id="ags-back" class="back-btn" type="button" title="Trocar o dia">‹</button>
        <div style="min-width:0">
          <b id="ags-day-title"></b>
          <small id="ags-day-sub"></small>
        </div>
      </div>
      <div id="ags-slots"></div>
      ${re ? "" : `<div class="frm">
        <label>Aviso pro cliente
          <select id="ags-notify">
            <option value="chat" selected>Eu envio nesta conversa — mensagem pronta pra revisar</option>
            <option value="system">Sistema envia pelo número conectado</option>
            <option value="none">Não avisar agora</option>
          </select>
        </label>
      </div>`}
      <div id="ags-err" class="err" hidden></div>
      <button id="ags-btn" class="btn btn-primary" type="button" disabled>${re ? "Remarcar horário" : "Agendar horário"}</button>
      <div class="hint">${re
        ? "O cliente recebe novo pedido de confirmação e os lembretes são reprogramados pro horário novo."
        : "Lembretes e pedido de confirmação seguem a configuração da agenda no app."}</div>
    </div>`

  const needSvc = () => !re && hasServices && agSvc === null

  // ── resumo vivo (andar 1) ──
  function renderSum() {
    const el = document.getElementById("ags-sum")
    if (!el) return
    document.getElementById("ags-cal-hint").hidden = !needSvc()
    if (re) {
      // remarcando: serviço/agenda são DO compromisso — só informação, sem edição
      el.innerHTML = `
        <div class="ags-sum-row" style="cursor:default">
          <span class="ags-sum-txt"><b>${esc(svcLabel())}</b><small>com ${esc(resName())} · escolha o novo dia</small></span>
        </div>`
      return
    }
    if (!sumOpen) {
      el.innerHTML = `
        <button id="ags-sum-row" class="ags-sum-row" type="button" title="Trocar serviço ou agenda">
          <span class="ags-sum-txt"><b>${esc(svcLabel())}</b><small>com ${esc(resName())}</small></span>
          <span class="ags-sum-edit">✎</span>
        </button>`
      document.getElementById("ags-sum-row").addEventListener("click", () => { sumOpen = true; renderSum() })
      return
    }
    const svcOpts =
      (agSvc === null ? `<option value="__none" selected disabled>Escolha o serviço…</option>` : "") +
      `<option value=""${agSvc === "" ? " selected" : ""}>Sem serviço · duração padrão da agenda</option>` +
      ag.services.map((x) => `<option value="${esc(x.id)}"${x.id === agSvc ? " selected" : ""}>${esc(x.name)} · ${x.durationMinutes}min</option>`).join("")
    const resOpts = resPoolFor(agSvc)
      .map((r) => `<option value="${esc(r.id)}"${r.id === agRes ? " selected" : ""}>${esc(r.name)}</option>`).join("")
    el.innerHTML = `
      <div class="frm ags-sum-form">
        ${hasServices ? `<label>Serviço<select id="ags-svc">${svcOpts}</select></label>` : ""}
        <label>Agenda<select id="ags-res">${resOpts}</select></label>
      </div>`
    const svcSel = document.getElementById("ags-svc")
    if (svcSel) svcSel.addEventListener("change", (ev) => {
      agSvc = ev.target.value === "__none" ? null : ev.target.value
      ensureRes()
      saveChoices()
      renderSum() // re-renderiza pra sincronizar o pool de agendas
    })
    document.getElementById("ags-res").addEventListener("change", (ev) => {
      agRes = ev.target.value
      saveChoices()
    })
  }

  // ── troca de andar (desliza lateral) ──
  function showStage(which) {
    const calSt = document.getElementById("ags-cal-stage")
    const slotSt = document.getElementById("ags-slot-stage")
    calSt.hidden = which !== "cal"
    slotSt.hidden = which !== "slots"
    const st = which === "cal" ? calSt : slotSt
    st.classList.remove("in-l", "in-r")
    void st.offsetWidth
    st.classList.add(which === "cal" ? "in-l" : "in-r")
  }

  // ── calendário (andar 1) ──
  function renderCal() {
    const el = document.getElementById("ags-cal")
    if (!el) return
    const parts = agMonth.split("-")
    const y = Number(parts[0]), m = Number(parts[1])
    const first = new Date(y, m - 1, 1)
    const curYm = todayYmd().slice(0, 7)
    const label = first.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    const daysIn = new Date(y, m, 0).getDate()
    const cells = []
    for (let i = 0; i < first.getDay(); i++) cells.push("<span></span>")
    for (let d = 1; d <= daysIn; d++) {
      const ymd = `${agMonth}-${String(d).padStart(2, "0")}`
      const past = ymd < todayYmd()
      cells.push(`<button type="button" class="cal-d${ymd === agDay ? " on" : ""}${ymd === todayYmd() ? " today" : ""}" data-ymd="${ymd}"${past ? " disabled" : ""}>${d}</button>`)
    }
    el.innerHTML = `
      <div class="cal-hd">
        <button id="cal-prev" class="cal-nav" type="button"${agMonth <= curYm ? " disabled" : ""}>‹</button>
        <b>${esc(label)}</b>
        <button id="cal-next" class="cal-nav" type="button">›</button>
      </div>
      <div class="cal-grid">
        ${["D", "S", "T", "Q", "Q", "S", "S"].map((w) => `<span class="cal-wd">${w}</span>`).join("")}
        ${cells.join("")}
      </div>`
    const shiftMonth = (delta) => {
      const nd = new Date(y, m - 1 + delta, 1)
      agMonth = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}`
      renderCal()
    }
    document.getElementById("cal-prev").addEventListener("click", () => shiftMonth(-1))
    document.getElementById("cal-next").addEventListener("click", () => shiftMonth(1))
    el.querySelectorAll(".cal-d").forEach((btn) => btn.addEventListener("click", () => {
      if (needSvc()) {
        // serviço primeiro — a duração dele define os horários
        const h = document.getElementById("ags-cal-hint")
        h.hidden = false
        h.classList.remove("shake"); void h.offsetWidth; h.classList.add("shake")
        return
      }
      agDay = btn.dataset.ymd
      el.querySelectorAll(".cal-d").forEach((x) => x.classList.toggle("on", x.dataset.ymd === agDay))
      sumOpen = false
      renderSum() // volta colapsado quando o usuário retornar ao andar 1
      openSlotStage()
    }))
  }

  // ── horários (andar 2) ──
  const ctaLabel = () => {
    const verb = re ? "Remarcar" : "Agendar"
    if (!selSlot) return `${verb} horário`
    const d = new Date(selSlot)
    const wd = d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" }).replace(".", "")
    return `${verb} ${wd}, ${fmtApptTime(selSlot)}`
  }
  const updateBtn = () => {
    const btn = document.getElementById("ags-btn")
    if (!btn) return
    btn.disabled = !selSlot
    btn.textContent = ctaLabel()
  }

  function openSlotStage() {
    const d = new Date(agDay + "T12:00:00")
    document.getElementById("ags-day-title").textContent =
      d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    document.getElementById("ags-day-sub").textContent =
      `${re ? (re.serviceName || "Sem serviço") : (agSvc ? svcById(agSvc).name : "Sem serviço")} · ${resName()}`
    showStage("slots")
    loadSlots()
  }

  async function loadSlots() {
    selSlot = null
    updateBtn()
    const el = document.getElementById("ags-slots")
    if (!el) return
    const resourceId = effRes()
    const date = agDay
    el.innerHTML = `<div class="ag-empty">Carregando horários…</div>`
    const r = await send({ type: "agendaSlots", resourceId, serviceId: effSvc() || null, date })
    const elNow = document.getElementById("ags-slots")
    if (!elNow) return
    if (effRes() !== resourceId || agDay !== date) return // filtro mudou no meio
    if (!r || !r.ok) { elNow.innerHTML = `<div class="ag-empty">${esc((r && r.error) || "Não deu pra buscar horários.")}</div>`; return }
    const slots = (r.data && r.data.slots) || []
    if (!slots.length) { elNow.innerHTML = `<div class="ag-empty">Sem horários livres neste dia — toque em ‹ e escolha outro no calendário.</div>`; return }
    // agrupado por período: parede única de horários é difícil de escanear
    const groups = [["Manhã", []], ["Tarde", []], ["Noite", []]]
    for (const sl of slots) {
      const h = new Date(sl.start).getHours()
      groups[h < 12 ? 0 : h < 18 ? 1 : 2][1].push(sl)
    }
    elNow.innerHTML = groups.filter((g) => g[1].length).map((g) => `
      <div class="slot-g"><small>${g[0]}</small>
        <div class="slots">${g[1].map((sl) => `<button type="button" class="slot" data-start="${esc(sl.start)}">${esc(fmtApptTime(sl.start))}</button>`).join("")}</div>
      </div>`).join("")
    elNow.querySelectorAll(".slot").forEach((btn) => btn.addEventListener("click", () => {
      elNow.querySelectorAll(".slot").forEach((x) => x.classList.remove("sel"))
      btn.classList.add("sel")
      selSlot = btn.dataset.start
      updateBtn()
    }))
  }

  document.getElementById("ags-back").addEventListener("click", () => showStage("cal"))
  document.getElementById("ags-btn").addEventListener("click", async () => {
    if (!selSlot) return
    const btn = document.getElementById("ags-btn")
    const errEl = document.getElementById("ags-err")
    errEl.hidden = true
    morphStart(btn)
    const res = re
      ? await send({ type: "agendaReschedule", appointmentId: re.appointmentId, startsAt: selSlot })
      : await send({
          type: "agendaBook",
          contactId: c.id,
          resourceId: agRes,
          serviceId: agSvc || null,
          startsAt: selSlot,
          notify: document.getElementById("ags-notify").value,
        })
    if (!res || !res.ok) {
      morphFail(btn, ctaLabel())
      errEl.textContent = (res && res.error) || (re ? "Não deu pra remarcar." : "Não deu pra marcar o horário.")
      errEl.hidden = false
      loadSlots() // o horário pode ter sido tomado — recarrega a grade
      return
    }
    morphSuccess(btn, () => {
      closeAgSheet()
      if (re) {
        alertHint("Horário remarcado ✓ — confirmação e lembretes reprogramados", true)
        refreshResolve()
        return
      }
      const msg = res.data && res.data.confirmMessage
      if (msg) {
        // "o sistema prepara, o humano dispara": pré-enche o composer — enviar é seu clique
        insertOkMsg = "Horário marcado ✓ — revise a mensagem e envie"
        parent.postMessage({ type: "kora:insert", text: msg }, "*")
      } else {
        alertHint("Horário marcado ✓", true)
      }
      refreshResolve()
    })
  })

  renderSum()
  renderCal()
}

// ── F2: negócio por dentro — itens + valores + cotação "Enviar nesta conversa" ──
const brl2 = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

async function renderDealDetail(dealId) {
  empty("⏳", "Abrindo negócio…", "Buscando itens e cotações.")
  const r = await send({ type: "dealDetail", dealId })
  if (!r || !r.ok) {
    if (r && r.status === 401) { session = { loggedIn: false }; renderState(); return }
    empty("⚠️", "Não deu pra abrir", (r && r.error) || "Erro de conexão com o servidor.")
    return
  }
  const d = r.data.deal
  const billTag = (it) =>
    it.billing === "monthly" ? ` · mensal${it.termMonths ? ` × ${it.termMonths}m` : ""}`
    : it.billing === "yearly" ? " · anual" : ""

  const discTag = (it) => it.discount > 0 ? ` · <span class="it-disc">−${brl2(it.discount)}${it.billing !== "one_time" ? "/mês" : ""}</span>` : ""
  const itemsHtml = d.items.length
    ? `<div class="sec">Itens · ${d.items.length}</div>
       <div class="card slim"><div class="list">
         ${d.items.map((it) => `
           <div class="it">
             <span class="it-l"><b>${esc(it.name)}</b><small>${it.qty} ${esc(it.unit)} × ${brl2(it.unitPrice)}${billTag(it)}${discTag(it)}</small></span>
             <span class="it-r">
               <span class="it-v">${brl2(it.lineTotal)}</span>
               <button class="it-del" data-item="${esc(it.id)}" data-name="${esc(it.name)}" type="button" title="Remover item" aria-label="Remover item">×</button>
             </span>
           </div>`).join("")}
         <div class="it tot">
           <span class="it-l"><b>Total do negócio</b>${d.totals.mrr > 0 ? `<small>MRR ${brl2(d.totals.mrr)}/mês</small>` : ""}</span>
           <span class="it-v">${brl2(d.totals.total)}</span>
         </div>
       </div></div>`
    : `<div class="empty inline">
         <div class="ico">📦</div>
         <b>Sem itens neste negócio</b>
         <p>Que tal lançar os primeiros? Busque no catálogo e adicione com um toque — a preço de tabela.</p>
       </div>`

  const STATUS = {
    draft:    ["Rascunho", "st-draft"],
    sent:     ["Enviada", "st-sent"],
    accepted: ["Aceita", "st-ok"],
    signed:   ["Assinada", "st-ok"],
    declined: ["Recusada", "st-bad"],
    void:     ["Cancelada", "st-void"],
  }
  const ICO_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
  const ICO_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`
  const quotesHtml = d.quotes.length
    ? d.quotes.map((qd) => {
        const st = STATUS[qd.status] || [qd.status, "st-draft"]
        const sendable = qd.status === "draft" || qd.status === "sent"
        return `
          <div class="quote${qd.status === "void" ? " muted" : ""}">
            <div class="q-t">
              <b>${esc(qd.code)}</b>
              <span class="chip ${st[1]}">${esc(st[0])}</span>
              <span class="q-v">${brl2((qd.totalCents || 0) / 100)}</span>
            </div>
            <div class="q-actions${sendable ? "" : " single"}">
              <button class="q-view" data-doc="${esc(qd.id)}" type="button" title="Abrir o PDF numa nova guia">${ICO_EYE}Visualizar</button>
              ${sendable ? `<button class="q-send" data-doc="${esc(qd.id)}" type="button">${ICO_SEND}Enviar nesta conversa</button>` : ""}
            </div>
          </div>`
      }).join("")
    : (d.items.length
        ? `<div class="hint">Nenhuma cotação ainda — gere a primeira. Ela congela itens e preços num PDF numerado.</div>`
        : "")

  setView(`
    <div class="frm-head">
      <button id="dd-back" class="back-btn" type="button">‹</button>
      <b>${esc(d.name || "Negócio")}</b>
      <a class="ext-lnk" title="Abrir negócio no Kora" target="_blank" rel="noreferrer" href="${esc(session.baseUrl)}/negocios/${esc(d.id)}">↗</a>
    </div>
    <div class="dd-meta">${esc(d.pipelineName || "")}${d.stageName ? ` · ${esc(d.stageName)}` : ""}</div>
    ${itemsHtml}
    <button id="dd-additems" class="btn btn-soft" type="button">＋ Adicionar itens</button>
    ${d.quotes.length || d.items.length ? `<div class="sec">Cotações${d.quotes.length ? ` · ${d.quotes.length}` : ""}</div>` : ""}
    ${quotesHtml}
    ${d.items.length ? `
      <button id="dd-quote" class="btn btn-primary" type="button">Compor cotação no Kora ↗</button>
      <div class="hint">Abre o compositor (validade, condições, observações e contrato, com preview). A cotação gerada aparece aqui pra enviar nesta conversa.</div>` : ""}`)

  document.getElementById("dd-back").addEventListener("click", () => renderFicha())
  // Gerar-às-cegas MORREU (owner 2026-07-20): documento numerado e imutável não
  // nasce de 1 clique sem validade/condições/contrato — o botão abre o COMPOSITOR
  // do app já no negócio; de volta ao chat, a lista mostra a nova pra enviar.
  const gen = document.getElementById("dd-quote")
  if (gen) gen.addEventListener("click", () => {
    window.open(`${session.baseUrl}/negocios/${encodeURIComponent(dealId)}/cotacao/nova`, "_blank", "noopener")
  })
  const addBtn = document.getElementById("dd-additems")
  if (addBtn) addBtn.addEventListener("click", () => renderComanda(dealId))
  // Remover item: confirma no próprio × (morfa spinner → some), recarrega o negócio.
  view.querySelectorAll(".it-del").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.busy) return
    b.dataset.busy = "1"; b.classList.add("busy"); b.textContent = "…"
    const res = await send({ type: "removeDealItem", dealId, itemId: b.dataset.item })
    if (!res || !res.ok) {
      b.dataset.busy = ""; b.classList.remove("busy"); b.textContent = "×"
      alertHint((res && res.error) || "Não deu pra remover o item.")
      return
    }
    alertHint(`Item removido ✓`, true)
    renderDealDetail(dealId)
  }))
  view.querySelectorAll(".q-view").forEach((b) => {
    b.addEventListener("click", () => viewQuote(b))
  })
  view.querySelectorAll(".q-send").forEach((b) => {
    b.addEventListener("click", () => sendQuoteHere(b, dealId))
  })
}

// ── COMANDA (owner 2026-07-20): capturar o pedido ditado na conversa ──────────
// Itens do catálogo + quantidade, a PREÇO DE TABELA — sem desconto, sem editar
// preço (negociar é no Kora ↗). Régua: capturar = extensão; trabalhar = app.
async function renderComanda(dealId) {
  empty("⏳", "Abrindo catálogo…", "Buscando produtos e serviços.")
  const res = await send({ type: "dealCatalog", dealId })
  if (!res || !res.ok) {
    if (res && res.status === 401) { session = { loggedIn: false }; renderState(); return }
    empty("😕", "Catálogo indisponível", (res && res.error) || "Tente de novo em instantes.")
    const back = document.createElement("button")
    back.className = "btn btn-soft"; back.type = "button"; back.textContent = "‹ Voltar pro negócio"
    back.addEventListener("click", () => renderDealDetail(dealId))
    view.appendChild(back)
    return
  }
  const catalog = res.data.items || []
  const SUFFIX = { monthly: "/mês", yearly: "/ano" }
  const sel = new Map()   // catalogItemId → qty
  let query = ""

  setView(`
    <div class="frm-head">
      <button id="cm-back" class="back-btn" type="button">‹</button>
      <b>Adicionar itens</b>
    </div>
    <div class="frm"><input id="cm-q" type="text" placeholder="Buscar no catálogo…" autocomplete="off"></div>
    <div id="cm-list"></div>
    <div class="cm-foot">
      <span id="cm-sum" class="cm-sum">Nenhum item selecionado</span>
      <button id="cm-save" class="btn btn-primary" type="button" disabled>Salvar no negócio</button>
      <div class="hint">Preço de tabela. Negociar preço, desconto ou prazo é no Kora — abra o negócio no ↗ acima.</div>
    </div>`)

  const listEl = document.getElementById("cm-list")
  const sumEl  = document.getElementById("cm-sum")
  const saveEl = document.getElementById("cm-save")

  const paintSum = () => {
    let n = 0, total = 0
    sel.forEach((qty, id) => {
      const it = catalog.find((c) => c.id === id)
      if (it) { n += 1; total += it.price * qty }
    })
    sumEl.textContent = n ? `${n} ${n === 1 ? "item" : "itens"} · ${brl2(total)}` : "Nenhum item selecionado"
    saveEl.disabled = n === 0
  }

  const paint = () => {
    const q = query.trim().toLowerCase()
    const rows = q
      ? catalog.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.sku || "").toLowerCase().includes(q) || (c.category || "").toLowerCase().includes(q))
      : catalog
    if (!rows.length) {
      listEl.innerHTML = catalog.length
        ? `<div class="hint" style="text-align:center;padding:18px 0">Nada encontrado com esse termo.</div>`
        : `<div class="empty inline"><div class="ico">🗂️</div><b>Catálogo vazio</b><p>Cadastre produtos e serviços no Kora pra lançar itens daqui.</p></div>`
      return
    }
    listEl.innerHTML = rows.map((c) => {
      const qty = sel.get(c.id) || 0
      return `
        <div class="cm-row">
          <span class="cm-l">
            <b>${esc(c.name)}</b>
            <small>${brl2(c.price)}${SUFFIX[c.billing] || ""}${c.unit && c.unit !== "un" ? ` · ${esc(c.unit)}` : ""}${c.category ? ` · ${esc(c.category)}` : ""}</small>
          </span>
          ${qty > 0
            ? `<span class="cm-step" data-id="${esc(c.id)}">
                 <button class="cm-dec" type="button" aria-label="Diminuir">−</button>
                 <b>${qty}</b>
                 <button class="cm-inc" type="button" aria-label="Aumentar">＋</button>
               </span>`
            : `<button class="cm-add" data-id="${esc(c.id)}" type="button">＋</button>`}
        </div>`
    }).join("")
    listEl.querySelectorAll(".cm-add").forEach((b) => b.addEventListener("click", () => {
      sel.set(b.dataset.id, 1); paint(); paintSum()
    }))
    listEl.querySelectorAll(".cm-step").forEach((s) => {
      const id = s.dataset.id
      s.querySelector(".cm-inc").addEventListener("click", () => {
        sel.set(id, Math.min(9999, (sel.get(id) || 0) + 1)); paint(); paintSum()
      })
      s.querySelector(".cm-dec").addEventListener("click", () => {
        const next = (sel.get(id) || 0) - 1
        if (next <= 0) sel.delete(id); else sel.set(id, next)
        paint(); paintSum()
      })
    })
  }

  document.getElementById("cm-back").addEventListener("click", () => renderDealDetail(dealId))
  document.getElementById("cm-q").addEventListener("input", (e) => { query = e.target.value; paint() })
  saveEl.addEventListener("click", async () => {
    const items = [...sel.entries()].map(([catalogItemId, quantity]) => ({ catalogItemId, quantity }))
    if (!items.length) return
    morphStart(saveEl)
    const r = await send({ type: "addDealItems", dealId, items })
    if (!r || !r.ok) {
      morphFail(saveEl, "Salvar no negócio")
      alertHint((r && r.error) || "Não deu pra lançar os itens.")
      return
    }
    morphSuccess(saveEl, () => {
      alertHint(`${r.data.added} ${r.data.added === 1 ? "item lançado" : "itens lançados"} no negócio ✓`, true)
      renderDealDetail(dealId)
    })
  })
  paint()
  paintSum()
}

// PDF congelado é IMUTÁVEL → cache de 1 entrada (Visualizar→Enviar baixa 1x só)
let pdfCache = { docId: null, file: null }

async function fetchQuotePdf(docId) {
  if (pdfCache.docId === docId && pdfCache.file) return { file: pdfCache.file }
  const r = await send({ type: "quotePdf", docId })
  if (!r || !r.ok) {
    if (r && r.status === 401) { session = { loggedIn: false }; renderState(); return { error: null } }
    return { error: (r && r.error) || "Não deu pra baixar o PDF." }
  }
  try {
    const bin = atob(r.data.b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const file = new File([bytes], r.data.fileName || "cotacao.pdf", { type: "application/pdf" })
    pdfCache = { docId, file }
    return { file }
  } catch (e) {
    return { error: "O PDF chegou corrompido — tente de novo." }
  }
}

// visualizar ANTES de enviar: abre o PDF no leitor nativo do Chrome (guia nova,
// tamanho real, zoom/impressão de graça — 360px de sidebar não é lugar de A4)
async function viewQuote(btn) {
  const original = btn.innerHTML
  btn.disabled = true
  btn.textContent = "Abrindo…"
  const r = await fetchQuotePdf(btn.dataset.doc)
  btn.disabled = false
  btn.innerHTML = original
  if (!r.file) {
    if (r.error) alertHint(r.error)
    return
  }
  const url = URL.createObjectURL(r.file)
  const tab = window.open(url, "_blank")
  if (!tab) alertHint("O Chrome bloqueou a guia — permita pop-ups e tente de novo.")
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// envio 1-clique: baixa o PDF congelado → File → content script anexa e envia
// no chat ABERTO → só marca ENVIADA no Kora depois do envio VERIFICADO.
let attachPending = null // um envio por vez (doutrina 1-clique = 1 ação)

async function sendQuoteHere(btn, dealId) {
  if (!currentChat || currentChat.kind !== "chat") {
    alertHint("Abra a conversa do cliente pra enviar.")
    return
  }
  if (attachPending) return
  const docId = btn.dataset.doc
  const original = btn.innerHTML
  btn.disabled = true
  btn.textContent = "Preparando PDF…"

  const r = await fetchQuotePdf(docId)
  if (!r.file) {
    btn.disabled = false
    btn.innerHTML = original
    if (r.error) alertHint(r.error)
    return
  }
  const file = r.file

  btn.textContent = "Enviando no chat…"
  const timeout = setTimeout(() => {
    if (!attachPending) return
    attachPending = null
    btn.disabled = false
    btn.innerHTML = original
    alertHint("O WhatsApp não respondeu — tente de novo.")
  }, 12000)

  attachPending = async (res) => {
    clearTimeout(timeout)
    attachPending = null
    if (res.ok && res.mode === "sent") {
      // confirmação no PRÓPRIO controle antes do refresh (doutrina de feedback)
      btn.classList.add("ok")
      btn.textContent = "✓ Enviada nesta conversa"
      const mk = await send({ type: "markQuoteSent", docId })
      if (mk && mk.ok) alertHint("Cotação enviada ✓", true)
      else alertHint("Enviada no chat — mas não consegui marcar no Kora. Marque no app.")
      setTimeout(() => renderDealDetail(dealId), 1400)
      return
    }
    btn.disabled = false
    btn.innerHTML = original
    if (res.ok && res.mode === "preview") {
      // estado honesto: anexou mas não confirmou o envio — o humano decide lá
      alertHint("Prévia aberta no WhatsApp — confirme o envio lá.", true)
      return
    }
    const why = {
      chat_changed: "Você trocou de conversa — volte pro chat do cliente e tente de novo.",
      busy:         "Já tem um anexo aberto no WhatsApp — envie ou cancele ele primeiro.",
      no_preview:   "Não consegui anexar aqui — envie pela ficha do negócio no app.",
      no_file:      "O arquivo se perdeu no caminho — tente de novo.",
    }
    alertHint(why[res.mode] || "Não deu pra enviar por aqui.")
  }
  parent.postMessage({ type: "kora:attach", file, expectPhone: currentChat.phone }, "*")
}

// resultado do anexo vem do content script
window.addEventListener("message", (ev) => {
  const d = ev.data || {}
  if (d.type !== "kora:attached") return
  if (attachPending) attachPending(d)
})

function alertHint(msg, ok) {
  let el = document.getElementById("flash")
  if (!el) {
    el = document.createElement("div")
    el.id = "flash"
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.className = ok ? "ok" : "bad"
  el.style.opacity = "1"
  setTimeout(() => { el.style.opacity = "0" }, 3200)
}

// ── doutrina de feedback: toda ação mutante confirma NO PRÓPRIO CONTROLE ──
// pending (spinner) → ✓ verde → estado final. Toast é reforço, nunca o único aviso.
function morphStart(btn) {
  btn.style.width = btn.offsetWidth + "px"
  void btn.offsetWidth
  btn.classList.add("loading")
  btn.disabled = true
}
function morphFail(btn, label) {
  btn.classList.remove("loading")
  btn.style.width = ""
  btn.disabled = false
  btn.textContent = label
}
function morphSuccess(btn, after, holdMs = 700) {
  btn.classList.add("success")
  setTimeout(after, holdMs)
}
function shakeForm(formEl) {
  formEl.classList.remove("shake")
  void formEl.offsetWidth
  formEl.classList.add("shake")
}

// ── form de novo negócio ──
async function renderNewDeal() {
  const c = lastResolve.contact
  const pipes = await getPipelines()
  if (!pipes.length) { alertHint("Nenhum funil ativo — configure no app."); return }

  const pipeOpts = pipes.map((p, i) => `<option value="${esc(p.id)}" ${i === 0 ? "selected" : ""}>${esc(p.name)}</option>`).join("")
  const stageOptsFor = (pipeId) => {
    const pipe = pipes.find((p) => p.id === pipeId)
    return (pipe ? pipe.stages.filter((s) => !s.terminal) : [])
      .map((s, i) => `<option value="${esc(s.id)}" ${i === 0 ? "selected" : ""}>${esc(s.name)}</option>`).join("")
  }

  setView(`
    <div class="frm-head"><button id="nd-back" class="back-btn" type="button">‹</button><b>Novo negócio</b><small>para ${esc(c.name || "contato")}</small></div>
    <form id="nd-form" class="frm">
      <label>Título<input id="nd-name" type="text" placeholder="Ex.: Plano Pro — 12 meses" /></label>
      <div class="frm-grid">
        <label>Funil<select id="nd-pipe">${pipeOpts}</select></label>
        <label>Etapa<select id="nd-stage">${stageOptsFor(pipes[0].id)}</select></label>
      </div>
      <label>Valor estimado (R$)<input id="nd-value" type="text" inputmode="decimal" placeholder="0,00" /></label>
      <div id="nd-err" class="err" hidden></div>
      <button id="nd-btn" class="btn btn-primary" type="submit">Criar negócio</button>
      <div class="hint">Nasce na etapa escolhida, com você como dono e evento na linha do tempo.</div>
    </form>`)

  document.getElementById("nd-back").addEventListener("click", () => renderFicha())
  document.getElementById("nd-pipe").addEventListener("change", (ev) => {
    document.getElementById("nd-stage").innerHTML = stageOptsFor(ev.target.value)
  })
  document.getElementById("nd-form").addEventListener("submit", async (ev) => {
    ev.preventDefault()
    const btn = document.getElementById("nd-btn")
    const errEl = document.getElementById("nd-err")
    const rawVal = document.getElementById("nd-value").value.trim()
    const value = rawVal ? Number(rawVal.replace(/\./g, "").replace(",", ".")) : null
    if (rawVal && (Number.isNaN(value) || value < 0)) {
      errEl.textContent = "Valor inválido."
      errEl.hidden = false
      return
    }
    morphStart(btn)
    const res = await send({
      type: "createDeal",
      contactId: c.id,
      name: document.getElementById("nd-name").value || null,
      pipelineId: document.getElementById("nd-pipe").value,
      stageId: document.getElementById("nd-stage").value,
      value,
    })
    if (!res || !res.ok) {
      morphFail(btn, "Criar negócio")
      errEl.textContent = (res && res.error) || "Não deu pra criar."
      errEl.hidden = false
      shakeForm(document.getElementById("nd-form"))
      return
    }
    morphSuccess(btn, () => {
      alertHint("Negócio criado ✓", true)
      refreshResolve()
    })
  })
}

// chat aberto vem do content script.
// Anti-refresh-fantasma (owner pegou 2026-07-16): só a IDENTIDADE (kind+telefone)
// re-renderiza — nome/avatar chegam ~1s DEPOIS da troca e não podem contar como
// "trocou de conversa" (contavam: ciclo completo de loading 2x por troca).
let chatDebounce = null
const chatIdOf = (ch) => (ch ? `${ch.kind}|${ch.phone || ""}` : "∅")

window.addEventListener("message", (ev) => {
  const d = ev.data || {}
  if (d.type !== "kora:chat") return
  const next = d.chat

  if (chatIdOf(next) === chatIdOf(currentChat)) {
    currentChat = next // absorve nome/avatar frescos SEM re-renderizar
    // leitura boa re-confirmou o chat atual → cancela estado ruim pendente
    if (chatDebounce) { clearTimeout(chatDebounce); chatDebounce = null }
    return
  }

  clearTimeout(chatDebounce)
  chatDebounce = null
  const apply = () => { currentChat = next; lastResolvedPhone = null; renderState() }
  // troca de conversa passa por estados transitórios (o bridge re-lê o fiber em
  // ~1s): segura 1 tick antes de mostrar unknown/lid/none — se for real, confirma
  const transient = next.kind === "unknown" || next.kind === "lid" || next.kind === "none"
  if (transient && currentChat && currentChat.kind === "chat") {
    chatDebounce = setTimeout(apply, 1400)
  } else {
    apply()
  }
})

// sessão pode mudar pelo popup (login/logout) — re-renderiza na hora
// (a menos que a animação do login esteja segurando o palco)
chrome.storage.onChanged.addListener(async () => {
  session = await send({ type: "status" })
  if (holdRender) return
  lastResolvedPhone = null
  renderState()
  refreshBadge() // login/logout refletem no badge do puxador
})

;(async () => {
  session = await send({ type: "status" })
  renderState()
  refreshBadge()
  parent.postMessage({ type: "kora:ready" }, "*")
})()
