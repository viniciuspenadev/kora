// ═══════════════════════════════════════════════════════════════
// Opções do wizard de boas-vindas — lista única
// ═══════════════════════════════════════════════════════════════
// Sem `server-only`: o cliente desenha os cards a partir DESTAS listas e o servidor valida
// contra ELAS MESMAS. Duas listas (uma na tela, outra na action) é como um botão que a
// pessoa clica vira "opção inválida" no save.
//
// ⚠️ Estes valores viram DADO HISTÓRICO no banco. Renomear um `value` depois faz os
//    cadastros antigos apontarem pro nada nos relatórios. Rótulo (`label`) pode mudar à
//    vontade; `value` é para sempre.

export interface Opcao {
  value: string
  label: string
  /** Abre um campo de texto complementar quando escolhida. */
  detalhe?: string
}

/** Por onde conheceu a Kora. Ordem = frequência esperada, não alfabética. */
export const ORIGENS: Opcao[] = [
  { value: "indicacao", label: "Indicação de alguém", detalhe: "Quem indicou?" },
  { value: "instagram", label: "Instagram" },
  { value: "google",    label: "Busca no Google" },
  { value: "youtube",   label: "YouTube" },
  { value: "tiktok",    label: "TikTok" },
  { value: "anuncio",   label: "Anúncio" },
  { value: "evento",    label: "Evento ou feira" },
  { value: "outro",     label: "Outro", detalhe: "Onde?" },
]

/**
 * Segmento. A Kora é horizontal — isto é DECLARAÇÃO do cliente, não configuração.
 * ⚠️ Escolher segmento aqui não liga nem desliga nada. No dia em que ligar (vertical
 *    odonto), o gate continua sendo módulo no banco, nunca este campo.
 */
export const SEGMENTOS: Opcao[] = [
  { value: "saude",       label: "Saúde e bem-estar" },
  { value: "beleza",      label: "Beleza e estética" },
  { value: "educacao",    label: "Educação e cursos" },
  { value: "servicos",    label: "Serviços" },
  { value: "comercio",    label: "Comércio e varejo" },
  { value: "imobiliario", label: "Imobiliário" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "outro",       label: "Outro", detalhe: "Qual?" },
]

/** Tamanho do time que vai atender. Faixas, não número exato — ninguém sabe o exato. */
export const TAMANHOS: Opcao[] = [
  { value: "so_eu",  label: "Só eu" },
  { value: "2_5",    label: "2 a 5 pessoas" },
  { value: "6_15",   label: "6 a 15 pessoas" },
  { value: "16_mais", label: "Mais de 15" },
]

/** O que usa hoje. Vale ouro: diz de quem a gente ganha e o que precisa importar. */
export const FERRAMENTAS: Opcao[] = [
  { value: "whatsapp_puro", label: "WhatsApp no celular mesmo" },
  { value: "whatsapp_business", label: "WhatsApp Business" },
  { value: "planilha",      label: "Planilha" },
  { value: "outro_sistema", label: "Outro sistema", detalhe: "Qual?" },
  { value: "nada",          label: "Nada organizado ainda" },
]

const valores = (l: Opcao[]) => new Set(l.map((o) => o.value))

const VALIDOS = {
  acquisition_source: valores(ORIGENS),
  business_segment:   valores(SEGMENTOS),
  team_size:          valores(TAMANHOS),
  current_tool:       valores(FERRAMENTAS),
} as const

/**
 * Aceita o valor só se ele estiver na lista. Qualquer outra coisa vira `null`.
 *
 * ⚠️ Descarta em silêncio, não recusa: isto é pesquisa, não cadastro fiscal. Travar o
 *    wizard porque um valor chegou estranho seria impedir a pessoa de entrar no produto
 *    por causa de um campo de marketing.
 */
export function opcaoValida(campo: keyof typeof VALIDOS, valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim()
  return v && VALIDOS[campo].has(v) ? v : null
}
