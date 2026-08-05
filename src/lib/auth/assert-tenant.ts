import "server-only"
import { auth } from "@/auth"

/**
 * Guard pra HELPER exportado de um arquivo "use server" que recebe `tenantId` por
 * parâmetro (padrão perigoso — corrigido no sweep 2026-07-30).
 *
 * No Next, TODA função exportada de um módulo "use server" vira Server Action PÚBLICA
 * chamável via RSC — mesmo "helper interno". Se ela recebe `tenantId` do caller e não
 * valida, um atacante forja a chamada com tenantId ALHEIO → operação cross-tenant.
 *
 * Este guard exige sessão E que o `tenantId` do parâmetro seja o MESMO da sessão. Todos os
 * callers legítimos derivam `tenantId` de `session.user.tenantId`, então passam; a chamada
 * forjada (tenant alheio, ou sem sessão) é rejeitada. Fecha o vetor sem mover o helper.
 *
 * ⚠️ Isto é MITIGAÇÃO. O ideal é o helper NÃO ser exportado de "use server" (mover pra
 * módulo server-only). Ver skill `database-rules` §2. Guardrail de CI reconhece este guard.
 */
export async function assertSessionTenant(tenantId: string): Promise<void> {
  const session = await auth()
  if (!session?.user?.tenantId || session.user.tenantId !== tenantId) {
    throw new Error("Acesso negado")
  }
}
