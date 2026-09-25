"use client"
import { useEffect, useState } from "react"
import { PenLine, Loader2, Save, CheckCheck } from "lucide-react"
import { getSignatureSettings, saveSignatureSettings } from "@/lib/actions/agent-signature"
import { emptySignaturePolicy, signatureName } from "@/lib/atendimento/agent-signature"
import { SectionCard } from "@/components/ui/section-card"
import { Switch } from "@/components/ui/switch"
type Data = Awaited<ReturnType<typeof getSignatureSettings>>
export function AgentSignatureSettings() {
  const [data, setData] = useState<Data | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let current = true
    getSignatureSettings().then(value => { if (current) { setData(value); setEnabled(value.policy.enabled) } })
      .catch(() => { if (current) setError("Não foi possível carregar. Atualize a página para tentar novamente.") })
    return () => { current = false }
  }, [])
  async function save() {
    if (!data || busy) return
    setBusy(true); setError(""); setSaved(false)
    const policy = { ...emptySignaturePolicy(), enabled }
    try { const result = await saveSignatureSettings(policy, data.raw)
      if (result.error) setError(result.error)
      else { setData({ ...data, raw: policy, policy, exists: true }); setSaved(true) }
    } catch { setError("Não foi possível confirmar. Recarregue antes de tentar novamente.") }
    finally { setBusy(false) }
  }
  return <SectionCard title="Nome do atendente nas mensagens" icon={PenLine} description="Uma configuração para toda a equipe, no WhatsApp e na API Oficial.">
    {!data ? <p role="status" className="text-sm text-slate-500">{error || "Carregando configuração…"}</p> : <>
      <fieldset disabled={busy || !data.ready} className="min-w-0 space-y-4 disabled:opacity-60">
        <div className="flex items-start justify-between gap-4">
          <div><label htmlFor="agent-signature-default" className="text-sm font-semibold text-slate-900">Mostrar nome do atendente nas mensagens</label>
          <p className="mt-1 text-sm text-slate-500">Usa automaticamente o nome cadastrado de quem envia, em textos e legendas, inclusive nos grupos.</p></div>
          <Switch id="agent-signature-default" checked={enabled} onChange={value => { setEnabled(value); setSaved(false); setError("") }} />
        </div>
        <div className="max-w-md" aria-live="polite"><SignatureMessagePreview label="Prévia para o cliente" name={enabled ? signatureName(data.previewName) : null} /></div>
        <p className="text-xs text-slate-500">Não se aplica a automações, templates, notas internas ou áudios. Vale para novas mensagens após salvar.</p>
      </fieldset>
      {!data.ready && <p role="status" className="mt-3 text-sm text-amber-700">Configuração ainda indisponível nesta versão do banco.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void save()} disabled={busy || !data.ready || enabled === data.policy.enabled} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Salvar</button>
      {saved && <p role="status" className="text-xs text-emerald-700">Configuração salva.</p>}{error && <p role="alert" className="text-xs text-red-700">{error}</p>}</div>
    </>}
  </SectionCard>
}

function SignatureMessagePreview({ label, name }: { label: string; name: string | null }) {
  return <figure className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <figcaption className="mb-3 text-xs font-semibold text-slate-600">{label}</figcaption>
    <div className="ml-auto max-w-sm rounded-xl rounded-tr-sm border border-primary-100 bg-primary-50 px-4 py-3 text-sm leading-relaxed text-slate-800">
      {name && <p className="mb-3 break-words font-bold text-slate-900">{name}</p>}
      <p>Olá, tudo bem?</p>
      <div aria-hidden="true" className="mt-2 flex items-center justify-end gap-1 text-[10px] tabular-nums text-slate-400"><span>10:30</span><CheckCheck className="size-3.5 text-primary" /></div>
    </div>
  </figure>
}
