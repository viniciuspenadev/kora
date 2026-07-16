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
  document.getElementById("qr-search").focus()
}
function closeSheet() {
  sheet.classList.remove("open")
  sheetBackdrop.classList.remove("open")
  sheet.setAttribute("aria-hidden", "true")
  setTimeout(() => { sheetBackdrop.hidden = true }, 260)
}
document.getElementById("sheet-close").addEventListener("click", closeSheet)
sheetBackdrop.addEventListener("click", closeSheet)
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
window.addEventListener("message", (ev) => {
  const d = ev.data || {}
  if (d.type !== "kora:inserted") return
  if (d.ok) {
    closeSheet()
    alertHint("Inserido no campo — revise e envie ✓", true)
  } else {
    alertHint("Não achei o campo de mensagem. Clique no chat e tente de novo.")
  }
})

function empty(ico, title, text, extraHtml = "") {
  setView(`<div class="empty"><div class="ico">${ico}</div><b>${esc(title)}</b><p>${esc(text)}</p>${extraHtml}</div>`)
}

function renderChrome() {
  const brandLogo = document.getElementById("brand-logo")
  if (session && session.loggedIn) {
    brandLogo.hidden = false
    acct.hidden = false
    acctName.textContent = (session.tenant && session.tenant.name) || "Kora"
    footUser.textContent = (session.user && session.user.name) || (session.user && session.user.email) || "—"
  } else {
    // deslogado: o logo mora DENTRO do bloco de login, acima do título
    brandLogo.hidden = true
    acct.hidden = true
    footUser.textContent = "Desconectado"
  }
}

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
    empty("💬", "Nenhuma conversa aberta", "Abra uma conversa no WhatsApp pra ver o contato no Kora.")
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
      btn.disabled = true
      btn.textContent = "Cadastrando…"
      const chk = document.getElementById("cc-save-photo")
      const res = await send({
        type: "createContact",
        name: document.getElementById("cc-name").value,
        phone,
        photoUrl: chk && chk.checked ? currentChat.avatar : undefined,
      })
      if (!res || !res.ok) {
        btn.disabled = false
        btn.textContent = "Cadastrar contato"
        errEl.textContent = (res && res.error) || "Não deu pra cadastrar."
        errEl.hidden = false
        return
      }
      refreshResolve()
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
          <div class="deal-t"><b>${esc(d.name || "Negócio")}</b><span class="deal-v">${brl(d.value)}</span></div>
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

  setView(`
    <div class="contact">
      <div class="avatar">${esc(initials(c.name || (currentChat && currentChat.name)))}</div>
      <div style="min-width:0">
        <span class="nm-row">
          <b>${esc(c.name || (currentChat && currentChat.name) || "Sem nome")}</b>
          <a class="ext-lnk" title="Abrir ficha no Kora" target="_blank" href="${esc(session.baseUrl)}/contatos/${esc(c.id)}">↗</a>
        </span>
        <span class="ph">${fmtPhone(c.phone || (currentChat && currentChat.phone))}</span>
      </div>
    </div>
    <button id="new-deal" class="btn btn-primary" type="button">＋ Novo negócio</button>
    ${dealsBlock}`)

  document.getElementById("dock").hidden = false

  // mover etapa
  view.querySelectorAll(".stage-sel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      sel.disabled = true
      const res = await send({ type: "moveStage", dealId: sel.dataset.deal, stageId: sel.value })
      if (!res || !res.ok) { alertHint((res && res.error) || "Não deu pra mover."); }
      refreshResolve()
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
      if (!res || !res.ok) { alertHint((res && res.error) || "Não deu pra salvar."); b.disabled = false; b.textContent = "Salvar nota"; return }
      ta.value = ""
      b.disabled = false
      b.textContent = "Salvar nota"
      document.getElementById(`nb-${b.dataset.deal}`).hidden = true
      alertHint("Nota salva na linha do tempo ✓", true)
    })
  })
  const newDealBtn = document.getElementById("new-deal")
  if (newDealBtn) newDealBtn.addEventListener("click", renderNewDeal)
}

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
  setTimeout(() => { el.style.opacity = "0" }, 2600)
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
    btn.disabled = true
    btn.textContent = "Criando…"
    const res = await send({
      type: "createDeal",
      contactId: c.id,
      name: document.getElementById("nd-name").value || null,
      pipelineId: document.getElementById("nd-pipe").value,
      stageId: document.getElementById("nd-stage").value,
      value,
    })
    if (!res || !res.ok) {
      btn.disabled = false
      btn.textContent = "Criar negócio"
      errEl.textContent = (res && res.error) || "Não deu pra criar."
      errEl.hidden = false
      return
    }
    refreshResolve()
  })
}

// chat aberto vem do content script
window.addEventListener("message", (ev) => {
  const d = ev.data || {}
  if (d.type === "kora:chat") {
    const changed = JSON.stringify(d.chat) !== JSON.stringify(currentChat)
    currentChat = d.chat
    if (changed) { lastResolvedPhone = null; renderState() }
  }
})

// sessão pode mudar pelo popup (login/logout) — re-renderiza na hora
// (a menos que a animação do login esteja segurando o palco)
chrome.storage.onChanged.addListener(async () => {
  session = await send({ type: "status" })
  if (holdRender) return
  lastResolvedPhone = null
  renderState()
})

;(async () => {
  session = await send({ type: "status" })
  renderState()
  parent.postMessage({ type: "kora:ready" }, "*")
})()
