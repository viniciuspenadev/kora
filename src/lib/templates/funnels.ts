// ═══════════════════════════════════════════════════════════════
// Biblioteca de modelos de funil (dado — não código de core)
// ═══════════════════════════════════════════════════════════════
// Catálogo por SEGMENTO. Cada blueprint pode ter 1 funil (modelo) ou N (kit).
// Aplicar = criar os pipelines + etapas. Adicionar segmento/modelo = adicionar
// dado aqui, zero mexida no core (jogada horizontal: vertical mora fora).

export type FunnelSegment =
  | "vendas" | "atendimento" | "estetica" | "odontologia"
  | "saude" | "moveis" | "imobiliaria" | "escolar"

export const SEGMENT_LABELS: Record<FunnelSegment, string> = {
  vendas:       "Vendas",
  atendimento:  "Atendimento",
  estetica:     "Estética",
  odontologia:  "Odontologia",
  saude:        "Saúde",
  moveis:       "Móveis planejados",
  imobiliaria:  "Imobiliária",
  escolar:      "Escolar",
}

export const SEGMENT_ORDER: FunnelSegment[] = [
  "vendas", "atendimento", "estetica", "odontologia", "saude", "moveis", "imobiliaria", "escolar",
]

export interface TemplateStage {
  name: string; color: string; probability_pct: number
  is_won?: boolean; is_lost?: boolean; is_triage?: boolean; show_in_kanban?: boolean
}
export interface TemplateFunnel { name: string; color: string; stages: TemplateStage[] }
export interface FunnelBlueprint {
  id: string; name: string; segment: FunnelSegment; description: string
  badge?: "Kit" | "Essencial"; funnels: TemplateFunnel[]
}

// Paleta
const BLUE = "#3B82F6", VIOLET = "#8B5CF6", CYAN = "#06B6D4", GREEN = "#10B981",
  AMBER = "#F59E0B", ORANGE = "#F97316", RED = "#EF4444", PINK = "#EC4899", SLATE = "#64748B"

// helpers de etapa
const s  = (name: string, color: string, p: number): TemplateStage => ({ name, color, probability_pct: p })
const tri = (name: string, color: string, p = 0): TemplateStage => ({ name, color, probability_pct: p, is_triage: true })
const won = (name: string, color = GREEN): TemplateStage => ({ name, color, probability_pct: 100, is_won: true })
const lost = (name: string): TemplateStage => ({ name, color: RED, probability_pct: 0, is_lost: true })

