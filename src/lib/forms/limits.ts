// Kora Formulários — tetos do envio público (S1 de docs/forms-design.md §6). Fonte ÚNICA:
// o endpoint e a função do banco (form_submit, que só aceita valores numa faixa sã) leem daqui.

export const SUBMIT_LIMITS = {
  /** Respostas por formulário em 24 h. Acima disso é enxurrada, não cliente. */
  formDaily:   300,
  /** O mesmo número no mesmo formulário em 24 h (corrigir um envio cabe; mil não). */
  phoneDaily:  3,
  /** Envios do mesmo aparelho (IP) por hora, somando todos os formulários da empresa. */
  ipHourly:    20,
  /** Primeira barreira, na memória do servidor: pedidos por IP a cada 10 min. */
  ipBurst:     12,
  ipBurstWindowMs: 10 * 60_000,
  /** Robô preenche em milissegundos; gente leva segundos. */
  minFillMs:   3_000,
  /** A página aberta vale por 24 h (depois, recarregar). */
  renderTokenMaxAgeMs: 24 * 3_600_000,
  /** Tamanho máximo do corpo do envio. */
  maxBodyBytes: 64 * 1024,
} as const

/** Contadores dos Resultados (viu · começou · chegou a cada passo · saiu). Sem dado pessoal. */
export const TRACK_LIMITS = {
  /** Na memória do servidor: marcas por IP a cada 10 min (quem preenche gera ~10). */
  ipBurst:         240,
  ipBurstWindowMs: 10 * 60_000,
  /** Teto por passo e dia em cada formulário (a função do banco aceita até 1.000.000). */
  dailyPerStep:    50_000,
  maxBodyBytes:    512,
} as const
