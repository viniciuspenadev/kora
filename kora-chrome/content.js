// Kora Companion — content script.
// Lê o DOM (chat aberto), injeta puxador + iframe da sidebar e executa as ações
// 1-clique no chat ABERTO (F1 inserir rascunho · F2 anexar+enviar cotação).
// Doutrina: toda execução aqui é resultado direto de UM clique humano na
// sidebar, uma por vez, só na conversa aberta — nunca massa/agendado.
// Seletores do WhatsApp são ofuscados: tudo aqui usa padrões ESTRUTURAIS
// ([data-id], header, span[title], [data-icon]) — nunca classes geradas.

;(() => {
  if (window.__koraCompanion) return
  window.__koraCompanion = true

  let open = sessionStorage.getItem("kora-open") === "1"
  let lastKey = ""

  // ── puxador (borda direita) — logo oficial em branco, na vertical ──
  const edge = document.createElement("div")
  edge.id = "kora-edge"
  edge.title = "Abrir Kora"
  const logo = document.createElement("img")
  logo.className = "kora-edge-logo"
  logo.src = chrome.runtime.getURL("assets/logo.svg")
  logo.alt = "Kora"
  edge.appendChild(logo)
  // badge do Radar do Dia (contagem vem da sidebar via kora:badge)
  const badge = document.createElement("span")
  badge.className = "kora-edge-badge"
  badge.hidden = true
  edge.appendChild(badge)
  edge.addEventListener("click", () => setOpen(true))

  // ── sidebar (iframe de página da extensão — imune ao CSP da página) ──
  const wrap = document.createElement("div")
  wrap.id = "kora-wrap"
  const frame = document.createElement("iframe")
  frame.src = chrome.runtime.getURL("sidebar.html")
  frame.allow = ""
  wrap.appendChild(frame)

  document.documentElement.appendChild(edge)
  document.documentElement.appendChild(wrap)

  // ── empurrão do WhatsApp (adaptativo, inline + !important) ──
  // FLUIDEZ (lição 2026-07-16): NUNCA animar `width` do #app — cada frame
  // reflui o WhatsApp inteiro (lista virtualizada + milhares de nós) = abre
  // travado. Coreografia certa: o painel desliza POR CIMA (transform/GPU) e o
  // app reflui UMA vez só, escondido embaixo do painel — no FIM do slide ao
  // abrir, no INÍCIO ao fechar. Depois MEDE: se o app não encolheu de verdade
  // (miolo ignora o pai), escala o alvo pro <body>.
  const PUSH_W = 360
  const PUSH_MS = 320
  let pushEl = null
  let pushTimer = null

  // width (não margin!): o WhatsApp seta width:100% explícito no app/body, e
  // largura explícita NÃO encolhe com margem — só "vaza". calc(100% - painel)
  // sobrepõe o 100% deles e força o reflow real. transform prende os fixed.
  // SEM transition — o snap é proposital (1 reflow, invisível sob o painel).
  function setPush(el, on) {
    if (!el) return
    el.style.removeProperty("transition")
    el.style.setProperty("transform", "translateZ(0)")
    el.style.setProperty("width", on ? `calc(100% - ${PUSH_W}px)` : "100%", "important")
    if (!on) {
      setTimeout(() => {
        if (!open && el === pushEl) clearPush(el)
      }, PUSH_MS + 80)
    }
  }
  function clearPush(el) {
    if (!el) return
    el.style.removeProperty("width")
    el.style.removeProperty("transform")
    el.style.removeProperty("transition")
  }
  function applyPush(on) {
    const target = document.getElementById("app") || document.body
    if (pushEl && pushEl !== target) clearPush(pushEl)
    pushEl = target
    clearTimeout(pushTimer)
    if (on) {
      // abre espaço só quando o painel JÁ cobriu a faixa (fim do slide)
      pushTimer = setTimeout(() => {
        if (!open) return
        setPush(target, true)
        setTimeout(() => {
          if (!open || !pushEl) return
          const r = pushEl.getBoundingClientRect()
          // não encolheu? sobe o alvo pro body.
          if (r.width > window.innerWidth - PUSH_W / 2 && pushEl !== document.body) {
            clearPush(pushEl)
            pushEl = document.body
            setPush(document.body, true)
          }
        }, 60)
      }, PUSH_MS)
    } else {
      // solta o app NA HORA — ele reflui embaixo do painel que ainda está saindo
      setPush(target, false)
    }
  }

  function setOpen(v) {
    open = v
    sessionStorage.setItem("kora-open", v ? "1" : "0")
    document.documentElement.classList.toggle("kora-open", v)
    applyPush(v)
    if (v) sendChat(true)
  }
  document.documentElement.classList.toggle("kora-open", open)
  if (open) applyPush(true)

  // ── inserir rascunho no composer (regra de ouro: preencher SIM, enviar NUNCA) ──
  // O composer é um editor React (Lexical) que aplica a edição ASSINCRONAMENTE.
  // Por isso: UM caminho por vez, e a verificação espera o editor commitar —
  // senão o fallback dispara junto e o texto entra em dobro.
  function composerBox() {
    const main = document.querySelector("#main")
    return (
      (main && main.querySelector('footer [contenteditable="true"]')) ||
      (main && main.querySelector('[contenteditable="true"][data-tab]')) ||
      null
    )
  }

  function insertDraft(text, cb) {
    const box = composerBox()
    if (!box) return cb(false)
    box.focus()
    const before = box.textContent || ""

    // caminho 1: paste sintético (o Lexical trata nativamente, uma vez só)
    try {
      const dt = new DataTransfer()
      dt.setData("text/plain", text)
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
    } catch (e) { /* segue pro fallback */ }

    setTimeout(() => {
      if ((box.textContent || "") !== before) return cb(true)
      // caminho 2 (só se o paste não surtiu efeito): insertText
      try {
        box.focus()
        document.execCommand("insertText", false, text)
      } catch (e) { /* verificação decide */ }
      setTimeout(() => cb((box.textContent || "") !== before), 160)
    }, 160)
  }

  // ── anexar arquivo no chat aberto (F2: cotação 1-clique) ──
  // paste sintético com o File no composer → a prévia de anexo do WhatsApp abre
  // → clica o enviar DA PRÉVIA (send fora do footer do #main) → verifica que ela
  // fechou. Fallback: drop no #main. Antes de tudo confere que o chat ainda é o
  // esperado (trocou de conversa no meio = aborta, nunca envia no chat errado).
  function previewSendButton() {
    const icons = document.querySelectorAll('span[data-icon="send"], span[data-icon="wds-ic-send-filled"]')
    for (let i = 0; i < icons.length; i++) {
      if (icons[i].closest("#main footer")) continue // send do composer ≠ send da prévia
      const btn = icons[i].closest('[role="button"], button') || icons[i].parentElement
      if (btn && btn.offsetParent !== null) return btn
    }
    return null
  }

  function waitFor(probe, timeoutMs, cb) {
    const t0 = Date.now()
    const iv = setInterval(() => {
      const v = probe()
      if (v || Date.now() - t0 > timeoutMs) { clearInterval(iv); cb(v || null) }
    }, 120)
  }

  function clickPreviewSend(btn, cb) {
    btn.click()
    // prévia fechou = mensagem saiu; se não fechar, ficou aberta pro humano confirmar
    waitFor(() => (previewSendButton() ? null : true), 4000, (closed) => {
      cb(closed ? { ok: true, mode: "sent" } : { ok: true, mode: "preview" })
    })
  }

  function attachFile(payload, cb) {
    const chat = currentChat()
    if (!chat || chat.kind !== "chat" || (payload.expectPhone && chat.phone !== payload.expectPhone)) {
      return cb({ ok: false, mode: "chat_changed" })
    }
    const file = payload.file
    if (!(file instanceof File)) return cb({ ok: false, mode: "no_file" })
    const main = document.querySelector("#main")
    if (!main) return cb({ ok: false, mode: "chat_changed" })
    // já existe uma prévia de anexo aberta (do humano)? NUNCA clicar o enviar dela.
    if (previewSendButton()) return cb({ ok: false, mode: "busy" })

    const dt = new DataTransfer()
    try { dt.items.add(file) } catch (e) { return cb({ ok: false, mode: "no_file" }) }

    // caminho 1: paste sintético no composer (mesmo canal do Ctrl+V real)
    const box = composerBox()
    if (box) {
      box.focus()
      try {
        box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
      } catch (e) { /* segue pro drop */ }
    }
    waitFor(previewSendButton, 1600, (btn) => {
      if (btn) return clickPreviewSend(btn, cb)
      // caminho 2: drop no chat (o WhatsApp aceita arquivo arrastado no #main)
      try {
        const opts = { dataTransfer: dt, bubbles: true, cancelable: true }
        main.dispatchEvent(new DragEvent("dragenter", opts))
        main.dispatchEvent(new DragEvent("dragover", opts))
        main.dispatchEvent(new DragEvent("drop", opts))
      } catch (e) { /* verificação decide */ }
      waitFor(previewSendButton, 2400, (btn2) => {
        if (btn2) return clickPreviewSend(btn2, cb)
        cb({ ok: false, mode: "no_preview" })
      })
    })
  }

  // Mensagens vindas da sidebar (origem verificada pelo source do iframe).
  window.addEventListener("message", (ev) => {
    if (ev.source !== frame.contentWindow) return
    const d = ev.data || {}
    if (d.type === "kora:close") setOpen(false)
    if (d.type === "kora:ready") sendChat(true)
    if (d.type === "kora:insert") {
      insertDraft(String(d.text || ""), (ok) => {
        frame.contentWindow.postMessage({ type: "kora:inserted", ok }, "*")
      })
    }
    if (d.type === "kora:attach") {
      attachFile(d, (result) => {
        frame.contentWindow.postMessage(Object.assign({ type: "kora:attached" }, result), "*")
      })
    }
    if (d.type === "kora:badge") {
      const n = Number(d.count) || 0
      badge.textContent = n > 99 ? "99+" : String(n)
      badge.hidden = n <= 0
    }
    if (d.type === "kora:open-chat") {
      // Radar → abrir a conversa do contato. Rota /send do próprio WhatsApp Web:
      // recarrega a página (aceito no v1) e o `text` já pousa no composer como
      // RASCUNHO nativo — enviar continua sendo o clique do humano.
      const digits = String(d.phone || "").replace(/\D/g, "")
      if (!digits) return
      const url = "https://web.whatsapp.com/send/?phone=" + digits +
        (d.text ? "&text=" + encodeURIComponent(String(d.text)) : "")
      window.location.href = url
    }
  })

  // ── bridge (MAIN world): chat ativo direto das props do React ──
  // Fonte PRIMÁRIA desde que o WhatsApp tirou o JID do DOM. O bridge.js publica
  // {user, server} a cada 1s; guardamos o último com carimbo de frescor.
  let bridgeChat = null
  let bridgeAt = 0
  let bridgeErr = null
  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return
    const d = ev.data
    if (!d || d.__kora !== true || d.type !== "bridge:chat") return
    bridgeChat = d.chat || null
    bridgeErr = d.err || null
    bridgeAt = Date.now()
  })

  // ── watcher do chat aberto ──
  // Camadas de detecção:
  //  0) bridge (React fiber, MAIN world) — a fonte real
  //  1) [data-id] das mensagens (formato clássico `_<digits>@c.us_`)
  //  2) título do header quando ele é o próprio número
  //  3) varredura por JID no HTML do #main
  //  4) @lid (ID que esconde o telefone) → estado próprio
  //  5) nada → estado "unknown" COM diagnóstico pro suporte
  let deepKey = ""
  let deepVal = null

  function deepScan(main) {
    const html = main.innerHTML
    let m = /(\d{7,15})@g\.us/.exec(html)
    if (m) return { kind: "group" }
    m = /(\d{7,15})@c\.us/.exec(html)
    if (m) return { kind: "chat", phone: m[1] }
    if (html.indexOf("@lid") !== -1) return { kind: "lid" }
    return null
  }

  // Amostra dos atributos data-* presentes no chat — vira print de suporte
  // quando nenhuma camada consegue ler (nos diz o formato novo do WhatsApp).
  function collectDiag(main) {
    const seen = new Map()
    const els = main.querySelectorAll("*")
    for (let i = 0; i < els.length && seen.size < 6; i++) {
      for (const a of els[i].attributes) {
        if (a.name.indexOf("data-") === 0 && !seen.has(a.name)) seen.set(a.name, String(a.value).slice(0, 70))
      }
    }
    const out = []
    seen.forEach((v, k) => out.push(k + '="' + v + '"'))
    const bridgeInfo = bridgeAt
      ? `bridge: ${bridgeChat ? JSON.stringify({ server: bridgeChat.server, user: bridgeChat.user ? "…" + String(bridgeChat.user).slice(-4) : null }) : "sem chat"}${bridgeErr ? " · err: " + bridgeErr : ""} (há ${Math.round((Date.now() - bridgeAt) / 1000)}s)`
      : "bridge: nunca respondeu (recarregue a página)"
    return bridgeInfo + "\n" + (out.join("\n") || "(nenhum atributo data-* dentro de #main)")
  }

  function currentChat() {
    const main = document.querySelector("#main")
    if (!main) return { kind: "none" }
    const header = main.querySelector("header")
    const name =
      (header && header.querySelector("span[title]") && header.querySelector("span[title]").getAttribute("title")) ||
      (header && header.textContent ? header.textContent.trim().slice(0, 80) : null) ||
      null

    // foto de perfil visível no header — só CDN oficial do WhatsApp
    let avatar = null
    const img = header && header.querySelector("img")
    if (img && img.src) {
      try {
        const h = new URL(img.src).hostname
        if (img.src.indexOf("https://") === 0 && /(^|\.)(whatsapp\.net|fbcdn\.net)$/.test(h)) avatar = img.src
      } catch (e) { /* src inválido — ignora */ }
    }

    // 0) bridge (fonte real; aceita leitura de até 3s atrás)
    if (bridgeChat && Date.now() - bridgeAt < 3000) {
      const b = bridgeChat
      const title = b.title || name
      if (b.server === "g.us") return { kind: "group", name: title }
      if (b.server === "lid")  return { kind: "lid", name: title, diag: collectDiag(main) }
      if (b.user && /^\d{7,15}$/.test(String(b.user))) return { kind: "chat", phone: String(b.user), name: title, avatar }
    }

    // 1) data-id clássico
    const rows = main.querySelectorAll("[data-id]")
    for (let i = rows.length - 1; i >= 0; i--) {
      const m = /_(\d{7,15})@(c|g)\.us/.exec(rows[i].getAttribute("data-id") || "")
      if (m) return m[2] === "g" ? { kind: "group", name } : { kind: "chat", phone: m[1], name, avatar }
    }
    // 2) título é o próprio número
    const digits = (name || "").replace(/\D/g, "")
    if (digits.length >= 8 && /^[+\d\s()\-.]+$/.test(name || "")) return { kind: "chat", phone: digits, name, avatar }
    // 3) varredura profunda (cacheada por chat; re-tenta enquanto não achar —
    //    as mensagens podem ainda não ter renderizado no primeiro tick)
    const key = name || "?"
    if (deepKey !== key || !deepVal) {
      deepKey = key
      deepVal = deepScan(main)
    }
    if (deepVal) {
      if (deepVal.kind === "chat")  return { kind: "chat", phone: deepVal.phone, name, avatar }
      if (deepVal.kind === "group") return { kind: "group", name }
      if (deepVal.kind === "lid")   return { kind: "lid", name }
    }
    if (!name) return { kind: "none" }
    return { kind: "unknown", name, diag: collectDiag(main) }
  }

  function sendChat(force) {
    const chat = currentChat()
    const key = JSON.stringify(chat)
    if (!force && key === lastKey) return
    lastKey = key
    // Conteúdo não-sensível (nome+telefone já visíveis na tela do usuário);
    // o iframe é página da própria extensão.
    if (frame.contentWindow) frame.contentWindow.postMessage({ type: "kora:chat", chat }, "*")
  }

  // Poll barato (1s) — resiliente a re-render do WhatsApp; MutationObserver
  // fino fica pro refino quando os seletores estabilizarem no piloto.
  // Também re-afirma o empurrão se o WhatsApp trocar o nó raiz no meio.
  setInterval(() => {
    sendChat(false)
    if (open && pushEl && !document.contains(pushEl)) applyPush(true)
  }, 1000)
})()
