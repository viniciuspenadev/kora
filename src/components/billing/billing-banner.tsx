"use client"

import { useMemo } from "react"
import { Receipt, X } from "lucide-react"
import { useBrowserPref } from "@/lib/browser-pref"
import { cn } from "@/lib/utils"
import { PayNowButton } from "./pay-now"
import { assuntoDaFatura, linhaDoDocumento, tempoEmAberto } from "./format"
import type { BillingStanding } from "./standing-contract"

// ═══════════════════════════════════════════════════════════════
// C1 · BillingBanner — a faixa no topo do app
// ═══════════════════════════════════════════════════════════════
// 🔑 A REGRA CENTRAL: o aviso sobe de SUPERFÍCIE, nunca de VOLUME.
//    Entre a carência e o bloqueio o que muda é **quanto espaço o aviso ocupa e quanto
//    ele insiste** — não o quanto ele grita. O texto do primeiro degrau e o do último
//    têm o mesmo tom: descrevem um documento em aberto e dizem o que continua
//    funcionando. Escalar por cor (âmbar → vermelho → vermelho piscando) é o caminho
//    fácil e o errado: vermelho é a cor de "algo quebrou no sistema", e cobrança não é
//    defeito. Cliente que aprende a associar cobrança a alarme aprende junto que a cor
//    vermelha do produto às vezes não significa nada.
//
//    A escada aqui é: dispensável e fino (carência) → permanente e explicado
//    (restrição) → permanente, escuro e definitivo (bloqueio). Área e persistência,
//    não decibéis.
//
// 🔑 O ÍCONE É UM RECIBO, não um ⚠️ e não um 🔒. É a tradução visual de "fale do
//    documento, nunca da pessoa": triângulo de alerta acusa quem está olhando; o
//    documento é só um documento. Vale pras cinco superfícies da escada.
//
// 🔑 UM BOTÃO SÓ. Nenhuma variação tem "Ver detalhes", "Falar com o suporte" ou
//    "Entender o que aconteceu". Segunda ação num aviso de cobrança é rota de fuga: ela
//    dá à pessoa algo pra clicar que não resolve o problema, e ela clica. O "×" da
//    carência não é ação — é o direito de adiar, e por isso é ícone e não botão.
//
// ⚠️ `ok` e `terminated` não renderizam nada. Em `ok` não há fato a comunicar; em
//    `terminated` o acesso já caiu e a pessoa não está numa tela com faixa — ali a
//    conversa é uma PÁGINA inteira (escopo do outro designer), não uma tarja.

type DegrauVisivel = "trial" | "trial_ended" | "grace" | "restricted" | "readonly"

const SUPERFICIE: Record<
  DegrauVisivel,
  {
    faixa: string
    chip: string
    titulo: string
    apoio: string
    rotulo: string
    item: string
    tone: "quiet" | "primary" | "inverse"
  }
> = {
  // Teste ENCERRADO — vermelho: o produto parou. É fato consumado, não aviso.
  trial_ended: {
    faixa: "bg-red-50 border-red-200",
    chip: "border-red-200 bg-red-100 text-red-800",
    titulo: "text-red-900",
    apoio: "text-red-800",
    rotulo: "text-red-900",
    item: "text-red-800",
    tone: "primary",
  },
  // Teste — âmbar como a restrição, porque a consequência é real (o acesso cai), mas
  // com o texto no futuro e não no passado: ninguém fez nada errado.
  trial: {
    faixa: "bg-amber-50 border-amber-200",
    chip: "border-amber-200 bg-amber-100 text-amber-800",
    titulo: "text-amber-900",
    apoio: "text-amber-800",
    rotulo: "text-amber-900",
    item: "text-amber-800",
    tone: "primary",
  },
  // Carência — chrome, não aviso. Some no fundo branco da barra de navegação.
  grace: {
    faixa: "bg-white border-slate-200",
    chip: "border-slate-200 bg-slate-50 text-slate-500",
    titulo: "text-slate-900",
    apoio: "text-slate-500",
    rotulo: "text-slate-600",
    item: "text-slate-500",
    tone: "quiet",
  },
  // Restrição — presente e explicada. Âmbar é "atenção", não "erro".
  restricted: {
    faixa: "bg-amber-50 border-amber-200",
    chip: "border-amber-200 bg-white text-amber-700",
    titulo: "text-slate-900",
    apoio: "text-amber-900/70",
    rotulo: "text-slate-700",
    item: "text-slate-600",
    tone: "primary",
  },
  // Bloqueio — firme. A firmeza vem do CONTRASTE (barra escura, editorial), não de
  // vermelho: o estado é definitivo, não é uma emergência.
  readonly: {
    faixa: "bg-slate-900 border-slate-900",
    chip: "border-white/15 bg-white/10 text-white",
    titulo: "text-white",
    apoio: "text-slate-400",
    rotulo: "text-slate-200",
    item: "text-slate-400",
    tone: "inverse",
  },
}