export const FUNNEL_TEMPLATES: FunnelBlueprint[] = [
  // ── Vendas ──
  {
    id: "vendas-b2b", name: "Vendas B2B", segment: "vendas", badge: "Essencial",
    description: "Funil clássico de aquisição, do lead ao fechamento.",
    funnels: [{ name: "Vendas B2B", color: BLUE, stages: [
      tri("Entrada", BLUE, 10), s("Qualificação", VIOLET, 30), s("Proposta", CYAN, 50),
      s("Negociação", AMBER, 70), won("Fechado ganho"), lost("Perdido"),
    ] }],
  },
  {
    id: "pre-vendas", name: "Pré-vendas (SDR)", segment: "vendas",
    description: "Prospecção e qualificação antes de passar pro time de vendas.",
    funnels: [{ name: "Pré-vendas", color: VIOLET, stages: [
      tri("Novo lead", BLUE, 5), s("Contato inicial", VIOLET, 20), s("Reunião agendada", CYAN, 50),
      won("Qualificado"), lost("Sem interesse"),
    ] }],
  },

  // ── Atendimento ──
  {
    id: "suporte", name: "Suporte / Atendimento", segment: "atendimento", badge: "Essencial",
    description: "Fluxo de atendimento por status — sem funil de venda.",
    funnels: [{ name: "Suporte", color: CYAN, stages: [
      tri("Triagem", SLATE), s("Em atendimento", BLUE, 0), s("Aguardando cliente", AMBER, 0), s("Resolvido", GREEN, 0),
    ] }],
  },

  // ── Estética (kit) ──
  {
    id: "estetica-kit", name: "Clínica de estética", segment: "estetica", badge: "Kit",
    description: "Aquisição de novos clientes + retorno para novos procedimentos.",
    funnels: [
      { name: "Estética — Novos clientes", color: PINK, stages: [
        tri("Novo contato", BLUE, 10), s("Avaliação agendada", VIOLET, 30), s("Avaliação feita", CYAN, 50),
        s("Procedimento agendado", AMBER, 75), won("Cliente ativo"), lost("Não compareceu"),
      ] },
      { name: "Estética — Retorno", color: ORANGE, stages: [
        tri("Retornou", PINK, 20), s("Interesse confirmado", CYAN, 50), s("Agendado", AMBER, 75), won("Concluído"),
      ] },
    ],
  },

  // ── Odontologia (kit) ──
  {
    id: "odonto-kit", name: "Clínica odontológica", segment: "odontologia", badge: "Kit",
    description: "Captação de pacientes + recall/manutenção dos pacientes da casa.",
    funnels: [
      { name: "Odontologia — Novos pacientes", color: CYAN, stages: [
        tri("Novo paciente", BLUE, 10), s("Avaliação", VIOLET, 30), s("Orçamento", CYAN, 50),
        s("Tratamento aprovado", AMBER, 75), s("Em tratamento", ORANGE, 90), won("Concluído"), lost("Desistiu"),
      ] },
      { name: "Odontologia — Retorno", color: PINK, stages: [
        tri("Recall", PINK, 20), s("Contatado", CYAN, 50), s("Agendado", AMBER, 75), won("Concluído"),
      ] },
    ],
  },

  // ── Saúde ──
  {
    id: "saude-clinica", name: "Clínica / Saúde", segment: "saude",
    description: "Jornada do paciente, do primeiro contato à alta.",
    funnels: [{ name: "Clínica", color: GREEN, stages: [
      tri("Novo paciente", BLUE, 10), s("Agendado", CYAN, 40), s("Em atendimento", AMBER, 70),
      s("Retorno", VIOLET, 85), won("Alta"),
    ] }],
  },

  // ── Móveis planejados (kit) ──
  {
    id: "moveis-kit", name: "Móveis planejados", segment: "moveis", badge: "Kit",
    description: "Vendas + produção/entrega + assistência — a operação inteira.",
    funnels: [
      { name: "Móveis — Vendas", color: AMBER, stages: [
        tri("Lead", BLUE, 10), s("Medição / Briefing", VIOLET, 30), s("Projeto", CYAN, 50),
        s("Proposta", AMBER, 70), s("Negociação", ORANGE, 85), won("Fechado"), lost("Perdido"),
      ] },
      { name: "Móveis — Produção / Entrega", color: ORANGE, stages: [
        tri("Pedido", BLUE, 0), s("Em produção", AMBER, 0), s("Pronto", CYAN, 0),
        s("Entrega agendada", VIOLET, 0), won("Entregue"),
      ] },
      { name: "Móveis — Assistência", color: SLATE, stages: [
        tri("Aberto", SLATE), s("Em análise", BLUE, 0), s("Em reparo", AMBER, 0), s("Resolvido", GREEN, 0),
      ] },
    ],
  },

  // ── Imobiliária ──
  {
    id: "imobiliaria", name: "Imobiliária", segment: "imobiliaria",
    description: "Captação à escritura, com visita e documentação.",
    funnels: [{ name: "Imobiliária", color: GREEN, stages: [
      tri("Lead", BLUE, 10), s("Visita", VIOLET, 35), s("Proposta", CYAN, 60),
      s("Documentação", AMBER, 85), won("Fechado"), lost("Perdido"),
    ] }],
  },

  // ── Escolar (kit) ──
  {
    id: "escolar-kit", name: "Instituição de ensino", segment: "escolar", badge: "Kit",
    description: "Matrículas novas + rematrícula da casa + secretaria.",
    funnels: [
      { name: "Escolar — Matrículas", color: BLUE, stages: [
        tri("Interesse", BLUE, 10), s("Tour agendado", VIOLET, 35), s("Visita feita", CYAN, 55),
        s("Proposta / Bolsa", AMBER, 75), won("Matrícula"), lost("Desistiu"),
      ] },
      { name: "Escolar — Rematrícula", color: PINK, stages: [
        tri("Aberta", PINK, 20), s("Contatado", CYAN, 50), s("Documentação", AMBER, 80),
        won("Rematriculado"), lost("Não renovou"),
      ] },
      { name: "Escolar — Secretaria", color: SLATE, stages: [
        tri("Triagem", SLATE), s("Em atendimento", BLUE, 0), s("Resolvido", GREEN, 0),
      ] },
    ],
  },
]

export const getBlueprint = (id: string) => FUNNEL_TEMPLATES.find((b) => b.id === id)
