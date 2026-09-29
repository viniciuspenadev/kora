"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Loader2, ChevronDown, Brain, Sparkles, BookOpen, Activity } from "lucide-react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { createFlow } from "@/lib/actions/studio/flows"
import { PURPOSE_META, PURPOSE_ORDER } from "./purpose"

/**
 * Ações do cabeçalho da página de fluxos.
 *
 * Existe separado do `FlowsClient` por causa do PADRÃO DE HEADER do app: `PageShell`
 * recebe as ações via prop e as renderiza ao lado do título (design-system §2). Como o
 * PageShell é montado no Server Component da página, o que vai nele precisa ser um client
 * component autônomo — daí este arquivo em vez de uma linha de botões solta no corpo.
 *
 * O menu "IA" carrega o que era o hub /studio (Persona · Conhecimento · Atividade), morto
 * em 2026-07-30: a lista de fluxos virou a home do Studio e o resto ficou a um clique.
 */
export function FlowsActions({ hasAi }: { hasAi?: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleNew(purpose: (typeof PURPOSE_ORDER)[number]) {
    startTransition(async () => {
      // Nome vazio de propósito: quem decide o rótulo padrão é o servidor
      // (`DEFAULT_NAME` em actions/studio/flows.ts), pra categoria nova não depender de
      // alguém lembrar de atualizar um ternário aqui na tela.
      const r = await createFlow("", purpose)
      if (r.id) router.push(`/studio/fluxos/${r.id}`)
      else if (r.error) toast.error(r.error)   // ex.: limite de automações atingido
    })
  }

  return (
    <>
      {/* Só com o add-on de IA: sem ele Persona/Conhecimento não existem pro tenant, e
          menu que abre página negada é pior que menu que não abre (fail-closed na UI
          espelhando o gate do servidor). Atividade acompanha porque é o relatório DELA. */}
      {hasAi && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
            aria-label="Configurações da IA">
            <Brain className="size-3.5 text-violet-600" /> IA <ChevronDown className="size-3.5 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* `router.push` e não `<Link asChild>`: o DropdownMenuItem local é
                implementação própria (base-ui), não Radix — não suporta `asChild`. */}
            <DropdownMenuItem onClick={() => router.push("/studio/persona")}>
              <Sparkles className="size-3.5 text-violet-600" /> Persona
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/studio/conhecimento")}>
              <BookOpen className="size-3.5 text-sky-600" /> Base de conhecimento
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/studio/atividade")}>
              <Activity className="size-3.5 text-emerald-600" /> Atividade da IA
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Novo fluxo <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* A descrição é o que faz a categoria funcionar: o rótulo sozinho não diz se
              "Agendamento" é atendimento ou automação, e é neste clique que se decide. */}
          {PURPOSE_ORDER.map((p) => {
            const m = PURPOSE_META[p]
            const MIcon = m.icon
            return (
              <DropdownMenuItem key={p} onClick={() => handleNew(p)}>
                <MIcon className={`size-3.5 shrink-0 ${m.tint.split(" ")[0]}`} />
                <span className="min-w-0">
                  <span className="block leading-tight">{m.label}</span>
                  <span className="block text-[10px] font-normal text-slate-400 leading-tight">{m.hint}</span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
