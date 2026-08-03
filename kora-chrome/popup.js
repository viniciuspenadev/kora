// Kora Companion — popup (login / sessão do dispositivo)

const form = document.getElementById("form")
const codeForm = document.getElementById("code-form")
const logged = document.getElementById("logged")
const err = document.getElementById("err")
const submit = document.getElementById("submit")

const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))

async function render() {
  const st = await send({ type: "status" })
  codeForm.hidden = true
  if (st && st.loggedIn) {
    form.hidden = true
    logged.hidden = false
    document.getElementById("who-name").textContent = (st.user && (st.user.name || st.user.email)) || "Conectado"
    document.getElementById("who-tenant").textContent = (st.tenant && st.tenant.name) || ""
  } else {
    logged.hidden = true
    form.hidden = false
    document.getElementById("base").value = (st && st.baseUrl) || ""
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault()
  err.hidden = true
  submit.disabled = true
  submit.textContent = "Conectando…"
  const email = document.getElementById("email").value
  const r = await send({
    type: "login",
    email,
    password: document.getElementById("password").value,
    baseUrl: document.getElementById("base").value || undefined,
    label: `Chrome · ${navigator.platform || "?"}`,
  })
  submit.disabled = false
  submit.textContent = "Conectar"
  // Dispositivo novo (device trust F6): servidor mandou código pro e-mail.
  if (r && !r.ok && r.code === "device_challenge") {
    form.hidden = true
    codeForm.hidden = false
    document.getElementById("code-email").textContent = email
    document.getElementById("code").focus()
    codeForm.dataset.email = email
    return
  }
  if (!r || !r.ok) {
    err.textContent = (r && r.error) || "Não deu pra conectar. Confira o servidor."
    err.hidden = false
    return
  }
  render()
})

document.getElementById("code").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6)
})
document.getElementById("code-back").addEventListener("click", (e) => {
  e.preventDefault()
  codeForm.hidden = true
  form.hidden = false
})
codeForm.addEventListener("submit", async (ev) => {
  ev.preventDefault()
  const codeErr = document.getElementById("code-err")
  const codeSubmit = document.getElementById("code-submit")
  codeErr.hidden = true
  codeSubmit.disabled = true
  codeSubmit.textContent = "Verificando…"
  const r = await send({
    type: "loginVerify",
    email: codeForm.dataset.email || "",
    code: document.getElementById("code").value,
    label: `Chrome · ${navigator.platform || "?"}`,
  })
  codeSubmit.disabled = false
  codeSubmit.textContent = "Confirmar dispositivo"
  if (!r || !r.ok) {
    codeErr.textContent = (r && r.error) || "Código incorreto. Tente de novo."
    codeErr.hidden = false
    return
  }
  render()
})

document.getElementById("logout").addEventListener("click", async () => {
  await send({ type: "logout" })
  render()
})

render()
