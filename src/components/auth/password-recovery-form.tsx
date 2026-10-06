"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
export function PasswordRecoveryForm({reset=false}:{reset?:boolean}) {
  const initialized=useRef(false)
  const [token,setToken]=useState("")
  const [loaded,setLoaded]=useState(!reset)
  const [email,setEmail]=useState("")
  const [password,setPassword]=useState("")
  const [confirmation,setConfirmation]=useState("")
  const [visible,setVisible]=useState(false)
  const [busy,setBusy]=useState(false)
  const [success,setSuccess]=useState(false)
  const [notice,setNotice]=useState("")
  const [error,setError]=useState("")
  const [cooldown,setCooldown]=useState(0)
  useEffect(()=>{if(reset && !initialized.current){initialized.current=true;const value=new URLSearchParams(window.location.hash.slice(1)).get("token")??"";setToken(/^[A-Za-z0-9_-]{43}$/.test(value)?value:"");setLoaded(true);window.history.replaceState(null,"",window.location.pathname)}},[reset])
  useEffect(()=>{if(cooldown>0){const timer=setTimeout(()=>setCooldown(n=>n-1),1000);return()=>clearTimeout(timer)}},[cooldown])
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return
    setError("");setBusy(true)
    try {
      const response=await fetch("/api/auth/password-recovery/"+(reset?"reset":"request"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(reset?{token,password,confirmation}:{email})})
      const data=await response.json()
      if (!response.ok) {setError(data.error||"Tente novamente em instantes.");return}
      if(reset){setSuccess(true);setPassword("");setConfirmation("");setToken("")}
      else {setNotice(data.message);setCooldown(60)}
    } catch {setError("Não conseguimos confirmar a solicitação. Tente novamente em instantes.")}
    finally{setBusy(false)}
  }
  const input="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
  return <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-9">
      <Image src="/logo_kora.png" alt="Kora" width={160} height={55} className="mx-auto mb-7 h-12 w-auto" priority />
      <h1 className="text-center text-xl font-bold text-slate-900">{success?"Senha redefinida":reset?"Crie sua nova senha":"Recupere seu acesso"}</h1>
      <p className="mb-6 mt-2 text-center text-sm leading-relaxed text-slate-500">{success?"Entre novamente com sua nova senha. Por segurança, seus acessos anteriores foram encerrados.":reset?"Escolha uma senha diferente da anterior. Uma frase longa é mais fácil de lembrar.":"Informe o e-mail que você usa para entrar no Kora."}</p>
      {success ? <div className="space-y-5"><CheckCircle2 className="mx-auto size-10 text-emerald-600"/><Button render={<Link href="/auth/signin" />} nativeButton={false} className="h-12 w-full">Voltar ao login</Button></div>
      : reset && loaded && !token ? <div className="space-y-4"><p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Este link não é válido. Solicite um novo link para redefinir sua senha.</p><Button render={<Link href="/auth/forgot-password" />} nativeButton={false} className="w-full">Solicitar novo link</Button></div>
      : <form onSubmit={submit} className="space-y-4">
        {!reset ? <div className="space-y-2"><label htmlFor="recovery-email" className="text-sm font-medium text-slate-700">E-mail</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy} className={input}/></div>
        : <><div className="space-y-2"><label htmlFor="new-password" className="text-sm font-medium text-slate-700">Nova senha</label><div className="relative"><input id="new-password" type={visible?"text":"password"} autoComplete="new-password" required minLength={15} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy||!loaded} className={input+" pr-12"}/><button type="button" aria-label={visible?"Ocultar senha":"Mostrar senha"} aria-pressed={visible} onClick={()=>setVisible(v=>!v)} className="absolute right-3 top-3.5 text-slate-500">{visible?<EyeOff className="size-5"/>:<Eye className="size-5"/>}</button></div><p className="text-xs text-slate-500">Pelo menos 15 caracteres, com uma letra e um número.</p></div>
        <div className="space-y-2"><label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">Confirme a nova senha</label><input id="confirm-password" type={visible?"text":"password"} autoComplete="new-password" required maxLength={72} value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy||!loaded} className={input}/></div></>}
        {notice && <p role="status" className="rounded-xl border border-primary-100 bg-primary-50 p-4 text-sm leading-relaxed text-slate-700">{notice}</p>}
        {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0"/>{error}</div>}
        <Button type="submit" className="h-12 w-full" disabled={busy||!loaded||cooldown>0}>{busy&&<Loader2 className="size-4 animate-spin"/>}{busy?"Aguarde…":reset?"Salvar nova senha":cooldown>0?"Enviar novamente em "+cooldown+"s":"Enviar link de recuperação"}</Button>
      </form>}
      {!success&&<Link href="/auth/signin" className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-primary"><ArrowLeft className="size-4"/>Voltar ao login</Link>}
    </section>
  </main>
}
