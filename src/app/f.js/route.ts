import { NextRequest, NextResponse } from "next/server"
import { EMBED_MESSAGE, EMBED_SUBMITTED_EVENT } from "@/lib/forms/embed"

/**
 * GET /f.js — carregador do formulário no site do cliente (docs/forms-design.md §4.2 · Fase 2b).
 *
 *   <div data-kora-form="PUBLIC_ID">…o que mostrar se o formulário não abrir…</div>
 *   <script src="https://<kora>/f.js" async></script>
 *
 * Cria a moldura (/embed/<id>?page=<esta página>), ajusta a altura pelo que a moldura informa
 * e repassa "pedido enviado" como o evento `kora:form-submitted` no próprio elemento. Só aceita
 * mensagem da origem do Kora E da janela da moldura. O conteúdo de dentro do elemento fica à
 * vista até a moldura provar que abriu (1ª altura); se não abrir em 10 s (site não autorizado,
 * sem internet), a moldura sai e esse conteúdo continua — a página nunca mostra caixa quebrada.
 * Vanilla JS, sem dependências.
 */
export async function GET(req: NextRequest) {
  // Produção: o endereço público (atrás do proxy da hospedagem, req.url é o interno).
  const base = process.env.NODE_ENV === "production"
    ? (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
    : new URL(req.url).origin
  return new NextResponse(loaderJs(base), {
    status: 200,
    headers: {
      "Content-Type":  "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

function loaderJs(base: string): string {
  return `/* Kora Formulários */
(function () {
  var BASE = ${JSON.stringify(base)};
  var KIND = ${JSON.stringify(EMBED_MESSAGE)};
  var SENT = ${JSON.stringify(EMBED_SUBMITTED_EVENT)};
  function mount(el) {
    if (el.__koraForm) return;
    el.__koraForm = true;
    var id = String(el.getAttribute("data-kora-form") || "").trim().toLowerCase();
    if (!/^[a-z0-9]{20}$/.test(id)) { console.warn("Kora: código do formulário inválido em data-kora-form."); return; }
    var page = String(location.href).split("#")[0].slice(0, 1500);
    var f = document.createElement("iframe");
    f.src = BASE + "/embed/" + id + "?page=" + encodeURIComponent(page);
    f.title = el.getAttribute("data-title") || "Formulário";
    f.style.cssText = "display:block;width:100%;height:0;border:0;background:transparent;color-scheme:normal;visibility:hidden;position:absolute;transition:height .2s ease";
    el.appendChild(f);
    var ready = false;
    var timer = setTimeout(function () {
      if (ready) return;
      if (f.parentNode) f.parentNode.removeChild(f);
      console.warn("Kora: o formulário não abriu. Confira se este site está autorizado na aba Publicar do formulário.");
    }, 10000);
    window.addEventListener("message", function (e) {
      if (e.origin !== BASE || e.source !== f.contentWindow) return;
      var d = e.data;
      if (!d || d.kora !== KIND) return;
      if (d.type === "height" && typeof d.height === "number") {
        if (!ready) {
          ready = true; clearTimeout(timer);
          for (var i = 0; i < el.children.length; i++) { if (el.children[i] !== f) el.children[i].style.display = "none"; }
          f.style.position = "static"; f.style.visibility = "visible";
          el.setAttribute("data-kora-ready", "");
        }
        f.style.height = Math.max(120, Math.min(4000, Math.ceil(d.height))) + "px";
      } else if (d.type === "submitted") {
        el.dispatchEvent(new CustomEvent(SENT, { bubbles: true, detail: { form: id } }));
      }
    });
  }
  function scan() {
    var list = document.querySelectorAll("[data-kora-form]");
    for (var i = 0; i < list.length; i++) mount(list[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
})();
`
}
