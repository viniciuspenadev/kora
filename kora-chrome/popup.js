// Kora Companion — popup (login / sessão do dispositivo)

const form = document.getElementById("form")
const logged = document.getElementById("logged")
const err = document.getElementById("err")
const submit = document.getElementById("submit")

const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))

async function render() {
  const st = await send({ type: "status" })
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
  const r = await send({
    type: "login",
    email: document.getElementById("email").value,
    password: document.getElementById("password").value,
    baseUrl: document.getElementById("base").value || undefined,
    label: `Chrome · ${navigator.platform || "?"}`,
  })
  submit.disabled = false
  submit.textContent = "Conectar"
  if (!r || !r.ok) {
    err.textContent = (r && r.error) || "Não deu pra conectar. Confira o servidor."
    err.hidden = false
    return
  }
  render()
})

document.getElementById("logout").addEventListener("click", async () => {
  await send({ type: "logout" })
  render()
})

render()
