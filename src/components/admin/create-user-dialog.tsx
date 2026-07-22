"use client"

// ═══════════════════════════════════════════════════════════════
// God Mode — diálogo "Criar usuário" (acesso direto, sem convite)
// ═══════════════════════════════════════════════════════════════
// Implantação: cria o acesso na hora e mostra as credenciais UMA vez pra
// copiar e entregar ao cliente (a senha não fica recuperável depois).

import { useState, useTransition } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createTenantUser } from "@/lib/actions/admin-users"
import { UserPlus, RefreshCw, Copy, Check } from "lucide-react"

const ROLE_OPTIONS = [
  { value: "agent", label: "Atendente" },
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner (só se o tenant não tiver)" },
] as const

/** Senha temporária legível-forte: 12 chars, sempre com letra e número. */
function generatePassword(): string {
  const alpha = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"
  const digit = "23456789"
  const all   = alpha + digit
  const buf   = new Uint32Array(12)
  crypto.getRandomValues(buf)
  let pw = Array.from(buf, (n) => all[n % all.length]).join("")
  // Garante a política (letra + número) sem enfraquecer o resto.
  pw = alpha[buf[0] % alpha.length] + digit[buf[1] % digit.length] + pw.slice(2)
  return pw
}

export function CreateUserDialog({ tenantId }: { tenantId: string }) {
  const [open, setOpen]         = useState(false)
  const [fullName, setFullName] = useState("")
  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState(() => generatePassword())
  const [role, setRole]         = useState<"owner" | "admin" | "agent">("agent")
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState<{ linkedExisting: boolean } | null>(null)
  const [copied, setCopied]     = useState(false)
  const [pending, startTransition] = useTransition()

  function reset() {
    setFullName(""); setEmail(""); setPassword(generatePassword())
    setRole("agent"); setError(null); setDone(null); setCopied(false)
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await createTenantUser({ tenantId, fullName, email, password, role })
      if ("error" in r) { setError(r.error); return }
      setDone({ linkedExisting: r.linkedExisting })
    })
  }

  async function copyCredentials() {
    await navigator.clipboard.writeText(`Acesso Kora\nE-mail: ${email.trim().toLowerCase()}\nSenha: ${password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const LABEL = "text-xs font-semibold text-slate-600"
  const FIELD = "mt-1"

  return (
    <>
      <Button size="sm" onClick={() => { reset(); setOpen(true) }} className="gap-1.5">
        <UserPlus className="size-3.5" /> Criar usuário
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!pending) setOpen(v) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{done ? "Usuário criado" : "Criar usuário direto"}</DialogTitle>
          </DialogHeader>

          {done ? (
            <div className="space-y-3">
              {done.linkedExisting ? (
                <p className="text-sm text-slate-600">
                  Este e-mail <b>já tinha conta</b> na plataforma — foi <b>vinculado ao tenant</b> com o papel
                  escolhido. <b>A senha atual dele continua valendo</b> (a digitada aqui foi ignorada).
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-600">
                    Acesso criado e ativo. Copie e entregue as credenciais — <b>a senha não fica visível depois</b>.
                  </p>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 space-y-1">
                    <p>E-mail: {email.trim().toLowerCase()}</p>
                    <p>Senha:&nbsp; {password}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={copyCredentials} className="gap-1.5">
                    {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                    {copied ? "Copiado" : "Copiar acesso"}
                  </Button>
                </>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setOpen(false)}>Fechar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className={LABEL}>Nome completo</label>
                <Input className={FIELD} value={fullName} onChange={(e) => setFullName(e.target.value)}
                  placeholder="Maria Silva" autoFocus />
              </div>
              <div>
                <label className={LABEL}>E-mail (login)</label>
                <Input className={FIELD} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="maria@cliente.com.br" />
              </div>
              <div>
                <label className={LABEL}>Senha temporária</label>
                <div className="mt-1 flex gap-2">
                  <Input className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <Button type="button" size="sm" variant="outline" onClick={() => setPassword(generatePassword())}
                    className="shrink-0 gap-1.5" title="Gerar outra">
                    <RefreshCw className="size-3.5" /> Gerar
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Se o e-mail já tiver conta, a senha atual dele é mantida.</p>
              </div>
              <div>
                <label className={LABEL}>Papel</label>
                <select
                  className="mt-1 w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  value={role} onChange={(e) => setRole(e.target.value as typeof role)}
                >
                  {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {error && (
                <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
                <Button size="sm" onClick={submit} disabled={pending || !fullName.trim() || !email.trim()}>
                  {pending ? "Criando…" : "Criar acesso"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
