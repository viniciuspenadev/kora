import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { CANAL_DO_MODULO } from "@/lib/modules-shared"
import { LIMIT_META } from "@/lib/limits-shared"

// ═══════════════════════════════════════════════════════════════
// Vitrine de planos — o que o CLIENTE pode contratar
// ═══════════════════════════════════════════════════════════════
// 🔑 A FONTE É O GOD MODE, sempre. Nada aqui é hardcoded: nome, preço, cota e o que está
//    incluso saem da tabela `plans`. Ligou um plano novo lá, ele aparece aqui no próximo
//    carregamento; desligou, some. Essa é a única regra deste arquivo.
//
// 🔴 POR QUE ISTO EXISTE. O modal "Quero caber no plano" sugeria um **"Enterprise
//    R$ 599,00" inteiramente inventado** — nome, preço e quatro recursos escritos à mão
//    num `TODO(dev)` que foi pro ar, sem uma única consulta ao catálogo. O plano nem
//    existia na base. Numa tela de dinheiro, um número inventado não é rascunho: o cliente
//    que leu "R$ 599,00 com 15 usuários" tem razão de cobrar isso depois.

export interface PlanoVitrine {
  id:                 string
  nome:               string
  descricao:          string | null
  precoCents:         number
  usuariosInclusos:   number
  extraUsuarioCents:  number
  /**
   * **TODOS** os recursos da comparação — os que o plano tem (✓) e os que não tem (✗).
   *
   * 🔑 Decisão do dono (2026-08-05): listar só o incluído faz cada card parecer completo
   *    e **esconde a comparação**, que é a única pergunta de quem está escolhendo plano.
   *    Com a lista inteira nos dois lados, a diferença salta — e ela é o argumento.
   *
   * ⚠️ Mesma ORDEM e mesmo TAMANHO em todos os planos, de propósito: é o que deixa os
   *    cards alinhados linha a linha. Lista de tamanhos diferentes vira "ache o que mudou".
   *
   * ⚠️ `pro` só é verdadeiro onde o plano REALMENTE entrega o recurso como PRO. O banco
   *    garante a coerência: `plans_pro_subset_included` recusa marcar como PRO algo fora
   *    de `included_modules` (testado ao vivo — a constraint disparou).
   */
  itens:              {
    label: string; incluso: boolean; pro: boolean; categoria: string
    canal: "whatsapp" | "instagram" | null
    /**
     * Quantidade do recurso, no fim da própria linha. `null` = sem limite associado.
     *
     * 🔴 Era um BLOCO separado de 8 linhas (correção do dono, 2026-08-05). O bloco
     *    obrigava a pessoa a casar "Automações: 5" lá em cima com "Kora Studio ✓" lá
     *    embaixo — duas leituras pra uma informação só, e uma altura enorme no card.
     *    Na linha, o "se tem" e o "quanto tem" chegam juntos.
     * ⚠️ Só aparece em item INCLUÍDO: quantidade em item riscado seria anunciar a cota
     *    de algo que a pessoa não leva.
     */
    quantidade: string | null
  }[]
  /** Canais que o plano cobre — pro selo no topo do card. */
  canais:             ("whatsapp" | "instagram")[]
  /** Limites SEM módulo dono (storage, mensagens) — rodapé discreto do card. */
  limitesGerais:      { label: string; valor: string }[]
  /** É o plano que o tenant tem hoje? */
  atual:              boolean
}

/**
 * Planos que o cliente pode contratar.
 *
 * ⚠️ **Preço > 0** é o filtro que separa "vitrine" de "catálogo". O Trial é um plano ativo
 *    e legítimo, mas não é algo que se compra — é o que a pessoa está deixando. Listá-lo
 *    como opção seria oferecer "continuar de graça" na tela cuja pergunta é justamente
 *    como voltar a ter produto.
 *    Isso deriva a resposta em vez de exigir uma coluna nova de "aparece pro cliente":
 *    um plano sem preço não tem como ser comprado, então a regra já está no dado.
 *
 * ⚠️ Ordem = `position`, a MESMA do god mode. A tela do cliente não reordena por preço
 *    nem por opinião: quem decide a ordem de leitura é quem montou o catálogo.
 */
