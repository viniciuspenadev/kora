import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { PAST_DUE_GRACE_DAYS, TRIAL_ENDED_GRACE_DAYS } from "@/lib/lifecycle-shared"

// ═══════════════════════════════════════════════════════════════
// Configuração GLOBAL da plataforma
// ═══════════════════════════════════════════════════════════════
//
// 🔑 A CADEIA DE RESOLUÇÃO, e ela tem exatamente três elos:
//
//      tenants.past_due_grace_days      → o valor DESTE cliente   (null = segue o global)
//              ↓
//      platform_settings.*              → o padrão, editável no god mode
//              ↓
//      PAST_DUE_GRACE_DAYS (constante)  → só quando o banco não responde
//
// 🔴 A CONSTANTE MUDOU DE PAPEL (12/08) e é o ponto mais fácil de entender errado depois.
//    Ela deixou de ser "o padrão" e virou **o piso de quando não sabemos**. Por isso ela não
//    pode ser 0 (um blip de banco mandaria a base inteira pro paywall no mesmo segundo) nem
//    alta demais (o mesmo blip daria dias de produto de graça pra quem está atrasado).
//    Quem mexer nela: o critério não é mais "qual prazo a gente quer dar", é "qual prazo
//    erra menos quando o banco está fora".
//
// ⚠️ CACHE DE PROCESSO, não por request. Esta configuração muda talvez uma vez por ano e é
//    lida nos gates de acesso — que rodam em TODA requisição, no `auth()`, no login e na
//    extensão. Uma consulta por request seria uma consulta a mais no caminho mais quente do
//    produto pra ler um número que não muda. Com TTL de 60s, o custo vira ~1 consulta por
//    minuto por processo, e a mudança feita no god mode aparece em até um minuto.
// ⚠️ O TTL é curto de propósito: config que demora a valer faz o operador clicar duas vezes,
//    achar que não funcionou, e mexer em outra coisa.

/** O que a plataforma sabe sobre si mesma. Todos os campos são NOT NULL no banco. */
export interface PlatformSettings {
  pastDueGraceDays:     number
  trialEndedGraceDays:  number
  /** `false` = a consulta falhou e estes valores são as constantes de fallback. */
  doBanco:              boolean
}

/** O que responder quando o banco não respondeu. Nunca inventa: usa o piso declarado. */
const FALLBACK: PlatformSettings = {
  pastDueGraceDays:    PAST_DUE_GRACE_DAYS,
  trialEndedGraceDays: TRIAL_ENDED_GRACE_DAYS,
  doBanco:             false,
}

const TTL_MS = 60_000

let cache: { valor: PlatformSettings; em: number } | null = null
/** Consulta em voo — impede N requisições simultâneas de dispararem N consultas iguais. */
let emVoo: Promise<PlatformSettings> | null = null

/**
 * A configuração global. **Nunca lança e nunca devolve `null`** — degrada pro fallback.
 *
 * 🔑 Ela decide quando o cliente perde acesso. Uma exceção aqui derrubaria o `auth()`, o
 *    login e o layout de uma vez; um `null` faria cada chamador inventar o próprio padrão.
 *    Então o contrato é: sempre devolve número utilizável, e diz por `doBanco` se ele é o
 *    configurado ou o de emergência.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const agora = Date.now()
  if (cache && agora - cache.em < TTL_MS) return cache.valor
  if (emVoo) return emVoo

  emVoo = (async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("platform_settings")
        .select("past_due_grace_days, trial_ended_grace_days")
        .eq("id", true)
        .maybeSingle()

      // ⚠️ Erro E ausência caem no mesmo lugar, e aqui isso é correto (ao contrário do
      //    `fimDoCicloPago`, onde os dois são fatos diferentes): tanto "a consulta falhou"
      //    quanto "a linha sumiu" significam a mesma coisa pra quem pergunta — *não sei
      //    qual é o padrão configurado*. E a resposta certa nos dois casos é a constante.
      if (error || !data) {
        if (error) {
          console.error(JSON.stringify({
            src: "platform-settings", kind: "leitura-falhou-usando-fallback", msg: error.message,
          }))
        } else {
          // A linha nasce na migration. Sumir é anomalia de verdade, não caso normal.
          console.error(JSON.stringify({ src: "platform-settings", kind: "LINHA-UNICA-AUSENTE" }))
        }
        // 🔑 O fallback também é cacheado, de propósito: sem isso, um banco fora faria cada
        //    requisição tentar de novo — martelando um banco que já está sofrendo, no
        //    caminho do login. Ele expira no mesmo TTL e a recuperação é automática.
        const v = FALLBACK
        cache = { valor: v, em: Date.now() }
        return v
      }

      const row = data as { past_due_grace_days: number; trial_ended_grace_days: number }
      const valor: PlatformSettings = {
        pastDueGraceDays:    row.past_due_grace_days,
        trialEndedGraceDays: row.trial_ended_grace_days,
        doBanco:             true,
      }
      cache = { valor, em: Date.now() }
      return valor
    } catch (e) {
      console.error(JSON.stringify({
        src: "platform-settings", kind: "excecao-usando-fallback", msg: (e as Error).message,
      }))
      cache = { valor: FALLBACK, em: Date.now() }
      return FALLBACK
    } finally {
      emVoo = null
    }
  })()

  return emVoo
}

/**
 * Esquece o cache. Chamado logo depois de o god mode gravar.
 *
 * ⚠️ Só limpa o cache **deste processo**. Com várias instâncias, as outras seguem com o
 *    valor velho até o TTL vencer — no máximo 60s. É aceitável para um prazo em dias, e
 *    dizer isso aqui é melhor que alguém supor propagação instantânea.
 */
export function invalidatePlatformSettings(): void {
  cache = null
}
