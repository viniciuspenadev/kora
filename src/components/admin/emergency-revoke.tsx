"use client"

import { useState, useTransition } from "react"
import { emergencyRevokeTenantAccess } from "@/lib/actions/admin-security"

/**
 * 🚨 Botão de emergência do god mode — "encerrar todos os acessos agora".
 *
 * 🔴 DELIBERADAMENTE FORA da fileira de Suspender/Desativar. Ele responde a uma pergunta
 *    diferente (conta invadida, não fim de contrato) e não muda a relação comercial. Um
 *    clique errado entre os dois é caro nos DOIS sentidos: suspender por engano marca um
 *    cliente em dia como problemático; revogar por engano derruba a operação inteira dele.
 *    Por isso: seção própria, cor própria, motivo obrigatório e resumo do que caiu.
 */
export function EmergencyRevoke({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [open, setOpen]       = useState(false)
  const [reason, setReason]   = useState("")
  const [error, setError]     = useState<string | null>(null)
  const [done, setDone]       = useState<string | null>(null)
  const [failed, setFailed]   = useState<string | null>(null)
  const [pending, start]      = useTransition()

  function submit() {
    setError(null)
    start(async () => {
      const r = await emergencyRevokeTenantAccess(tenantId, reason)
      if ("error" in r) { setError(r.error); return }
      const v = r.revoked
      const resumo =
        `${v.sessions} sessão(ões) · ${v.extensionTokens} token(s) da extensão · ` +
        `${v.pushSubscriptions} inscrição(ões) de push · ${v.deviceTrust} confiança(s) de dispositivo`
      // 🔴 NUNCA mostrar ✅ sobre cascata parcial (QA 2026-08-03). `revokeTenantAccess` é
      //    best-effort: se o passo dos tokens falhar, a contagem vem 0 — **indistinguível
      //    de "não havia token"**. Era o único ponto do produto onde um falso positivo
      //    custa caro: o admin vê check verde num incidente real e PARA de responder,
      //    com credencial viva do outro lado. Falhou = vermelho e "repita".
      if (v.errors.length > 0) setFailed(`${v.errors.join(" · ")} — repita a operação.`)
      else setDone(resumo)
      setOpen(false)
      setReason("")
    })
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-red-900">Encerrar todos os acessos agora</h3>
          <p className="mt-1 text-xs text-red-800/80 leading-relaxed">
            Para conta <strong>comprometida</strong>. Derruba sessões, tokens da extensão, notificações
            e a confiança de dispositivo — todo mundo precisa entrar de novo <strong>e refazer o
            segundo fator</strong>. Não altera o plano nem o status comercial do cliente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(true); setDone(null); setFailed(null) }}
          disabled={pending}
          className="shrink-0 h-9 px-3 text-xs font-semibold rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Encerrar acessos
        </button>
      </div>

      {done && (
        <p className="mt-3 text-xs font-medium text-red-900 bg-white border border-red-200 rounded-lg px-3 py-2">
          ✅ Acessos encerrados — {done}
        </p>
      )}

      {failed && (
        <p className="mt-3 text-xs font-bold text-white bg-red-600 rounded-lg px-3 py-2">
          ⚠️ Cascata INCOMPLETA — parte das credenciais pode continuar válida. {failed}
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-900">Encerrar acessos de {tenantName}</h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Todos os usuários deste cliente serão desconectados imediatamente e precisarão fazer
              login de novo, com código por e-mail. O plano e o status <strong>não</strong> mudam.
            </p>

            <label className="mt-4 block text-xs font-semibold text-slate-700">
              Motivo <span className="font-normal text-slate-500">(fica registrado na trilha)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Ex: notebook do atendente roubado, relatado às 14h de hoje"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary"
            />

            {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null) }}
                disabled={pending}
                className="h-9 px-4 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="h-9 px-4 text-xs font-semibold rounded-lg text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Encerrando…" : "Encerrar acessos"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
