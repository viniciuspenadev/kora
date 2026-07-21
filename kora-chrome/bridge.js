// Kora Companion — bridge (MAIN world).
// O WhatsApp removeu o JID do DOM (data-id virou hash opaco), então lemos o
// chat ativo direto das props do React (fiber) do painel #main — a fonte real.
// Este script roda no contexto da PÁGINA (world: MAIN) e publica o resultado
// via postMessage pro content script (world isolado). Só LEITURA — nada de
// chamar métodos internos, nada de enviar.

;(() => {
  if (window.__koraBridge) return
  window.__koraBridge = true

  function fiberOf(el) {
    if (!el) return null
    const key = Object.keys(el).find(
      (k) => k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0,
    )
    return key ? el[key] : null
  }

  // Wid com telefone real? ({ server: "c.us", user: "5511..." })
  function widPhone(v) {
    try {
      return v && typeof v === "object" && v.server === "c.us" && /^\d{7,15}$/.test(String(v.user || ""))
        ? String(v.user)
        : null
    } catch (e) { return null }
  }

  // Varre as props próprias do objeto atrás de um Wid c.us (getters podem lançar).
  function scanForPhone(obj) {
    if (!obj || typeof obj !== "object") return null
    let names = []
    try { names = Object.getOwnPropertyNames(obj) } catch (e) { return null }
    for (let i = 0; i < names.length && i < 150; i++) {
      let v
      try { v = obj[names[i]] } catch (e) { continue }
      const p = widPhone(v)
      if (p) return p
    }
    return null
  }

  // Contas migradas pro @lid: o chat.id esconde o telefone, mas o CONTATO do
  // chat carrega ele (o app precisa exibir o número). Cava nos campos
  // conhecidos e, em último caso, varre as props.
  let lidDebug = null
  function phoneFromChat(cand, id) {
    if (id && widPhone(id)) return String(id.user)
    const contact = cand.contact || cand.__x_contact || null
    const known = [
      cand.phoneNumber, cand.__x_phoneNumber,
      contact && contact.phoneNumber,
      contact && contact.__x_phoneNumber,
    ]
    for (const v of known) {
      const p = widPhone(v)
      if (p) return p
    }
    const scanned = scanForPhone(cand) || scanForPhone(contact)
    if (scanned) return scanned
    // não achou: registra os campos disponíveis pro diagnóstico
    try {
      const keys = Object.getOwnPropertyNames(cand).slice(0, 40).join(",")
      const ckeys = contact ? Object.getOwnPropertyNames(contact).slice(0, 40).join(",") : "(sem contact)"
      lidDebug = `lid sem phone · chat[${keys}] · contact[${ckeys}]`
    } catch (e) { lidDebug = "lid sem phone (introspecção falhou)" }
    return null
  }

  function chatFromProps(p) {
    if (!p) return null
    const cand = p.chat || (p.data && p.data.chat) || (p.value && p.value.chat) || null
    const id = cand && cand.id
    if (!id || (!id._serialized && !id.user)) return null

    let phone = null
    try { phone = phoneFromChat(cand, id) } catch (e) { phone = null }

    return {
      user:       phone || id.user || null,
      server:     phone ? "c.us" : id.server || null,    // telefone resolvido = tratamos como c.us
      serialized: id._serialized || null,
      title:      cand.formattedTitle || cand.name || null,
    }
  }

  function findActiveChat() {
    const main = document.querySelector("#main")
    let node = fiberOf(main)
    // 1) sobe a árvore (o Conversation container costuma estar acima do #main)
    let hops = 0
    let cursor = node
    while (cursor && hops++ < 80) {
      const hit = chatFromProps(cursor.memoizedProps)
      if (hit) return hit
      cursor = cursor.return
    }
    // 2) desce (BFS limitada) — cobre builds onde o chat é prop de um filho
    const queue = node ? [node] : []
    let seen = 0
    while (queue.length && seen++ < 400) {
      const cur = queue.shift()
      const hit = chatFromProps(cur.memoizedProps)
      if (hit) return hit
      if (cur.child) queue.push(cur.child)
      if (cur.sibling) queue.push(cur.sibling)
    }
    return null
  }

  setInterval(() => {
    let payload
    try {
      lidDebug = null
      const chat = findActiveChat()
      payload = { __kora: true, type: "bridge:chat", chat, err: lidDebug }
    } catch (e) {
      payload = { __kora: true, type: "bridge:chat", chat: null, err: String(e).slice(0, 160) }
    }
    window.postMessage(payload, "*")
  }, 1000)
})()
