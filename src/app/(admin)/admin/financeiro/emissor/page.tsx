import Link from "next/link"
import { ChevronLeft, Building2 } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { CompanyForm, type CompanyData } from "@/components/admin/company-form"
import { upsertIssuer } from "@/lib/actions/admin-company"

export default async function IssuerPage() {
  const { data: issuer } = await supabaseAdmin.from("billing_issuer").select("*").eq("id", true).maybeSingle()

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <Link href="/admin/financeiro" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-primary-600 mb-2">
          <ChevronLeft className="size-3.5" /> Financeiro
        </Link>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Building2 className="size-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Dados do emissor</h1>
            <p className="text-xs text-slate-400 mt-0.5">Seus dados (Kora/BlueDigitalHub) — aparecem como quem emite a fatura.</p>
          </div>
        </div>
      </div>
      <div className="px-6 py-6">
        <CompanyForm mode="issuer" initial={(issuer ?? null) as CompanyData | null} onSave={upsertIssuer} />
      </div>
    </div>
  )
}
