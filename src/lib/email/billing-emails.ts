import "server-only"
import { getAppBaseUrl, escapeHtml } from "./send"

// ═══════════════════════════════════════════════════════════════
// Cobrança — os quatro avisos que a escada precisa
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE ELES EXISTEM SÓ AGORA. Os quatro slugs estavam declarados desde 07/08 e
//    **nenhum tinha template, entrada no catálogo ou chamador** — o `email_outbox` não
//    registra um único e-mail de cobrança em toda a história do produto (medido em prod,
//    08/08). Efeito: o cliente ia de saudável a cortado **sem receber uma mensagem**.
//
// 🔑 E eles vêm ANTES de ligar a escada nova, de propósito. A escada corta campanhas, IA e
//    automações já na carência; cortar quem não foi avisado transforma um problema de
//    cobrança em reclamação — e cliente irritado paga mais devagar, não mais rápido.
//
// ⚠️ Arquivo próprio em vez de mais 200 linhas no `send.ts`, que já passa de mil. A casca
//    é compartilhada aqui dentro: quatro cópias do mesmo HTML seriam quatro chances de uma
//    envelhecer sem ninguém notar.

/** Casca única dos quatro. */
function casca(opts: {
  headline: string
  accent:   string
  corpo:    string
  cta?:     { label: string; href: string }
  rodape?:  string
}): string {
  const logoUrl = getAppBaseUrl() + "/logo_kora.png"
  const cta = opts.cta
    ? '<tr><td style="padding:8px 32px 32px 32px;">'
      + '<a href="' + opts.cta.href + '" style="display:inline-block;background:#004add;color:#ffffff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:10px;text-decoration:none;">'
      + escapeHtml(opts.cta.label) + "</a></td></tr>"
    : '<tr><td style="padding:0 32px 32px 32px;"></td></tr>'
  const rodape = opts.rodape
    ? '<tr><td style="padding:0 32px 28px 32px;border-top:1px solid #f1f5f9;">'
      + '<p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">' + opts.rodape + "</p></td></tr>"
    : ""

  return '<!doctype html><html lang="pt-BR">'
    + '<body style="margin:0;padding:0;background:#f8fafc;font-family:\'Inter\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#0f172a;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;"><tr><td align="center">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">'
    + '<tr><td style="padding:32px 32px 24px 32px;">'
    + '<img src="' + logoUrl + '" alt="Kora" height="28" style="display:block;height:28px;width:auto;border:0;" /></td></tr>'
    + '<tr><td style="padding:0 32px 8px 32px;">'
    + '<h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;line-height:1.3;color:' + opts.accent + ';">'
    + escapeHtml(opts.headline) + "</h1>" + opts.corpo + "</td></tr>"
    + cta + rodape
    + "</table></td></tr></table></body></html>"
}

const p = (txt: string) =>
  '<p style="margin:0 0 14px 0;font-size:14px;color:#475569;line-height:1.6;">' + txt + "</p>"

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export interface CobrancaEmailContext {
  /**
   * `null` quando o valor não pôde ser apurado — e os quatro textos **degradam** em vez de
   * mentir.
   *
   * 🔴 A alternativa era pior nas duas pontas: exigir o valor faria o aviso de atraso ser
   *    CANCELADO por um campo faltando (o cliente seria cortado sem nunca ter sido avisado,
   *    que é exatamente o dano que estes e-mails vieram consertar); e mandar `0` imprimiria
   *    "R$ 0,00" num e-mail sobre dinheiro. Some a frase do valor, o aviso sai.
   */
  valorCents: number | null
  /** Já formatada pra leitura humana ("11 de agosto"). */
  quando?:    string | null
  /** Só no aviso de atraso: quantos dias ele ainda tem antes do produto fechar. */
  diasCarencia?: number
}

/** `null` vira string vazia — quem monta a frase decide o que fica no lugar. */
const comValor = (c: number | null, molde: (v: string) => string) =>
  typeof c === "number" && c > 0 ? molde(brl(c)) : ""

/**
 * 1 · Pagamento confirmado. **Escopo dinheiro** — só o owner recebe.
 *
 * ⚠️ Decisão do dono (06/08): *"Dinheiro recebido não, isso é do dono do Kora. Pagamento
 *    confirmado sim, é notificação para o cliente."* Por isso existe este e não existe um
 *    "o dinheiro caiu na conta".
 */
export function buildBillingConfirmedEmail(ctx: CobrancaEmailContext) {
  const link   = getAppBaseUrl() + "/configuracoes/assinatura/faturas"
  const quando = ctx.quando ? " em " + ctx.quando : ""
  const valor  = comValor(ctx.valorCents, (v) => v)
  return {
    subject: "Pagamento confirmado" + (valor ? " — " + valor : ""),
    text: "Recebemos seu pagamento" + (valor ? " de " + valor : "") + quando
        + ".\n\nTudo segue funcionando normalmente.\n\nVer faturas: " + link + "\n\n—\nKora",
    html: casca({
      headline: "Pagamento confirmado",
      accent:   "#047857",
      corpo:    p("Recebemos " + (valor ? "<strong>" + valor + "</strong>" : "seu pagamento")
                + escapeHtml(quando) + ". Tudo segue funcionando normalmente."),
      cta:      { label: "Ver minhas faturas", href: link },
    }),
  }
}

