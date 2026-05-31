import { auth } from "@/auth"
import { EMAIL_CATALOG } from "@/lib/email/catalog"
import { listTenantsForEmailTest } from "@/lib/actions/admin-emails"
import { EmailsClient, type TemplateMeta } from "./client"

export default async function AdminEmailsPage() {
  const session = await auth()

  const templates: TemplateMeta[] = EMAIL_CATALOG.map((t) => ({
    slug:        t.slug,
    name:        t.name,
    description: t.description,
    trigger:     t.trigger,
    subject:     t.build().subject,
    variables:   t.variables,
  }))

  const tenants = await listTenantsForEmailTest()

  return <EmailsClient templates={templates} tenants={tenants} defaultTestEmail={session?.user?.email ?? ""} />
}
