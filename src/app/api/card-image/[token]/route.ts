import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { decodeCardImageToken } from "@/lib/storage/card-image-token"

/**
 * GET /api/card-image/[token]
 *
 * Serve a imagem de um cartão (generic template) a partir do bucket **PRIVADO**.
 *
 * 🔴 **ESTA ROTA NÃO PEDE SESSÃO — e é de propósito.** Quem busca a imagem é o servidor da
 *    **Meta**, na hora de renderizar o card no aparelho de quem recebeu. Ele não tem cookie,
 *    token nem login nosso. Exigir sessão aqui = card sem imagem, sempre.
 *
 *    O que substitui a sessão (decisão do dono, 2026-08-01 — bucket público foi VETADO):
 *      • **token opaco e cifrado** (`lib/storage/card-image-token.ts`): não revela tenant,
 *        caminho nem nada; adulterou um byte, a tag do GCM derruba;
 *      • **nada de enumeração**: sem id sequencial, sem listagem, sem caminho previsível;
 *      • **bucket segue privado**: o Supabase não aparece na URL e não há URL assinada
 *        circulando;
 *      • **revogação real**: apagar o arquivo tira a imagem inclusive dos cards já enviados
 *        (medido em 2026-08-01 — a Meta re-busca, não guarda cópia).
 *
 *    ⚠️ O limite honesto: quem tiver o link exato vê a imagem. Isso é inerente ao canal —
 *    nenhum provedor entrega imagem de card com autenticação. O que se ganha sobre bucket
 *    público não é sigilo, é **controle**: opacidade, revogação, registro e teto de banda.
 *
 * 🔴 **O token NÃO expira.** URL com prazo faz o card **perder a imagem em silêncio** —
 *    o Instagram adapta o card e não mostra quebrado, então o cliente nunca perceberia
 *    (medido; ver `docs/message-composer-design.md` §7). Falha silenciosa é pior que falha.
 *
 * ⚠️ Cache agressivo é parte do desenho: a Meta busca a CADA renderização. Sem cache, a
 *    conta de banda cresce com a audiência do cliente, não com o uso do produto.
 */
export const runtime = "nodejs"

const BUCKET = "chat-attachments"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const path = decodeCardImageToken(token)
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(path)
  // 404 (nunca 500/403): arquivo apagado é o caminho ESPERADO da revogação, não um erro.
  // E responder diferente pra "não existe" × "existe mas..." entregaria informação de graça.
  if (error || !blob) return new NextResponse("Not found", { status: 404 })

  return new NextResponse(blob, {
    headers: {
      "Content-Type":   blob.type?.startsWith("image/") ? blob.type : "image/jpeg",
      "Content-Length": String(blob.size),
      // `public`: quem busca é a Meta, não um browser logado — `private` impediria o cache
      // dela e devolveria todo o tráfego pra cá.
      "Cache-Control":  "public, max-age=86400, s-maxage=604800, immutable",
      // A imagem é conteúdo que o CLIENTE subiu: nunca deixar o browser adivinhar o tipo,
      // e nunca deixar ser embutida como documento.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition":    "inline",
    },
  })
}
