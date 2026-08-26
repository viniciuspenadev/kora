import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A ficha de Persona do tenant — ou padrões neutros quando ela não existe.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 FONTE ÚNICA, E ISSO É O CONSERTO — NÃO UM REFACTOR DE ESTILO (2026-08-17).
 *
 *    Esta pergunta era feita em DOIS lugares com respostas DIFERENTES: a porta de
 *    entrada (`doStudioRun`) já caía nos padrões neutros, e o despertar (`doResume`)
 *    ainda tratava ficha ausente como "Studio desligado" e **encerrava o run**.
 *    Metade da correção tinha sido aplicada.
 *
 *    O estrago medido em produção: TODO fluxo com um nó **Esperar** morria no Esperar,
 *    para todo tenant que nunca salvou uma Persona — ou seja, exatamente quem NÃO usa
 *    IA. E morria marcado como `done`, então nada acusava a falha. Dois clientes, dois
 *    fluxos publicados, 12 dias sem ninguém perceber.
 *
 * 🔑 A Persona é SÓ da IA. Um fluxo determinístico (Mensagem/Menu/Coletar dado/Esperar)
 *    não precisa dela em NENHUM momento do seu ciclo — nem pra começar, nem pra acordar.
 *    Quem liga/desliga o Studio é o módulo `ai_studio`; quem liga/desliga a IA é o
 *    módulo `ai`, checado dentro dos nós Agente IA e Roteador IA (que degradam pela
 *    saída determinística em vez de travar).
 *
 * ⚠️ Tenant COM ficha recebe a linha real, idêntica ao que recebia antes, nos dois
 *    caminhos. Esta função não muda o comportamento de ninguém que funciona hoje.
 *
 * 🛡️ `scripts/check-studio-config.mjs` falha o build se alguém voltar a ler
 *    `studio_config` fora daqui — a divergência que causou isto deixa de ser possível.
 */
export async function loadStudioConfig(tenantId: string) {
  const { data } = await supabaseAdmin
    .from("studio_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  return data ?? {
    tenant_id:                tenantId,
    ai_enabled:               true,
    ai_name:                  null,
    ai_tone:                  null,
    ai_language:              "pt-BR",
    ai_model:                 "gpt-4.1",
    identity_text:            null,
    communication_style_text: null,
    anti_patterns_text:       null,
    ai_control_decoupled:     false,
  }

}
