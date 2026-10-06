import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// CASCATA DE REVOGAÇÃO — "derruba tudo que este cliente tem aberto"
// ═══════════════════════════════════════════════════════════════
// docs/access-revocation-design.md §5.
//
// 🔴 O PROBLEMA QUE ISTO RESOLVE. Desativar um cliente escrevia numa coluna e parava aí.
//    O corte acontecia por RELÓGIO — a revalidação de sessão roda no máximo 1×/5min — e
//    ninguém derrubava sessão, token de extensão ou push. "Desativei às 14h" e "os acessos
//    dele morreram às 14h" eram afirmações diferentes, e só a primeira era provável.
//
// ⚠️ ISTO É ACELERAÇÃO, NÃO A VERDADE. A verdade é `tenants.lifecycle_state`/`active`: é
//    ela que impede o login novo e que a revalidação de 5min consulta. Esta cascata só
//    encurta a janela. Por isso **nada aqui lança**: se a limpeza falhar no meio, o cliente
//    continua desativado e o relógio termina o serviço. Falhar ruidosamente aqui faria o
//    chamador achar que a desativação não aconteceu — quando aconteceu.
//
// 🔴 ORDEM (o chamador é responsável): grava o ESTADO primeiro, chama isto depois. Ao
//    contrário, uma falha no meio deixaria "todos desconectados + conta ativa" — e todo
//    mundo loga de volta no minuto seguinte, agora com a trilha mentindo.
//    (É o inverso da revogação de MÓDULO, onde aquietar vem antes — lá o risco é campanha
//    rodando com o módulo já desligado. Aqui o risco é o contrário. Vale reler antes de
//    "padronizar" as duas.)

export interface RevokeTenantAccessResult {
  /** Sessões web apagadas do gerenciador (o cookie morre na próxima revalidação). */
  sessions: number
  /** Tokens da extensão marcados como revogados. */
  extensionTokens: number
  /** Inscrições de push apagadas (elas carregam PII no payload). */
  pushSubscriptions: number
  /** Confianças de dispositivo revogadas — 0 salvo `includeDeviceTrust`. */
  deviceTrust: number
  /** Passos que falharam. Vazio = cascata completa. */
  errors: string[]
}

export interface RevokeTenantAccessOptions {
  /**
   * Revogar também a confiança de dispositivo dos usuários (força código por e-mail no
   * próximo login).
   *
   * ⚠️ **`false` por padrão, e o motivo é dano colateral.** `auth_device_trust` é por
   * USUÁRIO, não por cliente — a tabela não tem `tenant_id`. Uma pessoa que atende dois
   * clientes nossos e tem um deles desativado perderia a confiança do dispositivo no
   * outro, que está em dia. Confiança de dispositivo **não dá acesso**: ela só dispensa o
   * segundo fator. Não é o que você quer derrubar num fim de contrato.
   *
   * ✅ Ligue no caso de **conta comprometida** (botão de emergência): aí o segundo fator é
   * exatamente a defesa que você quer de volta, e o dano colateral é aceitável.
   */
  includeDeviceTrust?: boolean
}

/**
 * Derruba os acessos abertos de um cliente. Best-effort, nunca lança.
 *
 * Chamadores: a transição de ciclo de vida (suspender/desativar) e o botão de emergência
 * do god mode. Os dois passam pelo MESMO caminho de propósito — duas implementações da
 * mesma limpeza divergiriam, e foi assim que o predicado de bloqueio virou duas cópias.
 */
export async function revokeTenantAccess(
  tenantId: string,
  opts?: RevokeTenantAccessOptions,
): Promise<RevokeTenantAccessResult> {
  const out: RevokeTenantAccessResult = {
    sessions: 0, extensionTokens: 0, pushSubscriptions: 0, deviceTrust: 0, errors: [],
  }
  if (!tenantId) { out.errors.push("tenantId vazio"); return out }

  const nowIso = new Date().toISOString()

  // 1) Sessões web. Apagar a linha é o que a revalidação do `auth.ts` enxerga: ela procura
  //    o `sid` no banco e, não achando, apaga o cookie. Sem linha = sessão morta.
  try {
    const { data, error } = await supabaseAdmin
      .from("user_sessions").delete().eq("tenant_id", tenantId).select("id")
    if (error) out.errors.push(`sessions: ${error.message}`)
    else out.sessions = data?.length ?? 0
  } catch (e) { out.errors.push(`sessions: ${(e as Error).message}`) }

  // 2) Extensão. `revoked_at` em vez de delete — a extensão já checa esse campo a cada
  //    request, e manter a linha preserva a trilha (quem tinha token, desde quando).
  try {
    const { data, error } = await supabaseAdmin
      .from("device_tokens").update({ revoked_at: nowIso })
      .eq("tenant_id", tenantId).is("revoked_at", null).select("id")
    if (error) out.errors.push(`device_tokens: ${error.message}`)
    else out.extensionTokens = data?.length ?? 0
  } catch (e) { out.errors.push(`device_tokens: ${(e as Error).message}`) }

  // 3) Push. Aqui delete é obrigatório, não escolha: o payload da notificação carrega
  //    nome do contato e prévia da mensagem (PII). Inscrição órfã de cliente desativado
  //    que ainda receba é vazamento, não inconveniência.
  try {
    const { data, error } = await supabaseAdmin
      .from("push_subscriptions").delete().eq("tenant_id", tenantId).select("id")
    if (error) out.errors.push(`push: ${error.message}`)
    else out.pushSubscriptions = data?.length ?? 0
  } catch (e) { out.errors.push(`push: ${(e as Error).message}`) }

  // 4) Confiança de dispositivo — só quando pedida (ver o comentário da opção).
  if (opts?.includeDeviceTrust) {
    try {
      const { data: members, error: memErr } = await supabaseAdmin
        .from("tenant_users").select("user_id").eq("tenant_id", tenantId)
      if (memErr) out.errors.push(`trust/membros: ${memErr.message}`)
      else {
        const ids = [...new Set((members ?? []).map((m) => (m as { user_id: string }).user_id))]
        if (ids.length) {
          const { data, error } = await supabaseAdmin
            .from("auth_device_trust").update({ revoked_at: nowIso })
            .in("user_id", ids).is("revoked_at", null).select("id")
          if (error) out.errors.push(`trust: ${error.message}`)
          else out.deviceTrust = data?.length ?? 0
        }
      }
    } catch (e) { out.errors.push(`trust: ${(e as Error).message}`) }
  }

  // 🔴 Grita no console ALÉM do audit. O chamador manda `out.errors` pro `logAudit`, mas
  //    `logAudit` engole o próprio erro (audit.ts) — se o insert da trilha falhar, a falha
  //    da cascata não sobraria em lugar nenhum. Duas superfícies pra um evento que só
  //    acontece quando algo já deu errado.
  if (out.errors.length) {
    console.error("[revoke-tenant-access] cascata incompleta:", tenantId, out.errors.join(" · "))
  }
  return out
}
