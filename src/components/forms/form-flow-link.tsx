"use client"

// "Automação no Studio" de um formulário — a MESMA peça na lista e na aba Publicar: o fluxo
// que chama quem envia (link para o Studio) ou "Sem fluxo · Criar fluxo" (rascunho pronto).

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Workflow, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createFormFlow } from "@/lib/actions/studio/flows"
import type { FormFlowLink as FlowLink } from "@/lib/actions/forms"

export function FormFlowLink({ formId, flow, canCreate }: { formId: string; flow: FlowLink | null; canCreate: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()

  if (flow) {
    return (
      <Link href={`/studio/fluxos/${flow.id}`} onClick={(e) => e.stopPropagation()} title="Abrir no Kora Studio"
        className="inline-flex items-center gap-1.5 max-w-[15rem] text-xs text-slate-700 hover:text-primary-700">
        <Workflow className="size-3.5 text-primary shrink-0" />
        <span className="truncate">{flow.name}</span>
        {!flow.live && <span className="shrink-0 font-semibold text-amber-700">· fora do ar</span>}
      </Link>
    )
  }

  function create(e: React.MouseEvent) {
    e.stopPropagation()
    start(async () => {
      const r = await createFormFlow(formId)
      if (r.error || !r.id) { toast.error(r.error ?? "Não foi possível criar o fluxo."); return }
      toast.success("Fluxo criado como rascunho. Confira a mensagem e publique.")
      router.push(`/studio/fluxos/${r.id}`)
    })
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
      <span className="font-semibold text-amber-700">Sem fluxo</span>
      {canCreate && (
        <>
          <span className="text-slate-400">·</span>
          <button type="button" onClick={create} disabled={busy} className="inline-flex items-center gap-1 font-semibold text-primary hover:text-primary-700 disabled:opacity-60">
            {busy && <Loader2 className="size-3 animate-spin" />} Criar fluxo
          </button>
        </>
      )}
    </span>
  )
}