/** Preferência guardada: o DIA em que a faixa de carência foi dispensada. */
const DISMISS_KEY = "kora_billing_grace_dismissed_on"
/** Valor do servidor: lá não existe `localStorage` e a resposta honesta é "não sei". */
const NAO_SEI = "?"

function parseDia(cru: string): string {
  try {
    const v: unknown = JSON.parse(cru)
    return typeof v === "string" ? v : ""
  } catch {
    return ""
  }
}

function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function BillingBanner({
  standing,
  selfServiceBilling = true,
  payHref,
  onPay,
  className,
}: {
  standing: BillingStanding
  /**
   * A cobrança deste cliente acontece DENTRO do produto?
   *
   * 🔴 `false` = faturado por fora. Sem esta prop, o banner oferecia "Ativar assinatura"
   *    pra tenant `manual` e o clique batia no portão da área de Assinatura — a mesma
   *    "porta que bate na cara" que o menu já tinha aprendido a esconder (achado do QA,
   *    06/08). Em produção, **4 dos 5 tenants são `manual`**.
   */
  selfServiceBilling?: boolean
  payHref?: string
  /** Presente ⇒ o CTA abre o pagamento na própria tela em vez de navegar. */
  onPay?: () => void
  className?: string
}) {
  // "Dispensei isso hoje?" — a resposta mora no navegador. Guardar o DIA (e não um
  // carimbo de tempo) é o que faz o aviso voltar amanhã de manhã sem nenhuma aritmética
  // de janela: adiar é um direito diário, não um "não me mostre mais".
  const [dispensadoEm, setDispensadoEm] = useBrowserPref(DISMISS_KEY, parseDia, NAO_SEI)
  // "Hoje" congelado na montagem — a faixa não precisa de relógio vivo, e ler a data no
  // corpo do componente faria dois renders iguais darem resultados diferentes.
  const hoje = useMemo(() => hojeLocal(), [])

  const { degrau, invoice, paused, continues, nextClosingAt } = standing
  if (degrau === "ok" || degrau === "terminated") return null

  const s = SUPERFICIE[degrau]
  // ⚠️ `trial` entrou aqui (pedido do dono, 06/08). O aviso do teste ficava fixo no topo
  //    de TODA tela, sem saída — e quem já sabe que o teste termina em 5 dias não precisa
  //    ler isso a cada clique. Aviso que não se pode dispensar vira ruído, e ruído é o que
  //    faz o cliente parar de ler os avisos que importam.
  // ⚠️ `trial_ended` continua NÃO dispensável de propósito: ali o produto está travado e o
  //    aviso é a própria instrução do que fazer.
  const dispensavel = degrau === "grace" || degrau === "trial"

  if (dispensavel) {
    // Enquanto o navegador não responde, nada é pintado — evita a faixa piscar e sumir.
    // (Não há estado de "dispensei agora": gravar a preferência já re-renderiza esta
    //  faixa com o valor novo, então um segundo estado só teria como repetir o primeiro.)
    if (dispensadoEm === NAO_SEI) return null
    if (dispensadoEm === hoje) return null
  }

  const assunto = assuntoDaFatura(invoice)
  const emAberto = tempoEmAberto(invoice)

  // O tom é o mesmo nos três: fato sobre o documento + o que continua verdadeiro.
  // ⚠️ O teste reusa o MESMO render: não existe fatura aqui, então o que muda é só o
  //    texto. Criar um segundo componente de faixa pro trial seria duas barras pra manter
  //    e duas chances de divergirem em espaçamento, cor e comportamento.
  const diasTrial   = standing.trial?.diasRestantes ?? 0
  const podeAssinar = standing.trial?.podeAssinar === true

  const titulo =
    degrau === "trial_ended"
      ? "Seu teste terminou."
      : degrau === "trial"
      ? (diasTrial <= 1 ? "Seu teste termina hoje." : `Seu teste termina em ${diasTrial} dias.`)
      : degrau === "grace"
      ? `${assunto} está em aberto.`
      : degrau === "restricted"
        ? `${assunto} está em aberto${emAberto ? ` ${emAberto}` : ""}.`
        : `${assunto} segue em aberto.`

  const apoio =
    degrau === "trial_ended"
      ? (podeAssinar ? "ative sua assinatura para voltar a usar" : "complete o cadastro da empresa para poder ativar")
      : degrau === "trial"
      ? (podeAssinar
          ? "depois disso o acesso é interrompido até você ativar a assinatura"
          : "complete o cadastro da empresa — sem ele não conseguimos emitir a cobrança")
      : degrau === "grace"
      ? [linhaDoDocumento(invoice), "tudo segue funcionando normalmente"].filter(Boolean).join(" · ")
      : degrau === "restricted"
        ? linhaDoDocumento(invoice, nextClosingAt)
        : [linhaDoDocumento(invoice, nextClosingAt), "a conta está em leitura, e a exportação segue liberada"]
            .filter(Boolean)
            .join(" · ")

  // A carência fica SLIM por decisão: mesmo que o contrato mande listas, elas não são
  // renderizadas ali. No degrau 2 nada parou — listar "o que continua" quando nada
  // parou inventa uma consequência que ainda não existe.
  // Teste também não lista: nada foi pausado, e "Continua: tudo" é ruído.
  const mostraListas = degrau !== "grace" && degrau !== "trial" && (paused.length > 0 || continues.length > 0)

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 border-b px-4 py-2.5 sm:px-6",
        s.faixa,
        className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border",
          s.chip,
        )}
      >
        <Receipt className="size-3.5" strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] font-semibold leading-snug", s.titulo)}>{titulo}</p>
        {apoio && (
          <p className={cn("mt-0.5 text-[11px] leading-relaxed tabular-nums", s.apoio)}>{apoio}</p>
        )}

        {mostraListas && (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[11px] leading-relaxed">
            {paused.length > 0 && (
              <span className={s.rotulo}>
                <span className="font-semibold">Pausado:</span>{" "}
                <span className={s.item}>{paused.join(" · ")}</span>
              </span>
            )}
            {/* "Continua" nunca é omitido quando existe: é ele que segura o tom. Um aviso
                que só enumera perdas lê como punição; enumerar o que segue de pé lê como
                estado. Mesma informação, outra relação com quem lê. */}
            {continues.length > 0 && (
              <span className={s.rotulo}>
                <span className="font-semibold">Continua:</span>{" "}
                <span className={s.item}>{continues.join(" · ")}</span>
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* ⚠️ Cliente faturado por fora não recebe CTA de compra nenhum — o aviso (o que
            está acontecendo com a conta) continua valendo; o botão é que não tem destino. */}
        {!selfServiceBilling ? null : degrau === "trial" || degrau === "trial_ended" ? (
          // ⚠️ Sem cadastro completo o botão NÃO leva ao cartão: a tokenização falharia e
          //    a pessoa teria digitado o cartão inteiro pra receber um erro previsível.
          <PayNowButton
            // 🔴 IA PRO CHECKOUT SEM PLANO (achado do dono, 06/08): o botão apontava pra
            //    `/pagamento`, e desde 05/08 essa página exige `?plano=<id>` — sem ele ela
            //    responde "escolha um plano primeiro". Ou seja: o botão do topo parecia
            //    quebrado enquanto o botão IGUAL, dentro da tela, funcionava. Dois CTAs com
            //    o mesmo rótulo e destinos diferentes é sempre um deles envelhecendo.
            // 🔑 Mesmo destino do hero: a vitrine, que abre a trilha de compra completa.
            href={podeAssinar ? "/configuracoes/assinatura/planos" : "/configuracoes/empresa"}
            label={podeAssinar ? "Ativar assinatura" : "Completar cadastro"}
            tone={s.tone}
            size="sm"
          />
        ) : (
          <PayNowButton href={payHref} onClick={onPay} tone={s.tone} size="sm" />
        )}
        {dispensavel && (
          <button
            type="button"
            onClick={() => setDispensadoEm(hoje)}
            aria-label="Dispensar por hoje"
            title="Dispensar por hoje"
            className="grid size-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