export async function listPlansForClient(tenantId: string): Promise<PlanoVitrine[]> {
  const [{ data: planos, error }, { data: tenant }, { data: catalogo }] = await Promise.all([
    supabaseAdmin
      .from("plans")
      .select("id, name, description, price_cents, user_quota, extra_user_price_cents, included_modules, pro_modules, limits")
      .eq("active", true)
      .gt("price_cents", 0)
      .order("position", { ascending: true }),
    supabaseAdmin.from("tenants").select("plan_id").eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("module_catalog").select("slug, name, position, category, is_core"),
  ])

  if (error) {
    // Fail-closed com log: melhor a tela dizer "fale com a gente" do que inventar oferta.
    console.error("[plans-view] catálogo indisponível:", error.message)
    return []
  }

  const cat = (catalogo ?? []) as { slug: string; name: string; position: number; category: string; is_core: boolean }[]
  const nomeDoModulo = new Map(cat.map((m) => [m.slug, m.name]))
  const ordemDoModulo = new Map(cat.map((m) => [m.slug, m.position ?? 999]))
  const catDoModulo = new Map(cat.map((m) => [m.slug, m.category ?? "operational"]))
  // Ordem de leitura dos GRUPOS — canal primeiro (é por onde o cliente fala com o mundo),
  // depois o que ele faz com isso. ⚠️ Categoria fora da lista cai no fim, nunca some.
  // ⚠️ `core` PRIMEIRO (decisão do dono, 2026-08-05). Eu tinha posto por último com o
  //    argumento de "diferencial em cima, base embaixo" — o dono corrigiu, e faz sentido:
  //    o Essencial é o que a pessoa espera encontrar ANTES de avaliar o resto ("tem inbox?
  //    tem contatos?"). Enterrado no fim, ele lê como sobra; no topo, lê como fundação.
  // ⚠️ Categoria fora desta lista cai no fim, nunca some.
  const ordemDaCategoria = ["core", "multichannel", "atendimento", "studio", "campanhas", "agenda", "crm", "operational", "billing", "deprecated"]
  const pesoCat = (c: string) => { const i = ordemDaCategoria.indexOf(c); return i < 0 ? 900 : i }
  const planoAtual = (tenant as { plan_id?: string | null } | null)?.plan_id ?? null

  /**
   * Formata um limite pro cliente ler.
   *
   * ⚠️ `null` = ILIMITADO, não "vazio". É o vocabulário de `limits.ts` (lá `null` significa
   *    sem teto), e traduzir errado aqui faria o plano mais generoso parecer o mais pobre.
   * ⚠️ `0` é informação, não ausência: dizer "0 números" é o que explica por que o
   *    WhatsApp aparece com ✗ na lista de recursos.
   */
  const formatarLimite = (chave: string, v: number | null): { valor: string; zero: boolean } => {
    if (v === null || v === undefined) return { valor: "Ilimitado", zero: false }
    if (chave === "storage_mb") {
      return v >= 1000
        ? { valor: `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`, zero: v === 0 }
        : { valor: `${v} MB`, zero: v === 0 }
    }
    return { valor: v.toLocaleString("pt-BR"), zero: v === 0 }
  }

  /**
   * Qual limite pertence a qual módulo — pra a quantidade sair NO FIM DA LINHA do recurso.
   *
   * ⚠️ UM limite por módulo, de propósito: dois números na mesma linha ("Ilimitado · 1 GB")
   *    exigem decodificação, e a linha existe justamente pra ser lida de relance.
   * ⚠️ `storage_mb` e `messages_per_month` não têm módulo dono — são cotas da conta
   *    inteira, não de um recurso. Vão pro rodapé do card (`limitesGerais`) em vez de
   *    forçar barra num módulo que não é deles.
   */
  const LIMITE_DO_MODULO: Record<string, string> = {
    // ⚠️ `inbox` NÃO entra (dono, 2026-08-05): a linha lia "Inbox — Ilimitado", e inbox
    //    não é coisa que se conta. Quantidade só informa onde o recurso É contável —
    //    números, contatos, fluxos, execuções. Onde não é, o número vira ruído e ensina a
    //    pessoa a ignorar a coluna toda.
    contacts:             "contacts",
    multi_instance:       "whatsapp_qr",
    whatsapp_official:    "whatsapp_official",
    ai_studio:            "automations",
    instagram_automation: "instagram_automations_per_month",
  }
  /** Cotas da conta, sem módulo dono. */
  const LIMITES_GERAIS = ["storage_mb", "messages_per_month"]

  const lista = (planos ?? []) as Array<{
    id: string; name: string; description: string | null; price_cents: number
    user_quota: number | null; extra_user_price_cents: number | null
    included_modules: string[] | null; pro_modules: string[] | null
    limits: Record<string, number | null> | null
  }>

  // ⚠️ O universo da comparação é a UNIÃO do que os planos oferecem — não o catálogo
  //    inteiro. Módulo que nenhum plano vende não ajuda a escolher: seria uma linha com ✗
  //    em todos os cards, ocupando espaço pra informar nada.
  // 🔑 MÓDULOS CORE ENTRAM SEMPRE (Inbox, Contatos, Tags, Equipe) — pedido do dono,
  //    2026-08-05. Eles não estão em `included_modules` de plano nenhum porque não são
  //    vendáveis: vêm ligados em toda conta. Só que um card que não menciona o Inbox
  //    **parece não incluir o Inbox** — o cliente compara o que lê, não o que a gente sabe.
  // ⚠️ Aparecem com ✓ em TODOS os planos, sempre: é a verdade, e é o que os torna base.
  const slugsCore = cat.filter((m) => m.is_core).map((m) => m.slug)

  const universo = [...new Set([...lista.flatMap((p) => p.included_modules ?? []), ...slugsCore])]
    .sort((a, b) => {
      // Agrupado por CATEGORIA e, dentro dela, pela `position` do god mode. É isso que
      // põe "Automação do Instagram" logo abaixo do "Kora Studio" (mesma categoria
      // `studio`, positions 10 e 30) em vez de espalhado entre canais e agenda.
      const dc = pesoCat(catDoModulo.get(a) ?? "") - pesoCat(catDoModulo.get(b) ?? "")
      if (dc !== 0) return dc
      return (ordemDoModulo.get(a) ?? 999) - (ordemDoModulo.get(b) ?? 999)
    })

  return lista.map((p) => {
    const inclui = new Set(p.included_modules ?? [])
    const pro    = new Set(p.pro_modules ?? [])
    const core   = new Set(slugsCore)
    return {
      id:                p.id,
      nome:              p.name,
      descricao:         p.description,
      precoCents:        p.price_cents,
      usuariosInclusos:  p.user_quota ?? 1,
      extraUsuarioCents: p.extra_user_price_cents ?? 0,
      // ⚠️ Slug sem nome no catálogo aparece como o próprio slug, e é de propósito: sumir
      //    faria o plano parecer entregar MENOS do que entrega. Slug feio na tela é bug
      //    visível (alguém conserta); item ausente é bug invisível (ninguém percebe).
      itens: universo.map((slug) => ({
        label:     nomeDoModulo.get(slug) ?? slug,
        // Core é sempre incluído — não depende do plano, por definição.
        incluso:   inclui.has(slug) || core.has(slug),
        pro:       pro.has(slug),
        categoria: catDoModulo.get(slug) ?? "operational",
        // Logo do canal ao lado do nome — quem depende de WhatsApp/Instagram diz isso na
        // linha, e não só no selo do topo (que fala do plano, não do recurso).
        canal:     CANAL_DO_MODULO[slug] ?? null,
        quantidade: (() => {
          // Só em item incluído — ver a doc de `quantidade` no tipo.
          if (!(inclui.has(slug) || core.has(slug))) return null
          const chave = LIMITE_DO_MODULO[slug]
          if (!chave) return null
          return formatarLimite(chave, (p.limits ?? {})[chave] ?? null).valor
        })(),
      })),
      // ⚠️ Só dos módulos que o plano REALMENTE inclui — o selo diz "este plano fala com
      //    este canal", não "este canal existe no produto".
      limitesGerais: LIMITES_GERAIS.map((k) => ({
        label: LIMIT_META[k as keyof typeof LIMIT_META].label,
        valor: formatarLimite(k, (p.limits ?? {})[k] ?? null).valor,
      })),
      canais: [...new Set(
        (p.included_modules ?? []).map((m) => CANAL_DO_MODULO[m]).filter(Boolean),
      )] as ("whatsapp" | "instagram")[],
      atual:             p.id === planoAtual,
    }
  })
}
