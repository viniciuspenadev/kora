import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, UploadCloud } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { getImportContacts } from "@/lib/actions/import-contacts"
import { formatPhoneDisplay } from "@/lib/phone-utils"

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/contatos")
  const { id } = await params

  const { record, contacts } = await getImportContacts(id)
  if (!record) notFound()

  const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })

  return (
    <PageShell
      title="Importação"
      description={`${fmt(record.created_at)}${record.by_name ? ` · ${record.by_name}` : ""}`}
      icon={UploadCloud}
    >
      <div className="space-y-4 max-w-3xl">
        <Link href="/contatos/importar" className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700"><ArrowLeft className="size-3.5" /> Importações</Link>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-6 flex-wrap">
          <Stat n={record.created} label="criados" c="text-emerald-600" />
          <Stat n={record.updated} label="atualizados" c="text-primary-600" />
          <Stat n={record.invalid} label="inválidos" c="text-slate-400" />
          <div className="text-xs text-slate-400 ml-auto space-y-0.5">
            <p>Origem: {record.source === "csv" ? "CSV" : "colado"}</p>
            {record.tag_name && <p>Tag: {record.tag_name}</p>}
            <p>LGPD: {record.consent ? "consentimento ✓" : "—"}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 h-11 flex items-center border-b border-slate-100"><p className="text-sm font-semibold text-slate-900">{contacts.length} contatos deste import</p></div>
          {contacts.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-slate-400">Sem contatos vinculados.</p>
          ) : (
            <ul>
              {contacts.map((c) => (
                <li key={c.id}>
                  <Link href={`/contatos/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                      <p className="text-[11px] text-slate-400 tabular-nums">{formatPhoneDisplay(c.phone) || "—"}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.status === "created" ? "bg-emerald-50 text-emerald-700" : "bg-primary-50 text-primary-700"}`}>{c.status === "created" ? "criado" : "atualizado"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageShell>
  )
}

function Stat({ n, label, c }: { n: number; label: string; c: string }) {
  return <div className="text-center"><p className={`text-2xl font-bold tabular-nums ${c}`}>{n}</p><p className="text-[10px] text-slate-400">{label}</p></div>
}
