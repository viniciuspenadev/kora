"use server"

import { headers } from "next/headers"
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"
import { validatePassword } from "@/lib/password"
import { verifyTurnstile } from "@/lib/turnstile"
import { rateLimit } from "@/lib/rate-limit"
import { applyDefaultModules } from "@/lib/modules"
import { applyPlan, getSignupTrialPlan } from "@/lib/plans"
import { sendEmail, buildVerificationEmail } from "@/lib/email/send"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"

type Result = { ok: boolean; error?: string }

/**
 * Política aceita no cadastro. ⚠️ Precisa bater com o link que o formulário mostra
 * (`components/signup/signup-client.tsx`) — guardar uma URL que a pessoa não viu seria
 * pior que não guardar nada.
 */
const PRIVACY_POLICY_URL = "https://www.omnikora.com.br/privacidade"

const CODE_TTL_MIN = 15
const MAX_ATTEMPTS = 6
const RESEND_THROTTLE_MS = 60_000

const RESERVED = new Set([
  "admin","api","auth","setup","invite","inbox","kanban","contatos","configuracoes",
  "automacao","w","app","www","help","support","docs","blog","public","static",
  "null","undefined","signup","templates","integracoes","relatorios",
])

const DEFAULT_STAGES = [
  { name: "Triagem",     color: "#94A3B8", prob: 0,   triage: true },
  { name: "Lead",        color: "#3B82F6", prob: 20 },
  { name: "Qualificado", color: "#8B5CF6", prob: 40 },
  { name: "Proposta",    color: "#F59E0B", prob: 70 },
  { name: "Ganho",       color: "#10B981", prob: 100, won: true },
  { name: "Perdido",     color: "#EF4444", prob: 0,   lost: true },
] as const

// ── helpers ───────────────────────────────────────────────────────
const digits  = (s?: string) => (s ?? "").replace(/\D/g, "")
const isEmail = (s: string)  => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254

// Hash do código com PEPPER (HMAC) — segredo do servidor, nunca no banco. Mesmo
// que `signup_verifications` vaze, sem o pepper o code_hash é irreversível (um
// SHA puro de 6 dígitos = rainbow-table trivial de 1M). Default = AUTH_SECRET
// (sempre setado em prod); override opcional via OTP_PEPPER.
const OTP_PEPPER = process.env.OTP_PEPPER || process.env.AUTH_SECRET || "kora-otp-dev-pepper"
const hashCode = (code: string) => crypto.createHmac("sha256", OTP_PEPPER).update(code).digest("hex")

// ⚠️ Os validadores de CPF/CNPJ VIVIAM AQUI, duplicados de `lib/masks.ts` (2026-08-04).
//    Fórmulas diferentes, resultado igual — conferido caso a caso: `(soma*10) % 11` e
//    `11 - (soma % 11)` colapsam no mesmo dígito nos 11 restos possíveis, e os pesos
//    explícitos do CNPJ reproduzem exatamente o `pos--` com reset em 9.
//    Foram removidos porque duas cópias do mesmo julgamento é como o cadastro e a tela
//    de cobrança passam a discordar sobre o que é um documento válido — e a discordância
//    não aparece como erro, aparece como cliente barrado sem explicação.
//    Hoje a validação toda mora em `lib/billing/fiscal-profile.ts`, que importa de `masks`.

function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36)
}

async function clientIp(): Promise<string | undefined> {
  const h = await headers()
  // NÃO confiar no IP mais à ESQUERDA do X-Forwarded-For (é fornecido pelo cliente
  // e spoofável). O proxy (Traefik/EasyPanel) ANEXA o IP real à direita → pegamos
  // o N-ésimo a partir do fim, onde N = nº de proxies confiáveis (default 1).
  const hops = Math.max(1, parseInt(process.env.XFF_TRUSTED_HOPS ?? "1", 10) || 1)
  const xff = h.get("x-forwarded-for")
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean)
    if (parts.length) return parts[Math.max(0, parts.length - hops)]
  }
  return h.get("x-real-ip") || undefined
}

/** True se email/CPF-CNPJ/telefone já pertencem a alguém (anti-abuse). */
async function alreadyExists(email: string, phone: string): Promise<boolean> {
  const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("email", email).maybeSingle()
  if (prof) return true
  // ⚠️ O DOCUMENTO SAIU DAQUI (2026-08-04) porque saiu do formulário — não porque deixou
  //    de importar. Quem guarda essa porta agora é `saveMyCompanyProfile`, no wizard.
  if (phone) {
    const { data } = await supabaseAdmin.from("tenant_billing_profile").select("tenant_id").eq("phone", phone).maybeSingle()
    if (data) return true
  }
  return false
}

