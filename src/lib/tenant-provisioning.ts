import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

export type ProvisionedTenant = { tenant_id: string; user_id?: string; invite_id?: string; activated: boolean }

/** Both entry points commit the same base in PostgreSQL, including plan entitlements. */
export async function provisionTenant(
  origin: "signup" | "godmode",
  args: Record<string, unknown>,
): Promise<{ ok: true; value: ProvisionedTenant } | { ok: false; error: string; canEdit?: boolean }> {
  const { data, error } = await supabaseAdmin.rpc(
    origin === "signup" ? "confirmar_signup_atomico" : "criar_cliente_godmode_atomico", args,
  )
  if (error) {
    // Database errors may contain emails, tokens or submitted values. Never forward them.
    console.error(JSON.stringify({ src: "tenant-provisioning", origin, code: error.code }))
    const message = error.message ?? ""
    return { ok: false, canEdit: /slug_unavailable|plan_unavailable|invalid_input|invalid_access|seat_limit_reached/.test(message), error: message.includes("slug_unavailable") ? "Este identificador já está em uso. Escolha outro."
      : message.includes("request_conflict") ? "Este cadastro já foi enviado com outros dados. Abra um novo cadastro."
      : message.includes("gateway_plan_unavailable") ? "Este plano não permite contratação pelo gateway. Selecione um plano pago ou a modalidade manual."
      : message.includes("plan_unavailable") ? "O plano selecionado não está mais disponível."
      : message.includes("signup_exists") ? "Já existe um cadastro com esses dados. Entre na sua conta."
      : "Não foi possível concluir o cadastro. Tente novamente; a operação não cria uma segunda conta." }
  }
  if (data?.error) return { ok: false, error: data.error }
  if (!data?.tenant_id) return { ok: false, error: "O cadastro não foi confirmado. Tente novamente." }
  return { ok: true, value: data as ProvisionedTenant }
}