/**
 * 2 · Cartão recusado — **o aviso que vem ANTES de qualquer corte** (degrau 1).
 *
 * 🔑 Sem ele, o primeiro sinal que o cliente recebe é a IA parando de responder. Este é o
 *    único momento em que ele consegue resolver sem ter perdido nada.
 * ⚠️ Aponta pra `?cartao=1`: se houver cobrança em aberto, o modal abre em "regularizar" e
 *    cobra na hora; se não houver, abre como troca de cartão comum.
 */
export function buildBillingCardFailedEmail(ctx: CobrancaEmailContext) {
  const link  = getAppBaseUrl() + "/configuracoes/assinatura?cartao=1"
  const valor = comValor(ctx.valorCents, (v) => v)
  return {
    subject: "Não conseguimos cobrar seu cartão",
    text: "Não conseguimos concluir a cobrança" + (valor ? " de " + valor : " da sua assinatura")
        + " no seu cartão."
        + "\n\nO motivo mais comum é cartão vencido ou limite. Atualizar leva um minuto —"
        + " e nada foi pausado até aqui.\n\nAtualizar cartão: " + link + "\n\n—\nKora",
    html: casca({
      headline: "Não conseguimos cobrar seu cartão",
      accent:   "#b45309",
      corpo:    p("A cobrança " + (valor ? "de <strong>" + valor + "</strong> " : "da sua assinatura ")
                + "não passou. O motivo mais comum é cartão vencido ou limite — atualizar leva um minuto.")
              + p("<strong>Nada foi pausado até aqui.</strong> Seu atendimento, seus contatos e seu "
                + "histórico seguem no ar."),
      cta:      { label: "Atualizar cartão", href: link },
      rodape:   "Se você já resolveu com o seu banco, pode ignorar este aviso — tentamos de novo automaticamente.",
    }),
  }
}

/**
 * 3 · Fatura vencida — o que PAROU e o que continua.
 *
 * 🔑 A metade que CONTINUA vem primeiro, e isso é regra da política (§2 do
 *    access-revocation-design): o pânico de quem está atrasado é *"perdi meu histórico"*.
 *    Responder isso antes é o que mantém a conversa sobre pagamento, e não sobre cancelar.
 * ⚠️ `diasCarencia` diz quanto tempo ele ainda tem ANTES de o produto fechar. Sem esse
 *    número o aviso vira ameaça vaga — o tipo que se aprende a ignorar.
 */
export function buildBillingOverdueEmail(ctx: CobrancaEmailContext) {
  const link  = getAppBaseUrl() + "/configuracoes/assinatura?cartao=1"
  const valor = comValor(ctx.valorCents, (v) => v)
  const prazo = typeof ctx.diasCarencia === "number" && ctx.diasCarencia > 0
    ? "Você tem " + ctx.diasCarencia + (ctx.diasCarencia === 1 ? " dia" : " dias")
      + " para regularizar antes que o acesso seja interrompido."
    : "Regularize para voltar ao normal."
  return {
    subject: "Fatura em aberto" + (valor ? " — " + valor : ""),
    text: "A fatura" + (valor ? " de " + valor : " da sua assinatura")
        + (ctx.quando ? " (venceu em " + ctx.quando + ")" : "")
        + " está em aberto.\n\nCONTINUA FUNCIONANDO: atendimento no WhatsApp, contatos, histórico e exportação."
        + "\nPAUSADO: campanhas, inteligência artificial e automações.\n\n" + prazo
        + "\n\nRegularizar: " + link + "\n\n—\nKora",
    html: casca({
      headline: "Sua fatura está em aberto",
      accent:   "#b45309",
      corpo:    p("A fatura " + (valor ? "de <strong>" + valor + "</strong>" : "da sua assinatura")
                + (ctx.quando ? " venceu em " + escapeHtml(ctx.quando) : "") + " e segue em aberto.")
              + p('<strong style="color:#047857;">Continua funcionando:</strong> seu atendimento no '
                + "WhatsApp, seus contatos, seu histórico e a exportação dos seus dados.")
              + p('<strong style="color:#b45309;">Pausado até o pagamento:</strong> campanhas, '
                + "inteligência artificial e automações. Volta sozinho assim que a cobrança cair — "
                + "nada precisa ser reconfigurado.")
              + p(escapeHtml(prazo)),
      cta:      { label: "Regularizar agora", href: link },
    }),
  }
}

/**
 * 4 · Voltou ao normal — fecha o ciclo.
 *
 * ⚠️ Sem ele o cliente paga e não sabe que já pode voltar a usar; fica esperando, ou liga
 *    pro suporte perguntando. É o e-mail mais barato de escrever e o mais fácil de esquecer.
 */
export function buildBillingRestoredEmail() {
  const link = getAppBaseUrl() + "/campanhas"
  return {
    subject: "Tudo voltou ao normal",
    text: "Tudo certo — campanhas, inteligência artificial e automações voltaram a funcionar."
        + "\n\nAs campanhas agendadas seguem na fila; nada precisou ser reconfigurado.\n\n—\nKora",
    html: casca({
      headline: "Tudo voltou ao normal",
      accent:   "#047857",
      corpo:    p("Campanhas, inteligência artificial e automações <strong>voltaram a funcionar</strong>.")
              + p("As campanhas agendadas seguem na fila — nada precisou ser reconfigurado."),
      cta:      { label: "Voltar ao Kora", href: link },
    }),
  }
}