async function uniqueSlug(base: string): Promise<string> {
  let root = slugify(base) || "cliente"
  if (root.length < 3) root = `${root}-kora`
  if (RESERVED.has(root)) root = `${root}-app`
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? root : `${root}-${crypto.randomInt(100, 9999)}`
    const { data } = await supabaseAdmin.from("tenants").select("id").eq("slug", candidate).maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${crypto.randomBytes(3).toString("hex")}`
}

// ── 1. Inicia o cadastro: valida + anti-abuse + manda o código ─────
export interface SignupInput {
  name:         string
  email:        string
  phone:        string
  password:     string
  consent:      boolean
  captchaToken: string
}

// ⚠️ O FORMULÁRIO PÚBLICO NÃO PEDE NADA FISCAL — nem documento, nem endereço.
//    Decisão do dono (2026-08-04), em dois passos. Primeiro saiu o endereço: CEP e número
//    soltos aqui eram campos órfãos — não puxavam nada (as consultas exigem sessão) e ainda
//    assim não completavam o cadastro. Depois saiu o próprio CPF/CNPJ, pelo mesmo raciocínio
//    levado até o fim: **o lugar de perguntar é onde dá pra ajudar a responder.**
//    O documento agora é a 1ª pergunta do wizard de boas-vindas, onde digitar o CNPJ
//    preenche razão social, endereço, telefone e e-mail **na frente da pessoa**, e ela
//    confirma. Aqui ela só cria a conta: nome, e-mail, WhatsApp e senha.
//
// 🔴 TROCA CONSCIENTE NO ANTI-ABUSO. `alreadyExists` barrava cadastro repetido por TRÊS
//    chaves (e-mail · telefone · documento); sem o documento na porta, sobram duas. A
//    checagem NÃO sumiu — mora em `saveMyCompanyProfile`, fail-closed, e recusa documento
//    que já seja de outra conta. O que mudou é QUANDO: quem pula o wizard fica com um teste
//    sem nunca ter apresentado documento. Como o cadastro é pulável por decisão do dono,
//    isso já valia pra quem pulava; e-mail e telefone continuam sendo o atrito real.

export async function startSignup(input: SignupInput): Promise<Result> {
  const ip    = await clientIp()
  // Rate-limit por IP — barra email-bombing/enumeração em massa (captcha ≠ rate-limit).
  if (ip && !rateLimit(`signup:start:${ip}`, 5, 60 * 60_000).ok) {
    return { ok: false, error: "Muitas tentativas de cadastro deste local. Tente novamente mais tarde." }
  }

  const name  = input.name?.trim()
  const email = input.email?.trim().toLowerCase()
  const phone = digits(input.phone)

  if (!input.consent)                       return { ok: false, error: "É preciso aceitar a Política de Privacidade." }
  if (!name || name.length < 2)             return { ok: false, error: "Informe seu nome." }
  if (name.length > 120)                    return { ok: false, error: "Nome muito longo." }
  if (!email || !isEmail(email))            return { ok: false, error: "Email inválido." }
  if (phone.length < 10 || phone.length > 13) return { ok: false, error: "WhatsApp inválido (informe com DDD)." }
  const pwErr = validatePassword(input.password)
  if (pwErr) return { ok: false, error: pwErr }

  // Cap por IDENTIDADE (email) — sobrevive a spoof de X-Forwarded-For. Bucket
  // compartilhado com o reenvio: no máx 8 códigos por email/hora (anti
  // email-bombing de vítima + brute por reemissão).
  if (!rateLimit(`signup:id:${email}`, 8, 60 * 60_000).ok) {
    return { ok: false, error: "Muitas tentativas para este email. Tente novamente mais tarde." }
  }

  // Captcha (fail-closed em produção)
  if (!(await verifyTurnstile(input.captchaToken, ip))) {
    return { ok: false, error: "Falha na verificação anti-robô. Recarregue a página e tente de novo." }
  }

  // Throttle de reenvio
  const { data: recent } = await supabaseAdmin
    .from("signup_verifications").select("created_at")
    .eq("email", email).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_THROTTLE_MS) {
    return { ok: false, error: "Acabamos de enviar um código. Aguarde 1 minuto pra pedir outro." }
  }

  // Anti-abuse: email/telefone/CPF/CNPJ já cadastrados
  if (await alreadyExists(email, phone)) {
    return { ok: false, error: "Já existe um cadastro com esse email, telefone ou documento. Faça login ou fale com a gente." }
  }

  // 🔑 O plano vem do GOD MODE, pelo mesmo helper que a tela de cadastro usa pra
  //    anunciar o prazo — assim o que a pessoa lê e o que ela recebe são o mesmo plano.
  const plan = await getSignupTrialPlan()

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
  const passwordHash = await bcrypt.hash(input.password, 10)

  await supabaseAdmin.from("signup_verifications").delete().eq("email", email).is("consumed_at", null)
  const { error: insErr } = await supabaseAdmin.from("signup_verifications").insert({
    email, code_hash: hashCode(code), password_hash: passwordHash,
    // person_type fica com o default 'pj' da coluna e `tax_id` nulo: quem responde isso
    // agora é o wizard, e escrever palpite aqui seria dado falso no perfil fiscal.
    name, phone, plan_id: plan?.id ?? null,
    ip: ip ?? null, expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  })
  if (insErr) return { ok: false, error: "Erro ao iniciar o cadastro. Tente de novo." }

  const mail = await sendEmail({
    to: email,
    templateSlug: "signup_verification",
    ...buildVerificationEmail({ firstName: name.split(" ")[0], code, expiresMinutes: CODE_TTL_MIN }),
  })
  if (!mail.ok) {
    // Dev sem Resend configurado: loga o código pra testar o fluxo local. NUNCA em produção.
    if (!mail.configured && process.env.NODE_ENV !== "production") {
      console.log(`[signup][dev] código de verificação de ${email}: ${code}`)
      return { ok: true }
    }
    return { ok: false, error: "Não conseguimos enviar o email de verificação. Confira o endereço." }
  }

  return { ok: true }
}

export async function resendSignupCode(email: string): Promise<Result> {
  const ip = await clientIp()
  if (ip && !rateLimit(`signup:resend:${ip}`, 5, 60 * 60_000).ok) {
    return { ok: false, error: "Muitas solicitações. Aguarde alguns minutos." }
  }
  const e = email?.trim().toLowerCase()
  // Cap por identidade (mesmo bucket do startSignup): 8 códigos/email/hora.
  if (e && !rateLimit(`signup:id:${e}`, 8, 60 * 60_000).ok) {
    return { ok: false, error: "Muitas solicitações para este email. Aguarde alguns minutos." }
  }
  const { data: row } = await supabaseAdmin
    .from("signup_verifications").select("*")
    .eq("email", e).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (!row) return { ok: false, error: "Cadastro não encontrado. Comece de novo." }
  if (Date.now() - new Date(row.created_at).getTime() < RESEND_THROTTLE_MS) {
    return { ok: false, error: "Aguarde 1 minuto pra reenviar." }
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
  await supabaseAdmin.from("signup_verifications").update({
    code_hash: hashCode(code), attempts: 0, created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  }).eq("id", row.id)
  const mail = await sendEmail({
    to: e, templateSlug: "signup_verification",
    ...buildVerificationEmail({ firstName: (row.name as string).split(" ")[0], code, expiresMinutes: CODE_TTL_MIN }),
  })
  return mail.ok ? { ok: true } : { ok: false, error: "Falha ao reenviar o email." }
}

// ── 2. Confirma o código → cria a conta e provisiona o tenant ──────
export async function confirmSignup(email: string, code: string): Promise<{ ok: boolean; error?: string; activated?: boolean }> {
  const ip = await clientIp()
  // Rate-limit por IP — brute-force do código além do contador por-linha.
  if (ip && !rateLimit(`signup:confirm:${ip}`, 20, 15 * 60_000).ok) {
    return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos." }
  }
  const e = email?.trim().toLowerCase()
  const c = digits(code)

  const { data: row } = await supabaseAdmin
    .from("signup_verifications").select("*")
    .eq("email", e).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (!row)                                              return { ok: false, error: "Cadastro não encontrado. Comece de novo." }
  if (new Date(row.expires_at).getTime() < Date.now())  return { ok: false, error: "O código expirou. Reenvie um novo." }
  if (row.attempts >= MAX_ATTEMPTS)                      return { ok: false, error: "Muitas tentativas. Reenvie um novo código." }
  if (hashCode(c) !== row.code_hash) {
    await supabaseAdmin.from("signup_verifications").update({ attempts: row.attempts + 1 }).eq("id", row.id)
    return { ok: false, error: "Código incorreto." }
  }

  // M1: reivindica a linha ATOMICAMENTE (consome) antes de provisionar — evita
  // dupla-provisão se dois confirms concorrentes passarem no check do código.
  const { data: claimed } = await supabaseAdmin
    .from("signup_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle()
  if (!claimed) return { ok: false, error: "Cadastro já processado." }

  // Re-checa unicidade (corrida entre start e confirm) — a linha já está consumida.
  if (await alreadyExists(e, row.phone ?? "")) {
    return { ok: false, error: "Já existe um cadastro com esses dados." }
  }

  const { data: plan } = row.plan_id
    ? await supabaseAdmin.from("plans").select("trial_days, trial_activation_mode").eq("id", row.plan_id).maybeSingle()
    : { data: null }
  const trialDays    = (plan?.trial_days as number | undefined) ?? 0
  const hasExpiry    = trialDays > 0
  const autoActivate = ((plan?.trial_activation_mode as string | undefined) ?? "manual") === "auto"
  const nowIso       = new Date().toISOString()

  // Owner
  const { data: profile, error: pErr } = await supabaseAdmin
    .from("profiles").insert({ email: e, full_name: row.name, password_hash: row.password_hash })
    .select("id").single()
  if (pErr || !profile) return { ok: false, error: "Erro ao criar a conta." }

  // Device trust: a pessoa ACABOU de digitar o código recebido por e-mail →
  // posse provada; semeia confiança neste dispositivo pro primeiro login não
  // pedir OUTRO código (mesma prova, duas vezes). Best-effort.
  await seedTrustForCurrentDevice(profile.id)

  // Tenant (estado conforme o modo de ativação do plano)
  const slug = await uniqueSlug(row.name as string)
  const { data: tenant, error: tErr } = await supabaseAdmin.from("tenants").insert({
    name:            row.name,
    slug,
    plan:            "trial",
    plan_id:         row.plan_id,
    active:          autoActivate,
    lifecycle_state: autoActivate ? (hasExpiry ? "trialing" : "active") : "pending_approval",
    trial_ends_at:   autoActivate && hasExpiry ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null,
    activated_at:    autoActivate ? nowIso : null,
    // ⚖️ Prova do consentimento (LGPD Art. 8 §1 — o ônus é do controlador).
    //
    // 🔴 Até 2026-08-04 o aceite era VALIDADO no passo 1 e DESCARTADO: não havia coluna,
    //    tabela nem log. Não existia como provar que qualquer cliente aceitou a política.
    // 🔑 A data vem de `row.created_at` e o IP de `row.ip` porque é ali que o aceite
    //    aconteceu de fato — no formulário, não neste insert (que roda minutos depois,
    //    possivelmente de outro IP, se a pessoa confirmou o código no celular).
    // 🔑 Chegar até aqui JÁ É a prova do aceite: `startSignup` recusa sem `consent`, então
    //    não existe linha de verificação sem consentimento dado. Guardar as três colunas é
    //    tornar isso auditável sem depender de ler o código.
    privacy_accepted_at: row.created_at ?? nowIso,
    privacy_accepted_ip: row.ip ?? null,
    privacy_policy_url:  PRIVACY_POLICY_URL,
    // 💳 Quem entra pelo cadastro nasce na esteira de cobrança (docs/asaas-billing-design.md §2).
    //
    // 🔴 EXPLÍCITO, e não o DEFAULT da coluna, de propósito. O default é `'manual'` porque
    //    ele existe pra proteger os tenants que JÁ existiam quando a coluna nasceu — a
    //    automação não pode alcançar quem foi ativado à mão (cortesia, sócio, contrato
    //    especial). São duas necessidades opostas, e uma só não serve às duas: se o default
    //    fosse `gateway`, a régua desligaria os de cortesia; se o cadastro herdasse
    //    `manual`, o dono giraria a chave na mão a cada cliente novo.
    //
    // ⚠️ `gateway` + `asaas_subscription_id` NULO é um estado com significado: *"deveria
    //    pagar, ainda não configurou cartão"* — é exatamente o trial rodando. Quando o
    //    cartão entrar, a assinatura é criada com `nextDueDate = trial_ends_at`, e aí o fim
    //    do teste e a primeira cobrança viram o mesmo dia (o cron de trial já respeita isso).
    billing_mode:    "gateway",
  }).select("id, slug").single()
  if (tErr || !tenant) return { ok: false, error: "Erro ao criar o ambiente." }

  await supabaseAdmin.from("tenant_users").insert({ tenant_id: tenant.id, user_id: profile.id, role: "owner", active: true })
  // ── Perfil fiscal: nasce com o que a porta sabe ──────────────────────────
  //
  // ⚠️ SÓ nome, e-mail e telefone. Documento e endereço são a 1ª pergunta do wizard de
  //    boas-vindas — lá a consulta de CNPJ funciona (tem sessão) e preenche razão social
  //    e endereço NA FRENTE da pessoa, que confirma. Aqui não há o que consultar.
  //
  // 🔴 O perfil nasce INCOMPLETO de propósito, e isso é diferente do bug que existia até
  //    2026-08-04: antes ele nascia incompleto **sem que houvesse onde completar**, e
  //    `getTitularParaCobranca` barrava 100% dos cadastros novos na hora de assinar, com
  //    um aviso mandando falar com o suporte. Hoje há três lugares (wizard, Configurações
  //    → Dados da empresa, e o link da própria tela de pagamento) e o checklist de setup
  //    cobra o que falta.
  await supabaseAdmin.from("tenant_billing_profile").insert({
    tenant_id: tenant.id, legal_name: row.name,
    billing_email: e, phone: row.phone, responsible_name: row.name,
  })

  // Funil padrão + config (igual ao createTenant do god mode)
  const { data: pipeline } = await supabaseAdmin.from("pipelines").insert({
    tenant_id: tenant.id, name: "Funil padrão", color: "#3B82F6", is_default: true, position: 0, active: true, created_by: profile.id,
  }).select("id").single()
  if (pipeline) {
    await supabaseAdmin.from("pipeline_stages").insert(DEFAULT_STAGES.map((s, i) => ({
      pipeline_id: pipeline.id, tenant_id: tenant.id, name: s.name, color: s.color,
      position: "triage" in s && s.triage ? -1 : i, probability_pct: s.prob,
      is_won: "won" in s && !!s.won, is_lost: "lost" in s && !!s.lost,
      is_triage: "triage" in s && !!s.triage, show_in_kanban: !("triage" in s && s.triage),
    })))
    await supabaseAdmin.from("tenant_config").upsert({ tenant_id: tenant.id, default_pipeline_id: pipeline.id }, { onConflict: "tenant_id" })
  } else {
    await supabaseAdmin.from("tenant_config").insert({ tenant_id: tenant.id })
  }

  // Encaixa o plano: habilita os módulos do plano (mantém manuais). Limites resolvem do plano.
  if (row.plan_id) await applyPlan(tenant.id, row.plan_id as string)
  else await applyDefaultModules(tenant.id)

  // ── Sem auto-provisionar WhatsApp (decisão do dono, 2026-08-06) ──────────
  //
  // 🔴 O SIGNUP CRIAVA UMA INSTÂNCIA NA EVOLUTION PRA TODA CONTA NOVA, e isso estragava
  //    quatro coisas ao mesmo tempo:
  //      1. **Matava o gate de plano.** Todo tenant nascia com uma linha em
  //         `whatsapp_instances`, então qualquer checagem do tipo "ele já tem número?"
  //         era verdadeira desde o primeiro segundo — foi exatamente assim que o gate de
  //         `multi_instance` da tela de Integrações nasceu inerte (medido em 06/08).
  //      2. **Gastava recurso por cadastro abandonado.** Cada instância é uma sessão
  //         Baileys viva no servidor da Evolution; signup de teste, spam ou desistência
  //         deixava uma lá pra sempre.
  //      3. **Mentia na tela.** "1 número" para quem nunca conectou nada.
  //      4. **Virava órfã ao apagar o tenant.** O delete do tenant não fala com a
  //         Evolution — na limpeza de 06/08 foi preciso apagar à mão.
  //
  // 🔑 Criar número é ATO DO CLIENTE, não efeito colateral do cadastro: acontece no botão
  //    de Integrações → `addQrNumber`, que checa papel E cota (`requireLimit`) antes de
  //    provisionar. A tela vazia já convida com "Conecte seu primeiro número".
  // ⚠️ `autoProvisionWhatsApp` continua existindo e sendo usada — pelo god mode e por
  //    `addQrNumber`. O que saiu foi a chamada automática, não a capacidade.

  return { ok: true, activated: autoActivate }
}
