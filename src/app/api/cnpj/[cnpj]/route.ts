import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { rateLimit } from "@/lib/rate-limit"
import { fetchCnpjFromReceita } from "@/lib/cnpj-server"

export type { CnpjData, CnpjSocio } from "@/lib/cnpj-types"

/**
 * GET /api/cnpj/[cnpj]  — perfil da empresa por CNPJ, PELO SERVIDOR (BrasilAPI/Receita).
 *
 * ⚠️ ESTA ROTA É CASCA. A busca e o mapeamento moram em [lib/cnpj-server.ts] desde
 *    2026-08-04 — porque o CADASTRO também precisa consultar, e ele roda antes de existir
 *    sessão. Abrir esta rota pro público faria do Kora um proxy grátis de consulta
 *    cadastral (o bloqueio da BrasilAPI cairia no nosso IP); copiar o mapeamento pro
 *    signup criaria o segundo motor. O motor é um só; o que muda é quem pode chamá-lo.
 *
 * Aqui ficam as três coisas que são DA ROTA: quem pode (sessão), quanto pode
 * (rate-limit por tenant) e como o erro aparece pro browser (status HTTP).
 *
 * Consumidores: autofill de formulários + modal de consulta + dossiê. Traz tudo que a
 * BrasilAPI expõe de NEGÓCIO, incluindo QSA/sócios (VIEW-ONLY — CPF já mascarado pela
 * Receita; NUNCA persistir).
 *
 * NÃO existe equivalente pra CPF (dado pessoal protegido — não se consulta).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ cnpj: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }

  // 🔴 TETO POR TENANT. A rota exige sessão, mas conta de teste é grátis e sai em 2
  //    minutos — sem limite, isto é um raspador de CNPJ com login, e quem leva o bloqueio
  //    da BrasilAPI é o NOSSO IP (derrubando o autofill de todos os clientes junto).
  //    60/hora é muito acima do uso humano (um cadastro consulta 1 vez) e muito abaixo
  //    do que serve pra raspar.
  if (!rateLimit(`cnpj:${session.user.tenantId}`, 60, 60 * 60_000).ok) {
    return NextResponse.json({ error: "Muitas consultas. Tente de novo em alguns minutos." }, { status: 429 })
  }

  const r = await fetchCnpjFromReceita((await params).cnpj)

  if (!r.ok) {
    const { status, error } =
      r.motivo === "invalido"       ? { status: 400, error: "CNPJ inválido" }
      : r.motivo === "nao_encontrado" ? { status: 404, error: "CNPJ não encontrado" }
      : { status: 502, error: "Serviço de CNPJ indisponível" }
    return NextResponse.json({ error }, { status })
  }

  return NextResponse.json(r.data, { headers: { "Cache-Control": "private, max-age=3600" } })
}
