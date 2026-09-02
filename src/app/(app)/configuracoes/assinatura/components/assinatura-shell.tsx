import { SectionTabs } from "@/components/ui/section-tabs"

// ═══════════════════════════════════════════════════════════════
// Casca da seção Assinatura (design-system §2.2 — abas underline)
// ═══════════════════════════════════════════════════════════════
// DECISÃO: três telas irmãs, uma pergunta cada — "estou em dia?" (Minha
// assinatura), "isso vai virar dinheiro?" (Consumo), "cadê o comprovante?"
// (Faturas). Aba, não acordeão nem página única: cada pergunta chega por um
// caminho diferente (e-mail de cobrança, susto no fim do mês, contador pedindo
// nota) e cada uma precisa de URL própria.
//
// `preserveQuery` carrega o `?degrau=` entre as abas — ver mock.ts.

export function AssinaturaShell({
  children, actions,
}: {
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Assinatura</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Seu plano, o que você consome e suas faturas.
            </p>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>

        <SectionTabs
          preserveQuery
          tabs={[
            { href: "/configuracoes/assinatura",         label: "Minha assinatura" },
            { href: "/configuracoes/assinatura/consumo", label: "Consumo" },
            { href: "/configuracoes/assinatura/faturas", label: "Faturas" },
          ]}
        />

        {children}
      </div>
    </div>
  )
}
