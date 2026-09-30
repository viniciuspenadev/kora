// ═══════════════════════════════════════════════════════════════
// Política de privacidade — template editável por tenant
// ═══════════════════════════════════════════════════════════════
// Markdown PT-BR LGPD-aware, gerado server-side com os dados do tenant.
// Tenant copia, personaliza nos pontos [EDITAR] e publica no próprio site.
//
// Cobertura legal (mínima pra LGPD):
//  Art. 6 — Princípios
//  Art. 7-11 — Hipóteses de tratamento + consentimento
//  Art. 9 — Acesso facilitado à info
//  Art. 18 — Direitos do titular
//  Art. 41 — Encarregado (DPO)
//  Art. 46 — Medidas de segurança
//
// IMPORTANTE: este é um TEMPLATE, não substitui consultoria jurídica.
// Tenant DEVE revisar antes de publicar. O texto contém marcadores [EDITAR]
// nos pontos onde precisa intervenção humana.

export interface PolicyContext {
  tenantName:    string                  // Razão social ou nome fantasia
  dpoEmail?:     string | null           // Email do DPO (de site_widget_config)
  websiteUrl?:   string | null           // URL principal do site (opcional)
  collectedData?: string[]               // Lista de dados coletados (deriva das questions do widget)
}

export function generatePolicyMarkdown(ctx: PolicyContext): string {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
  const dataItems = ctx.collectedData?.length
    ? ctx.collectedData.map((d) => `- ${d}`).join("\n")
    : "- Nome\n- Telefone (WhatsApp)\n- Email (quando informado)\n- Mensagens trocadas pelo WhatsApp\n- Páginas do site que você visitou (anonimizado por cookies)"

  return `# Política de Privacidade — ${ctx.tenantName}

_Última atualização: ${today}_

Esta Política de Privacidade descreve como **${ctx.tenantName}** coleta, usa, armazena
e protege seus dados pessoais, em conformidade com a Lei Geral de Proteção de Dados
Pessoais (LGPD — Lei nº 13.709/2018) do Brasil.

---

## 1. Quem somos

**${ctx.tenantName}**${ctx.websiteUrl ? ` — site oficial: ${ctx.websiteUrl}` : ""}.

[EDITAR: incluir razão social completa, CNPJ e endereço da sede aqui.]

## 2. Quais dados coletamos

Coletamos apenas os dados necessários pra prestar nosso atendimento e melhorar nossa relação com você:

${dataItems}

[EDITAR: adicione/remova itens conforme o que sua empresa realmente coleta.]

## 3. Por que coletamos seus dados (finalidades)

Tratamos seus dados pessoais para:

- Responder seu contato pelo WhatsApp ou outros canais
- Executar contratos ou pedidos de serviço solicitados por você
- Cumprir obrigações legais e regulatórias
- Melhorar nossos serviços por meio de análise estatística (dados anonimizados)
- Enviar comunicações que você expressamente autorizou

**Não usamos seus dados** para fins não declarados nesta política. Não vendemos
dados pessoais a terceiros.

## 4. Base legal do tratamento

Conforme a LGPD (Art. 7º), tratamos seus dados com base em:

- **Consentimento** (Art. 7º, I): você concorda explicitamente ao preencher nossos formulários
- **Execução de contrato** (Art. 7º, V): quando o atendimento envolve negociação ou serviço
- **Cumprimento de obrigação legal** (Art. 7º, II): obrigações fiscais e regulatórias
- **Legítimo interesse** (Art. 7º, IX): operação básica do atendimento, com mitigação de riscos pra você

## 5. Com quem compartilhamos seus dados

Seus dados podem ser compartilhados apenas com:

- **WhatsApp / Meta** — pra envio/recebimento de mensagens
- **Provedores de infraestrutura** (Supabase, Easypanel) — pra hospedar a plataforma
- **Autoridades públicas** — somente quando legalmente obrigados (ordem judicial, fiscalização)

[EDITAR: liste outros fornecedores se houver, como CRM externo, ERP, etc.]

## 6. Por quanto tempo guardamos seus dados

Mantemos seus dados pelo tempo necessário ao atendimento e cumprimento de obrigações legais:

- **Conversas e mensagens**: até 5 anos após o último contato (prazo prescricional comercial)
- **Dados cadastrais (nome, telefone)**: até você solicitar exclusão ou enquanto necessário
- **Logs técnicos de acesso**: 6 meses

Após esses prazos, os dados são anonimizados ou excluídos.

## 7. Seus direitos como titular dos dados

Conforme o Art. 18 da LGPD, você tem direito a:

1. **Confirmação** da existência de tratamento dos seus dados
2. **Acesso** aos dados que temos sobre você
3. **Correção** de dados incompletos ou desatualizados
4. **Anonimização ou eliminação** de dados desnecessários ou em desconformidade
5. **Portabilidade** dos dados pra outro fornecedor (quando aplicável)
6. **Revogação do consentimento** a qualquer momento
7. **Informação** sobre com quem compartilhamos seus dados

Pra exercer qualquer direito, contate nosso Encarregado de Dados (DPO) na seção 10.

## 8. Cookies e tecnologias similares

Nosso site/widget pode usar cookies e armazenamento local pra:

- Identificar visitas recorrentes (anonimizado)
- Registrar UTM de campanhas
- Garantir o funcionamento do chat

Você pode desativar cookies nas configurações do seu navegador.

## 9. Medidas de segurança

Adotamos medidas técnicas e administrativas pra proteger seus dados (Art. 46 LGPD):

- Criptografia em trânsito (HTTPS/TLS)
- Controle de acesso por autenticação multifator (quando aplicável)
- Isolamento por organização (multi-tenant com Row Level Security)
- Registro de operações sensíveis (audit log)
- Limitação de acesso a colaboradores autorizados
- Backup periódico com restauração testada

## 10. Encarregado pela proteção de dados (DPO)

Em conformidade com o Art. 41 da LGPD, designamos um Encarregado pelo Tratamento
de Dados Pessoais (DPO):

${ctx.dpoEmail
  ? `**Contato:** ${ctx.dpoEmail}`
  : `**[EDITAR: incluir nome, email e telefone do DPO]**`}

Você pode entrar em contato pra:
- Esclarecer dúvidas sobre o tratamento dos seus dados
- Exercer qualquer dos direitos listados na seção 7
- Reportar incidentes ou violações

## 11. Alterações nesta política

Esta política pode ser atualizada periodicamente. Mudanças relevantes serão
comunicadas via WhatsApp ou no nosso site. Recomendamos revisar periodicamente.

## 12. Foro

[EDITAR: incluir cidade/estado de jurisdição em caso de disputa.]

---

_Este documento foi gerado por **${ctx.tenantName}** em conformidade com a LGPD
e revisado em ${today}. Em caso de dúvida sobre o conteúdo, consulte um advogado
especializado em proteção de dados._
`
}
