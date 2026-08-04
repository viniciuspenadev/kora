"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Search, User, Users, Gauge, CreditCard, Headset, Tag as TagIcon, IdCard, Building2,
  ListChecks, MessageSquare, SlidersHorizontal, FileText, ClipboardList, Mail, Plug,
  ExternalLink,
} from "lucide-react"

/**
 * Coluna de navegação das Configurações (2ª coluna, padrão de "área com muitas telas").
 *
 * 🔴 POR QUE ELA EXISTE. Antes os ~15 itens de configuração viviam num ACORDEÃO dentro da
 *    sidebar principal: abriam empilhados e minúsculos, e sumiam assim que você entrava
 *    numa das telas — então não dava pra pular de "Tags" pra "Equipe" sem voltar ao menu.
 *    Aqui ela FICA: entrou em Configurações, o índice inteiro está do lado, com busca.
 *
 * ⚠️ ESTA COLUNA É ESPELHO, NÃO TRAVA. Cada página de configuração já recusa quem não
 *    pode entrar (sessão/role/módulo, server-side). O gate por módulo abaixo existe pra
 *    não OFERECER porta que vai bater na cara — nunca pra ser a única defesa.
 */

interface Item {
  href:   string
  label:  string
  icon:   React.ComponentType<{ className?: string }>
  /** Só aparece com este módulo habilitado. */
  module?: string
  /** Vive FORA de /configuracoes — a coluna some ao navegar (ver grupo "Ver também"). */
  away?:  boolean
}

const GROUPS: { key: string; label: string; items: Item[] }[] = [
  { key: "conta", label: "Conta", items: [
    { href: "/configuracoes/perfil",    label: "Perfil",         icon: User },
    { href: "/configuracoes/equipe",    label: "Organização",    icon: Users },
    // ⚠️ Sem gate de módulo, e é de propósito: é o cadastro fiscal do próprio cliente —
    //    de onde saem CNPJ, endereço e e-mail de faturamento. Esconder atrás de add-on
    //    seria esconder a tela que destrava a assinatura. O recorte é de PAPEL
    //    (owner/admin) e mora na página, que devolve `null` e redireciona pra quem não pode.
    { href: "/configuracoes/empresa",   label: "Dados da empresa", icon: Building2 },
    { href: "/configuracoes/uso",       label: "Uso e limites",  icon: Gauge },
    // ✅ SUBSTITUÍDO em 2026-08-03. Este item apontava pra `/configuracoes/cobranca`, uma
    //    rota que **nunca existiu** — 404 esperando acontecer. Passou despercebido porque
    //    era gateado por `billing_panel`, módulo que não está ligado em nenhum cliente.
    // 🔴 E o gate de módulo saiu de propósito: a própria assinatura não é add-on vendável.
    //    Gatear por `billing_panel` esconderia de TODO MUNDO a tela onde o cliente vê o
    //    que deve e como paga — que é justamente a tela que não pode faltar (a escada
    //    manda o inadimplente pra cá).
    // ⚠️ O recorte que falta aqui é de PAPEL, não de módulo: valor de fatura é assunto de
    //    owner/admin, não do atendente (mesma regra do C6 em components/billing). O nav
    //    ainda não tem gate por papel — a página faz o seu próprio.
    // ⏳ OCULTO ATÉ O DADO SER REAL. As telas existem e sobem no deploy, mas ainda
    //    renderizam `buildMock()` — cliente abrindo isto leria valor de fatura inventado.
    //    Estão travadas por platform admin em `assinatura/layout.tsx` (mesmo TODO lá).
    //    Reativar esta linha e apagar aquele layout NO MESMO COMMIT em que o
    //    `getBillingStanding()` + as queries reais entrarem.
    // { href: "/configuracoes/assinatura", label: "Assinatura",    icon: CreditCard },
  ] },
  // ⚠️ Canais (WhatsApp) e Chat do site NÃO entram aqui: CANAL se conecta e se gerencia
  //    em /integracoes, que é onde estão os cards com status, número e sinal de vida.
  //    As rotas continuam existindo (os cards de Integrações apontam pra elas) — o que
  //    saiu foi a SEGUNDA porta, porque duas portas pro mesmo lugar é como um lado
  //    envelhece sem ninguém notar.
  { key: "atendimento", label: "Atendimento", items: [
    { href: "/configuracoes/atendimento", label: "Regras de atendimento", icon: Headset },
    { href: "/configuracoes/tags",        label: "Tags",                icon: TagIcon },
    { href: "/configuracoes/cadastro",    label: "Campos do cadastro",  icon: IdCard },
    { href: "/configuracoes/listas",      label: "Listas",              icon: ListChecks },
    { href: "/configuracoes/respostas",   label: "Respostas rápidas",   icon: MessageSquare, module: "quick_replies" },
  ] },
  { key: "vendas", label: "Vendas", items: [
    { href: "/configuracoes/cotacao", label: "Cotação e Contrato", icon: FileText,      module: "crm" },
    { href: "/configuracoes/motivos", label: "Motivos de perda",   icon: ClipboardList, module: "crm" },
  ] },
  { key: "sistema", label: "Sistema", items: [
    { href: "/configuracoes/relatorios", label: "Relatórios automáticos", icon: Mail },
  ] },
  // Áreas próprias, não telas de configuração: entram no índice pra continuarem
  // encontráveis (é onde a pessoa procura), mas separadas — clicar SAI daqui, e a
  // seta avisa isso antes do clique em vez de depois.
  { key: "away", label: "Ver também", items: [
    { href: "/integracoes",    label: "Integrações",  icon: Plug,              away: true },
    { href: "/negocios/funis", label: "Funis de venda", icon: SlidersHorizontal, away: true, module: "crm" },
    { href: "/templates",      label: "Templates",    icon: FileText,          away: true },
  ] },
]

export function SettingsNav({ modules }: { modules: string[] }) {
  const pathname = usePathname()
  const [q, setQ] = useState("")
  const modSet = useMemo(() => new Set(modules), [modules])

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase()
    return GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((i) =>
          (!i.module || modSet.has(i.module)) &&
          (!term || i.label.toLowerCase().includes(term))),
      }))
      .filter((g) => g.items.length > 0)
  }, [q, modSet])

  return (
    <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white">
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar"
            aria-label="Pesquisar configuração"
            className="w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-200" />
        </div>
      </div>

      <nav className="px-2 pb-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto scrollbar-none">
        {groups.length === 0 && (
          <p className="px-3 py-6 text-xs text-slate-400 text-center">Nada encontrado.</p>
        )}
        {groups.map((g) => (
          <div key={g.key} className="mb-3">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
            {g.items.map((i) => {
              const Icon = i.icon
              // `startsWith` e não igualdade: /configuracoes/equipe/[userId] e
              // /equipe/departamentos precisam manter "Organização" acesa.
              const active = !i.away && (pathname === i.href || pathname.startsWith(`${i.href}/`))
              return (
                <Link key={i.href} href={i.href}
                  className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                    active
                      ? "bg-primary/10 text-primary-700 font-semibold"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                  <Icon className={`size-4 shrink-0 ${active ? "text-primary-600" : "text-slate-400"}`} />
                  <span className="flex-1 truncate">{i.label}</span>
                  {i.away && <ExternalLink className="size-3 text-slate-300 shrink-0" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
