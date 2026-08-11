import Link from "next/link"
import { Lock, ArrowRight } from "lucide-react"

/**
 * Tela de "este recurso não está no seu plano".
 *
 * 🔴 POR QUE EXISTE (achado do dono, 06/08/2026). Três páginas de canal — Widget do site,
 *    Instagram e WhatsApp QR — tinham gate de PAPEL (owner/admin) e **nenhum gate de
 *    MÓDULO**. O card na tela de Integrações dizia "Em breve", mas o botão continuava
 *    navegando, e a página abria e deixava **configurar** um canal que o plano não inclui.
 *    O dono chegou lá por outro caminho ainda: Relatórios → seção do site → "Configurar
 *    widget" → configuração aberta. Porta trancada no menu, destrancada na maçaneta.
 *
 * 🔑 RENDERIZA, NÃO REDIRECIONA. Gate que redireciona já produziu três laços infinitos
 *    neste projeto em um único dia — inclusive um que derrubou a conta do dono. Tela
 *    estática não navega, logo não pode laçar. E ela é mais útil que um redirect: diz o
 *    que falta e leva pro lugar onde a pessoa resolve.
 *
 * ⚠️ É a segunda parede, não a primeira: o menu e os cards já escondem o que não está no
 *    plano. Esta existe porque link direto, favorito antigo e botão esquecido em outra
 *    tela não passam pelo menu.
 */
export function ModuloNaoIncluido({
  titulo,
  descricao,
}: {
  /** Nome do recurso, como o cliente o conhece. */
  titulo: string
  /** O que ele faz — é argumento de venda, então vale a frase completa. */
  descricao: string
}) {
  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto">
      <div className="rounded-xl border border-slate-200 bg-white shadow-card p-6">
        <div className="size-10 rounded-lg bg-amber-50 ring-1 ring-amber-200 grid place-items-center">
          <Lock className="size-5 text-amber-600" />
        </div>
        <h1 className="mt-4 text-base font-bold text-slate-900">{titulo} não está no seu plano</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{descricao}</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href="/configuracoes/assinatura"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors">
            Ver planos <ArrowRight className="size-4" />
          </Link>
          <Link href="/integracoes"
            className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            Voltar para integrações
          </Link>
        </div>
      </div>
    </div>
  )
}
