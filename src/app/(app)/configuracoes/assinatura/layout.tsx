import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { temAssinaturaNoProduto } from "@/lib/billing/self-service"
import { linkSuporte } from "@/lib/support"

/**
 * Portão da área de Assinatura.
 *
 * 🔑 Cliente de cobrança MANUAL não tem assinatura dentro do produto (decisão do dono,
 *    05/08/2026) — ele é faturado por fora, e oferecer aqui uma compra que o servidor vai
 *    recusar é fazer a plataforma discutir com ela mesma na frente do cliente.
 *
 * 🔴 ESTA TELA NÃO REDIRECIONA — E O MOTIVO CUSTOU CARO (06/08). A 1ª versão mandava pra
 *    `/configuracoes/perfil`, que está DENTRO do grupo `(app)` e **fora** da allow-list do
 *    paywall de `trial_ended`. Resultado: layout → `/assinatura` → este portão →
 *    `/perfil` → layout → `/assinatura` ⇒ **terceiro laço infinito do dia**.
 *    E ele se auto-alimentava: `temAssinaturaNoProduto` é fail-closed, então bastava um
 *    blip de banco pra um tenant `gateway` cair aqui — e o blip é exatamente o sintoma que
 *    o primeiro laço produziu (esgotamento de conexões).
 * 🔑 Tela estática não navega, logo não pode laçar. Regra que fica pra este projeto:
 *    **gate aninhado dentro de outro gate não redireciona — ele renderiza.**
 *
 * ⚠️ O recorte de PAPEL (owner/admin) continua em cada página, de propósito: são perguntas
 *    diferentes ("esta conta compra aqui?" × "esta pessoa decide compra?").
 */
export default async function AssinaturaAreaLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  if (!(await temAssinaturaNoProduto(session.user.tenantId))) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="rounded-xl border border-slate-200 bg-white shadow-card p-6">
          <h1 className="text-base font-bold text-slate-900">Cobrança combinada com a nossa equipe</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            A assinatura da sua conta não é gerenciada por aqui — o combinado de pagamento é
            direto com o seu contato na Kora. Qualquer dúvida sobre valores ou nota fiscal,
            fale com a gente.
          </p>
          <a href={linkSuporte("Olá! Tenho uma dúvida sobre a cobrança da minha conta Kora.")}
            target="_blank" rel="noopener noreferrer"
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white">
            Falar no WhatsApp
          </a>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
