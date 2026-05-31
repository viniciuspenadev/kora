import { NextRequest, NextResponse } from "next/server"

/**
 * GET /w/[slug].js  (também aceita /w/[slug])
 *
 * Serve o widget JavaScript que o cliente inclui no site:
 *   <script src="https://kora.app/w/acme" async></script>
 *
 * Vanilla JS, sem deps. ~7KB minified.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params
  const slug = rawSlug.replace(/\.js$/, "")
  const baseUrl = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")

  return new NextResponse(buildWidgetJs({ slug, baseUrl }), {
    status: 200,
    headers: {
      "Content-Type":  "application/javascript; charset=utf-8",
      // 1min de cache + revalidação obrigatória — propaga deploys rápido
      // (max-age=60 → browser re-checa; stale-while-revalidate=300 → serve cached enquanto revalida)
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

function buildWidgetJs({ slug, baseUrl }: { slug: string; baseUrl: string }): string {
  return `/* Kora Widget — ${slug} */
(function(){
  if (window.__KoraWidget) return; window.__KoraWidget = true;

  var SLUG = ${JSON.stringify(slug)};
  var BASE = ${JSON.stringify(baseUrl)};
  var STORAGE_VISITOR = 'kora_visitor_id';

  function getVisitorId() {
    try {
      var id = localStorage.getItem(STORAGE_VISITOR);
      if (id) return id;
      id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(STORAGE_VISITOR, id);
      return id;
    } catch (e) { return 'anon_' + Date.now(); }
  }

  function getUTM() {
    var u = {}; try {
      var p = new URLSearchParams(location.search);
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){
        var v = p.get(k); if (v) u[k] = v;
      });
    } catch(e){}
    return u;
  }

  function api(path, body) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function(r){ return r.json(); });
  }

  function trackVisit() {
    var utm = getUTM();
    api('/api/site/visit', Object.assign({
      slug: SLUG,
      visitor_id: getVisitorId(),
      url: location.href,
      title: document.title,
      referrer: document.referrer || null,
    }, utm)).catch(function(){});
  }

  function loadConfig() {
    return fetch(BASE + '/api/site/config/' + SLUG)
      .then(function(r){ return r.json(); })
      .catch(function(){ return { enabled: false }; });
  }

  // ─── CSS ───────────────────────────────────────────────────
  var CSS = ''
    // Tokens
    + ':host,.kw-root{--kw-radius:16px;--kw-shadow-fab:0 8px 24px rgba(15,23,42,.18);--kw-shadow-win:0 24px 64px rgba(15,23,42,.16),0 2px 8px rgba(15,23,42,.06);--kw-ai-1:#60a5fa;--kw-ai-2:#c084fc;--kw-ai-3:#f472b6}'
    // FAB
    + '.kw-fab{position:fixed;z-index:2147483600;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:var(--kw-shadow-fab);transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .25s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:0;transform:scale(.6);animation:kw-fab-in .35s cubic-bezier(.4,0,.2,1) forwards}'
    + '@keyframes kw-fab-in{to{opacity:1;transform:scale(1)}}'
    + '.kw-fab:hover{transform:scale(1.06)}'
    + '.kw-fab:active{transform:scale(.96)}'
    + '.kw-fab svg{width:26px;height:26px;position:relative;z-index:1}'
    + '.kw-fab.kw-br{bottom:20px;right:20px}'
    + '.kw-fab.kw-bl{bottom:20px;left:20px}'
    + '.kw-fab-pulse{position:absolute;inset:-4px;border-radius:50%;background:inherit;opacity:.35;animation:kw-pulse 2s ease-out infinite;pointer-events:none}'
    + '@keyframes kw-pulse{0%{transform:scale(1);opacity:.35}80%,100%{transform:scale(1.5);opacity:0}}'
    + '.kw-fab.kw-shake{animation:kw-fab-in .35s cubic-bezier(.4,0,.2,1) forwards,kw-shake .55s ease-in-out 2 .4s}'
    + '@keyframes kw-shake{0%,100%{translate:0 0}20%{translate:-4px 0}40%{translate:4px 0}60%{translate:-3px 0}80%{translate:3px 0}}'
    // FAB tooltip (acena verbal)
    + '.kw-fab-tip{position:fixed;z-index:2147483599;background:#fff;color:#0f172a;padding:9px 14px;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.14);font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;max-width:240px;display:flex;align-items:center}'
    + '.kw-fab-tip.kw-br{bottom:32px;right:86px;border-bottom-right-radius:4px;transform:translateX(8px)}'
    + '.kw-fab-tip.kw-bl{bottom:32px;left:86px;border-bottom-left-radius:4px;transform:translateX(-8px)}'
    + '.kw-fab-tip.kw-show{opacity:1;transform:translateX(0)}'
    + '.kw-fab-tip-close{margin-left:6px;cursor:pointer;color:#94a3b8;pointer-events:auto;display:flex;padding:4px}'
    + '.kw-fab-tip.kw-show{pointer-events:auto}'
    // Window
    + '.kw-win{position:fixed;z-index:2147483601;width:380px;max-width:calc(100vw - 24px);height:580px;max-height:calc(100vh - 120px);background:#fff;border-radius:var(--kw-radius);box-shadow:var(--kw-shadow-win);overflow:hidden;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transform-origin:bottom right;transform:translateY(12px) scale(.95);opacity:0;pointer-events:none;transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .25s}'
    + '.kw-win.kw-bl{transform-origin:bottom left}'
    + '.kw-win.kw-show{transform:translateY(0) scale(1);opacity:1;pointer-events:auto}'
    + '.kw-win.kw-br{bottom:88px;right:20px}'
    + '.kw-win.kw-bl{bottom:88px;left:20px}'
    // Header
    + '.kw-hd{padding:16px 18px 14px;color:#fff;display:flex;align-items:center;gap:12px;position:relative;flex-shrink:0}'
    // Avatar com AI orb (conic-gradient girando + camadas) — ring 4px visível
    + '.kw-hd-avatar{width:44px;height:44px;border-radius:50%;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center}'
    + '.kw-hd-avatar::before{content:"";position:absolute;inset:-3px;border-radius:50%;background:conic-gradient(from 0deg,var(--kw-ai-1),var(--kw-ai-2),var(--kw-ai-3),var(--kw-ai-1));animation:kw-orb 4s linear infinite;z-index:0;filter:saturate(1.4) brightness(1.05);box-shadow:0 0 12px rgba(192,132,252,.35)}'
    + '.kw-hd-avatar::after{content:"";position:absolute;inset:0;border-radius:50%;background:#fff;z-index:1}'
    + '@keyframes kw-orb{to{transform:rotate(360deg)}}'
    + '.kw-hd-avatar-inner{position:relative;z-index:2;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:700;font-size:16px;color:var(--kw-primary);background:#fff}'
    + '.kw-hd-avatar-inner img{width:100%;height:100%;object-fit:cover}'
    + '.kw-hd-online{position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid #fff;z-index:3}'
    + '.kw-hd-info{flex:1;min-width:0}'
    + '.kw-hd-brand{font-size:15px;font-weight:700;line-height:1.2;margin:0;color:#fff;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}'
    + '.kw-hd-sub{font-size:12px;line-height:1.3;margin:2px 0 0;color:rgba(255,255,255,.85);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;display:flex;align-items:center;gap:5px}'
    + '.kw-hd-sub-dot{width:6px;height:6px;border-radius:50%;background:#86efac;flex-shrink:0;box-shadow:0 0 0 0 rgba(134,239,172,.7);animation:kw-online-pulse 2s infinite}'
    + '@keyframes kw-online-pulse{0%{box-shadow:0 0 0 0 rgba(134,239,172,.7)}70%{box-shadow:0 0 0 6px rgba(134,239,172,0)}100%{box-shadow:0 0 0 0 rgba(134,239,172,0)}}'
    + '.kw-hd-close{background:rgba(255,255,255,.18);border:0;border-radius:8px;width:30px;height:30px;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;transition:background .15s;flex-shrink:0}'
    + '.kw-hd-close:hover{background:rgba(255,255,255,.28)}'
    + '.kw-hd-close svg{width:14px;height:14px}'
    // Progress bar (último item do header)
    + '.kw-progress{position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(255,255,255,.18)}'
    + '.kw-progress-fill{height:100%;background:linear-gradient(90deg,var(--kw-ai-1),var(--kw-ai-2),var(--kw-ai-3));background-size:200% 100%;width:0;transition:width .45s cubic-bezier(.4,0,.2,1);animation:kw-pg-flow 3s linear infinite}'
    + '@keyframes kw-pg-flow{0%{background-position:0 0}100%{background-position:200% 0}}'
    // Body
    + '.kw-body{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:8px;background:#f8fafc}'
    + '.kw-body::-webkit-scrollbar{width:6px}'
    + '.kw-body::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}'
    // Bubbles
    + '.kw-msg-row{display:flex;gap:8px;align-items:flex-end;animation:kw-msg-in .32s cubic-bezier(.4,0,.2,1)}'
    + '@keyframes kw-msg-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}'
    + '.kw-msg-row.kw-me{justify-content:flex-end}'
    // Mini avatar: removido overflow:hidden do parent (estava clipando o orb)
    + '.kw-avatar-mini{width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--kw-primary);position:relative}'
    + '.kw-avatar-mini::before{content:"";position:absolute;inset:-2px;border-radius:50%;background:conic-gradient(from 0deg,var(--kw-ai-1),var(--kw-ai-2),var(--kw-ai-3),var(--kw-ai-1));animation:kw-orb 5s linear infinite;z-index:0;filter:saturate(1.3);box-shadow:0 0 6px rgba(192,132,252,.25)}'
    + '.kw-avatar-mini-inner{position:relative;z-index:1;width:22px;height:22px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--kw-primary)}'
    + '.kw-avatar-mini-inner img{width:100%;height:100%;object-fit:cover}'
    + '.kw-msg{max-width:78%;padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.45;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-bottom-left-radius:6px;word-wrap:break-word;position:relative;overflow:hidden}'
    + '.kw-msg::before{content:"";position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);animation:kw-shimmer .8s ease-out 1}'
    + '@keyframes kw-shimmer{to{left:100%}}'
    + '.kw-me .kw-msg{background:var(--kw-primary);color:#fff;border:0;border-bottom-right-radius:6px;border-bottom-left-radius:18px}'
    + '.kw-me .kw-msg::before{display:none}'
    // Form
    + '.kw-fm{padding:12px 16px 14px;background:#fff;border-top:1px solid #e2e8f0;flex-shrink:0}'
    + '.kw-in{width:100%;padding:11px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:14px;font-family:inherit;box-sizing:border-box;outline:0;background:#fff;transition:border-color .15s,box-shadow .15s;position:relative}'
    + '.kw-in:focus{border-color:var(--kw-primary);box-shadow:0 0 0 3px var(--kw-primary-alpha)}'
    + '.kw-ta{resize:none;min-height:64px;line-height:1.45}'
    + '.kw-btn{margin-top:8px;width:100%;padding:11px 14px;background:var(--kw-primary);color:#fff;border:0;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s,transform .1s;display:flex;align-items:center;justify-content:center;gap:8px}'
    + '.kw-btn:hover{opacity:.93}'
    + '.kw-btn:active{transform:scale(.98)}'
    + '.kw-btn:disabled{opacity:.5;cursor:not-allowed}'
    // Quick-reply chips
    + '.kw-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0}'
    + '.kw-chip{background:#fff;border:1.5px solid var(--kw-primary);color:var(--kw-primary);padding:8px 14px;font-size:13px;font-weight:600;border-radius:999px;cursor:pointer;font-family:inherit;transition:all .15s;animation:kw-chip-in .25s cubic-bezier(.4,0,.2,1) both}'
    + '.kw-chip:nth-child(2){animation-delay:.04s}.kw-chip:nth-child(3){animation-delay:.08s}.kw-chip:nth-child(4){animation-delay:.12s}.kw-chip:nth-child(5){animation-delay:.16s}.kw-chip:nth-child(6){animation-delay:.20s}.kw-chip:nth-child(7){animation-delay:.24s}.kw-chip:nth-child(8){animation-delay:.28s}'
    + '@keyframes kw-chip-in{from{opacity:0;transform:translateY(4px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}'
    + '.kw-chip:hover{background:var(--kw-primary);color:#fff;transform:translateY(-1px)}'
    + '.kw-chip:active{transform:translateY(0) scale(.97)}'
    // AI typing pill (substitui os 3 pontos)
    + '.kw-typing{display:inline-block;padding:0;border:0;background:transparent;border-radius:18px}'
    + '.kw-typing-pill{width:64px;height:22px;border-radius:11px;background:linear-gradient(90deg,var(--kw-ai-1),var(--kw-ai-2),var(--kw-ai-3),var(--kw-ai-2),var(--kw-ai-1));background-size:300% 100%;animation:kw-typing-flow 1.6s ease-in-out infinite;box-shadow:0 2px 8px rgba(96,165,250,.18)}'
    + '@keyframes kw-typing-flow{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}'
    // Success
    + '.kw-success{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;background:#fff;gap:6px}'
    + '.kw-success-ico{width:64px;height:64px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;margin-bottom:12px;animation:kw-pop .35s cubic-bezier(.4,0,.2,1)}'
    + '@keyframes kw-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}'
    + '.kw-success-ico svg{width:32px;height:32px}'
    + '.kw-success-tit{font-size:18px;font-weight:700;color:#0f172a;margin:0}'
    + '.kw-success-body{font-size:13px;color:#64748b;line-height:1.55;margin:4px 0 0;max-width:280px}'
    // Confetti
    + '.kw-confetti{position:absolute;top:0;left:0;right:0;height:120px;pointer-events:none;overflow:hidden}'
    + '.kw-confetti i{position:absolute;top:-12px;width:8px;height:14px;opacity:0;animation:kw-fall 1.6s cubic-bezier(.55,.1,.6,.95) forwards}'
    + '@keyframes kw-fall{0%{opacity:0;transform:translateY(-30px) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translateY(140px) rotate(540deg)}}'
    // LGPD consent + DPO footer
    + '.kw-consent{display:flex;gap:8px;align-items:flex-start;padding:8px 2px 0;font-size:11px;line-height:1.4;color:#64748b}'
    + '.kw-consent input[type="checkbox"]{margin-top:2px;width:14px;height:14px;flex-shrink:0;accent-color:var(--kw-primary);cursor:pointer}'
    + '.kw-consent label{cursor:pointer}'
    + '.kw-consent a{color:var(--kw-primary);text-decoration:underline;font-weight:500}'
    + '.kw-consent a:hover{text-decoration:none}'
    + '.kw-dpo{padding:6px 14px 2px;text-align:center;font-size:9px;line-height:1.4;color:#94a3b8;background:#f8fafc;border-top:1px solid #e2e8f0;flex-shrink:0}'
    + '.kw-dpo a{color:#64748b}'
    // Powered by
    + '.kw-powered{padding:6px 14px;text-align:center;font-size:10px;color:#94a3b8;background:#f8fafc;flex-shrink:0}'
    // ─── Chat ao vivo (premium/clean, estilo Intercom) ───
    + '.kw-body.kw-chat{padding:20px 16px;gap:12px;background:#fff}'
    + '.kw-chat .kw-msg{max-width:82%;padding:11px 15px;border-radius:18px;border-bottom-left-radius:6px;box-shadow:0 1px 2px rgba(15,23,42,.04);font-size:14px;line-height:1.5}'
    + '.kw-chat .kw-msg::before{display:none}'   // sem shimmer no chat
    + '.kw-chat .kw-me .kw-msg{border-radius:18px;border-bottom-right-radius:6px;box-shadow:0 2px 8px var(--kw-primary-alpha)}'
    + '.kw-chat .kw-msg-row{align-items:flex-end}'
    // 3 pontinhos discretos (Intercom-like) no lugar da pill
    + '.kw-dots{display:inline-flex;gap:4px;padding:13px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;border-bottom-left-radius:6px}'
    + '.kw-dots i{width:7px;height:7px;border-radius:50%;background:#cbd5e1;animation:kw-dot 1.3s infinite ease-in-out}'
    + '.kw-dots i:nth-child(2){animation-delay:.16s}.kw-dots i:nth-child(3){animation-delay:.32s}'
    + '@keyframes kw-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}'
    // Chips de sugestão
    + '.kw-sugg{display:flex;flex-wrap:wrap;gap:8px;padding:6px 0 2px;animation:kw-msg-in .3s cubic-bezier(.4,0,.2,1)}'
    + '.kw-sugg-chip{background:#fff;border:1.5px solid #e2e8f0;color:var(--kw-primary);padding:9px 15px;font-size:13px;font-weight:600;border-radius:999px;cursor:pointer;font-family:inherit;transition:all .15s;animation:kw-chip-in .28s cubic-bezier(.4,0,.2,1) both}'
    + '.kw-sugg-chip:hover{border-color:var(--kw-primary);background:var(--kw-primary);color:#fff;transform:translateY(-1px);box-shadow:0 5px 14px var(--kw-primary-alpha)}'
    + '.kw-sugg-chip:active{transform:translateY(0) scale(.97)}'
    // Composer inline (input + botão redondo)
    + '.kw-fm.kw-chat{padding:12px 14px;display:flex;gap:9px;align-items:flex-end}'
    + '.kw-fm.kw-chat .kw-in{flex:1;border-radius:22px;min-height:44px;max-height:120px;padding:11px 16px;line-height:1.4}'
    + '.kw-send{width:44px;height:44px;border-radius:50%;border:0;background:var(--kw-primary);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:transform .12s,opacity .15s;box-shadow:0 4px 12px var(--kw-primary-alpha)}'
    + '.kw-send:hover{opacity:.93}'
    + '.kw-send:active{transform:scale(.9)}'
    // Linha de status (ex: "recebido" quando não há IA na linha de frente)
    + '.kw-chat .kw-sys{align-self:center;max-width:90%;text-align:center;font-size:11px;color:#94a3b8;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:5px 12px;margin:2px auto}'
    ;
  var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);

  // ─── Boot ───
  trackVisit();

  loadConfig().then(function(cfg){
    if (!cfg || !cfg.enabled) return;
    if (urlMatches(cfg.hide_url_patterns)) return;
    var delay = (cfg.show_after_seconds || 0) * 1000;
    setTimeout(function(){ renderFab(cfg); }, delay);
  });

  // Glob match CSP-safe (sem new RegExp dinâmico — apenas string ops)
  function globMatch(str, pattern){
    if (pattern.indexOf('*') === -1) return str === pattern;
    var parts = pattern.split('*');
    var startsEmpty = parts[0] === '';
    var endsEmpty   = parts[parts.length - 1] === '';
    var idx = 0;
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '') continue;
      var pos = str.indexOf(part, idx);
      if (pos === -1) return false;
      if (i === 0 && !startsEmpty && pos !== 0) return false;
      idx = pos + part.length;
    }
    return endsEmpty || idx === str.length;
  }

  function urlMatches(patterns){
    if (!patterns || !patterns.length) return false;
    var url = location.pathname + location.search;
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i]; if (!p) continue;
      if (globMatch(url, p)) return true;
    }
    return false;
  }

  // CSS injection guard: aceita apenas #RGB/#RRGGBB/#RRGGBBAA
  function safeColor(c){
    if (typeof c !== 'string') return '#004add';
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c) ? c : '#004add';
  }

  function hexToRgba(hex, alpha){
    try {
      var h = safeColor(hex).replace('#','');
      if (h.length === 3) h = h.split('').map(function(c){return c+c}).join('');
      var r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    } catch(e){ return 'rgba(0,74,221,' + alpha + ')'; }
  }

  function applyTokens(cfg){
    var root = document.documentElement;
    var color = safeColor(cfg.button_color);
    cfg.button_color = color; // sanitiza no objeto pra todos os usos downstream
    root.style.setProperty('--kw-primary', color);
    root.style.setProperty('--kw-primary-alpha', hexToRgba(color, 0.18));
  }

  function renderFab(cfg){
    applyTokens(cfg);
    var pos = cfg.button_position === 'bottom-left' ? 'bl' : 'br';
    var fab = document.createElement('button');
    fab.className = 'kw-fab kw-' + pos;
    fab.style.background = cfg.button_color || '#004add';
    fab.setAttribute('aria-label', cfg.button_label || 'Falar conosco');
    fab.innerHTML = ''
      + '<span class="kw-fab-pulse" style="background:' + (cfg.button_color || '#004add') + '"></span>'
      + '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.37 5.06L2 22l5.06-1.37C8.55 21.5 10.22 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.04 18.13c-1.55 0-2.99-.46-4.21-1.24l-.3-.18-3.12.84.84-3.04-.2-.32C4.27 15 3.83 13.55 3.83 12c0-4.51 3.67-8.17 8.21-8.17 2.19 0 4.25.85 5.8 2.4 1.55 1.55 2.4 3.61 2.4 5.8 0 4.51-3.66 8.17-8.2 8.17zm4.48-6.13c-.25-.13-1.45-.71-1.67-.8-.23-.08-.39-.13-.55.13-.16.25-.63.79-.77.96-.14.16-.28.18-.53.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.39.11-.51.11-.11.25-.29.38-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.13-.55-1.33-.76-1.82-.2-.48-.41-.41-.55-.41-.14-.01-.31-.01-.47-.01-.16 0-.43.06-.66.31-.23.25-.86.84-.86 2.04 0 1.2.88 2.37 1 2.53.13.16 1.72 2.63 4.17 3.69.58.25 1.04.4 1.4.51.59.19 1.12.16 1.55.1.47-.07 1.45-.59 1.66-1.16.2-.57.2-1.06.14-1.16-.06-.11-.22-.17-.47-.3z"/></svg>';
    fab.addEventListener('click', function(){
      if (tip && tip.parentNode) tip.remove();
      clearTimeout(tipTimer); clearTimeout(tipHide); clearTimeout(shakeTimer);
      openWindow(cfg);
      fab.style.display='none';
    });
    document.body.appendChild(fab);

    // Tooltip "👋 Fala com a gente" depois de 5s
    var tip = null, tipTimer, tipHide, shakeTimer;
    tipTimer = setTimeout(function(){
      tip = document.createElement('div');
      tip.className = 'kw-fab-tip kw-' + pos;
      tip.innerHTML = '<span>👋 ' + escape(cfg.button_label || 'Fala com a gente') + '</span><span class="kw-fab-tip-close" aria-label="Fechar">×</span>';
      document.body.appendChild(tip);
      tip.offsetHeight; // Força reflow para garantir a transição CSS
      tip.classList.add('kw-show');
      tip.querySelector('.kw-fab-tip-close').addEventListener('click', function(){
        tip.classList.remove('kw-show');
        setTimeout(function(){ if (tip.parentNode) tip.remove(); }, 280);
      });
      tipHide = setTimeout(function(){
        if (!tip || !tip.parentNode) return;
        tip.classList.remove('kw-show');
        setTimeout(function(){ if (tip.parentNode) tip.remove(); }, 280);
      }, 6000);
    }, 5000);

    // Shake (acena) depois de 30s de ociosidade
    shakeTimer = setTimeout(function(){
      fab.classList.add('kw-shake');
    }, 30000);
  }

  function openWindow(cfg){
    var pos = cfg.button_position === 'bottom-left' ? 'bl' : 'br';
    var initial = (cfg.brand_name || 'K').charAt(0).toUpperCase();

    var win = document.createElement('div');
    win.className = 'kw-win kw-' + pos;
    win.innerHTML = ''
      + '<div class="kw-hd" style="background:' + (cfg.button_color || '#004add') + '">'
      +   '<div class="kw-hd-avatar">'
      +     '<div class="kw-hd-avatar-inner">' + escape(initial) + '</div>'
      +     '<span class="kw-hd-online" aria-label="Online"></span>'
      +   '</div>'
      +   '<div class="kw-hd-info">'
      +     '<p class="kw-hd-brand">' + escape(cfg.brand_name || cfg.button_label || 'Atendimento') + '</p>'
      +     '<p class="kw-hd-sub"><span class="kw-hd-sub-dot"></span>' + escape(cfg.subtitle || 'Online agora') + '</p>'
      +   '</div>'
      +   '<button class="kw-hd-close" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      +   '<div class="kw-progress"><div class="kw-progress-fill" id="kw-pg"></div></div>'
      + '</div>'
      + '<div class="kw-body" id="kw-body"></div>'
      + '<div class="kw-fm" id="kw-fm"></div>'
      + (cfg.dpo_email
          ? '<div class="kw-dpo">Encarregado de Dados (LGPD): <a href="mailto:' + escapeAttr(cfg.dpo_email) + '">' + escape(cfg.dpo_email) + '</a></div>'
          : '')
      + '<div class="kw-powered">Powered by Kora</div>';
    document.body.appendChild(win);
    requestAnimationFrame(function(){ win.classList.add('kw-show'); });

    // Logo do header via DOM API (CSP-safe — sem onerror inline)
    if (cfg.logo_url) {
      var avatarHost = win.querySelector('.kw-hd-avatar-inner');
      injectLogoImg(avatarHost, cfg.logo_url, initial);
    }

    win.querySelector('.kw-hd-close').addEventListener('click', function(){
      win.classList.remove('kw-show');
      setTimeout(function(){
        win.remove();
        var existing = document.querySelector('.kw-fab');
        if (existing) existing.style.display = '';
      }, 250);
    });

    // Dois modos: 'chat' = conversa ao vivo com a IA; senão = formulário (atual).
    if (cfg.mode === 'chat') runLiveChat(cfg, win);
    else runConversation(cfg, win);
  }

  function runConversation(cfg, win){
    var body = win.querySelector('#kw-body');
    var fm   = win.querySelector('#kw-fm');
    var pg   = win.querySelector('#kw-pg');
    var questions = (cfg.questions || []).slice(0, 5);
    var answers = {};
    var idx = 0;
    var initial = (cfg.brand_name || 'K').charAt(0).toUpperCase();

    // Avatar mini: sempre renderiza initial; logo é injetada via DOM após o row entrar no body
    function avatarMiniHtml(){
      return '<div class="kw-avatar-mini"><div class="kw-avatar-mini-inner">' + escape(initial) + '</div></div>';
    }

    function maybeFillLogoOnRow(row){
      if (!cfg.logo_url) return;
      var host = row.querySelector('.kw-avatar-mini-inner');
      if (host) injectLogoImg(host, cfg.logo_url, initial);
    }

    function updateProgress(){
      if (!pg) return;
      var total = questions.length || 1;
      // idx é a "próxima" pergunta — progresso = idx/total
      var pct = Math.min(100, Math.round((idx / total) * 100));
      pg.style.width = pct + '%';
    }

    function typingDelay(text){
      var len = (text || '').length;
      return Math.min(1500, 320 + len * 22);
    }

    function timeGreeting(){
      var h = new Date().getHours();
      if (h < 12) return 'Bom dia! ☀️ ';
      if (h < 18) return 'Boa tarde! 👋 ';
      return 'Boa noite! 🌙 ';
    }

    function addBotMsg(text){
      var row = document.createElement('div');
      row.className = 'kw-msg-row';
      row.innerHTML = avatarMiniHtml() + '<div class="kw-msg">' + escape(text) + '</div>';
      body.appendChild(row);
      maybeFillLogoOnRow(row);
      body.scrollTop = body.scrollHeight;
    }
    function addUserMsg(text){
      var row = document.createElement('div');
      row.className = 'kw-msg-row kw-me';
      row.innerHTML = '<div class="kw-msg">' + escape(text) + '</div>';
      body.appendChild(row);
      body.scrollTop = body.scrollHeight;
    }
    function showTyping(cb, delay){
      var row = document.createElement('div');
      row.className = 'kw-msg-row';
      row.innerHTML = avatarMiniHtml() + '<div class="kw-typing"><div class="kw-typing-pill"></div></div>';
      body.appendChild(row);
      maybeFillLogoOnRow(row);
      body.scrollTop = body.scrollHeight;
      setTimeout(function(){ row.remove(); cb(); }, delay || 700);
    }

    function ask(q){
      var text = q.label || 'Continue...';
      showTyping(function(){
        addBotMsg(text);
        renderInput(q);
      }, typingDelay(text));
    }

    // Constrói bloco de consentimento LGPD. Retorna { node, isChecked() }
    // ou null se o tenant não configurou privacy_policy_url.
    function buildConsentBlock(){
      if (!cfg.privacy_policy_url) return null;
      var policyUrl  = cfg.privacy_policy_url;
      if (!/^https?:\\/\\//i.test(policyUrl)) return null; // safety: defesa em profundidade contra javascript:
      var raw = cfg.consent_text || 'Concordo com a {politica_privacidade} e com o tratamento dos meus dados para contato.';

      // Sanitiza tudo e SÓ DEPOIS injeta o link <a>. Tokens permitidos: {politica_privacidade}
      var escapedText = escape(raw);
      var linkHtml = '<a href="' + escapeAttr(policyUrl) + '" target="_blank" rel="noopener noreferrer">política de privacidade</a>';
      var htmlText = escapedText.replace('{politica_privacidade}', linkHtml);

      var wrap = document.createElement('div');
      wrap.className = 'kw-consent';
      var inputId = 'kw-consent-' + Math.random().toString(36).slice(2,8);
      wrap.innerHTML =
        '<input type="checkbox" id="' + inputId + '"/>' +
        '<label for="' + inputId + '">' + htmlText + '</label>';
      var checkbox = wrap.querySelector('input[type="checkbox"]');
      return { node: wrap, isChecked: function(){ return !!checkbox.checked; }, focus: function(){ checkbox.focus(); } };
    }

    function renderInput(q){
      fm.innerHTML = '';
      var isLast = idx === questions.length - 1;
      var consent = isLast ? buildConsentBlock() : null;

      // Quick-reply chips quando type=select
      if (q.type === 'select' && q.options && q.options.length) {
        var chips = document.createElement('div');
        chips.className = 'kw-chips';
        q.options.forEach(function(opt){
          var b = document.createElement('button');
          b.className = 'kw-chip';
          b.type = 'button';
          b.textContent = opt;
          b.addEventListener('click', function(){
            // Gate por consent (se aplicável)
            if (consent && !consent.isChecked()) {
              consent.focus();
              consent.node.style.outline = '2px solid #f59e0b';
              setTimeout(function(){ consent.node.style.outline = ''; }, 1500);
              return;
            }
            commitAnswer(q, opt);
          });
          chips.appendChild(b);
        });
        fm.appendChild(chips);
        if (consent) fm.appendChild(consent.node);
        return;
      }

      var isLong = q.type === 'longtext';
      var input = document.createElement(isLong ? 'textarea' : 'input');
      input.className = 'kw-in' + (isLong ? ' kw-ta' : '');
      if (!isLong) input.type = q.type === 'phone' ? 'tel' : q.type === 'email' ? 'email' : 'text';
      input.placeholder = q.placeholder || '';
      input.required = !!q.required;

      // Máscara ao vivo pra telefone (BR)
      if (q.type === 'phone') {
        input.addEventListener('input', function(){
          var d = (input.value || '').replace(/\\D/g,'').slice(0,11);
          var out = d;
          if (d.length > 2 && d.length <= 7) out = '(' + d.slice(0,2) + ') ' + d.slice(2);
          else if (d.length > 7) out = '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7);
          input.value = out;
        });
      }

      var btn = document.createElement('button');
      btn.className = 'kw-btn';
      btn.innerHTML = isLast
        ? 'Enviar <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
        : 'Continuar';

      function submit(){
        var val = (input.value || '').trim();
        if (q.required && !val) { input.focus(); return; }
        if (q.type === 'phone' && val.replace(/\\D/g,'').length < 10) {
          input.focus(); input.placeholder = 'Telefone com DDD'; return;
        }
        if (q.type === 'email' && val && !/^\\S+@\\S+\\.\\S+$/.test(val)) {
          input.focus(); return;
        }
        // LGPD: gate por consentimento na última pergunta
        if (consent && !consent.isChecked()) {
          consent.focus();
          consent.node.style.outline = '2px solid #f59e0b';
          setTimeout(function(){ consent.node.style.outline = ''; }, 1500);
          return;
        }
        commitAnswer(q, val);
      }

      input.addEventListener('keydown', function(e){
        if (e.key === 'Enter' && !e.shiftKey && !isLong) { e.preventDefault(); submit(); }
      });
      btn.addEventListener('click', submit);

      fm.appendChild(input);
      fm.appendChild(btn);
      if (consent) fm.appendChild(consent.node);
      setTimeout(function(){ input.focus(); }, 60);
    }

    function commitAnswer(q, val){
      answers[q.id || ('q'+idx)] = val;
      addUserMsg(val);
      idx++;
      updateProgress();
      fm.innerHTML = '';
      try { if (navigator.vibrate) navigator.vibrate(15); } catch(e){}
      if (idx < questions.length) {
        setTimeout(function(){ ask(questions[idx]); }, 280);
      } else {
        finish();
      }
    }

    function finish(){
      fm.innerHTML = '';
      var utm = getUTM();
      // LGPD: registra prova de consentimento (timestamp + URL da política mostrada)
      var consentProof = cfg.privacy_policy_url ? {
        given:      true,
        at:         new Date().toISOString(),
        policy_url: cfg.privacy_policy_url,
        text:       cfg.consent_text || null,
      } : null;
      api('/api/site/lead', Object.assign({
        slug: SLUG,
        visitor_id: getVisitorId(),
        answers: answers,
        url: location.href,
        referrer: document.referrer || null,
        consent: consentProof,
      }, utm)).then(function(r){
        renderSuccess(r && r.ok, cfg);
      }).catch(function(){
        renderSuccess(false, cfg);
      });
    }

    function renderSuccess(ok, cfg){
      // 100% no progresso
      if (pg) pg.style.width = '100%';
      var newBody = document.createElement('div');
      newBody.className = 'kw-success';
      if (ok) {
        newBody.innerHTML = ''
          + '<div class="kw-confetti" id="kw-confetti"></div>'
          + '<div class="kw-success-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
          + '<p class="kw-success-tit">Pronto!</p>'
          + '<p class="kw-success-body">' + escape(cfg.success_message || 'Vamos te chamar em breve no WhatsApp.') + '</p>';
      } else {
        newBody.innerHTML = ''
          + '<div class="kw-success-ico" style="background:#fee2e2;color:#dc2626"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>'
          + '<p class="kw-success-tit">Algo deu errado</p>'
          + '<p class="kw-success-body">Tente novamente em alguns instantes.</p>';
      }
      body.parentNode.replaceChild(newBody, body);
      fm.remove();
      if (ok) launchConfetti(newBody.querySelector('#kw-confetti'), cfg.button_color || '#004add');
    }

    function launchConfetti(host, color){
      if (!host) return;
      var palette = [color, '#22c55e', '#f59e0b', '#a78bfa', '#ec4899'];
      for (var i = 0; i < 22; i++) {
        var p = document.createElement('i');
        p.style.left = Math.random() * 100 + '%';
        p.style.background = palette[i % palette.length];
        p.style.animationDelay = (Math.random() * .3) + 's';
        p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
        host.appendChild(p);
      }
    }

    // Início
    updateProgress();
    var first = (cfg.greeting || 'Oi! Como posso te ajudar?');
    var greet = timeGreeting() + first;
    showTyping(function(){
      addBotMsg(greet);
      if (questions.length === 0) {
        addBotMsg('(Nenhuma pergunta configurada)');
        return;
      }
      setTimeout(function(){ ask(questions[0]); }, 420);
    }, typingDelay(greet));
  }

  // ─── Modo CHAT AO VIVO (conversa real com a Kora IA) ───────
  function runLiveChat(cfg, win){
    var body = win.querySelector('#kw-body');
    var fm   = win.querySelector('#kw-fm');
    var pg   = win.querySelector('#kw-pg');
    if (pg) pg.style.display = 'none';
    body.classList.add('kw-chat');
    fm.classList.add('kw-chat');
    var initial = (cfg.brand_name || 'K').charAt(0).toUpperCase();
    var conversationId = null;
    // Folga de 10s absorve diferença de relógio browser↔servidor (não perde a 1ª resposta).
    var since = new Date(Date.now() - 10000).toISOString();
    var pollTimer = null, sending = false, typingRow = null, typingTimer = null, suggRow = null;
    // IA na linha de frente? Sem ela, o atendimento é manual (humano responde
    // pelo inbox) → não fingimos "digitando", mostramos "recebido".
    var aiActive = cfg.ai_active === true, ackShown = false;

    function avatarMiniHtml(){ return '<div class="kw-avatar-mini"><div class="kw-avatar-mini-inner">' + escape(initial) + '</div></div>'; }
    function fillLogo(row){ if (!cfg.logo_url) return; var h = row.querySelector('.kw-avatar-mini-inner'); if (h) injectLogoImg(h, cfg.logo_url, initial); }
    function addBot(text){ var r = document.createElement('div'); r.className = 'kw-msg-row'; r.innerHTML = avatarMiniHtml() + '<div class="kw-msg">' + escape(text) + '</div>'; body.appendChild(r); fillLogo(r); body.scrollTop = body.scrollHeight; }
    function addUser(text){ var r = document.createElement('div'); r.className = 'kw-msg-row kw-me'; r.innerHTML = '<div class="kw-msg">' + escape(text) + '</div>'; body.appendChild(r); body.scrollTop = body.scrollHeight; }
    function showTyping(){ if (typingRow) return; typingRow = document.createElement('div'); typingRow.className = 'kw-msg-row'; typingRow.innerHTML = avatarMiniHtml() + '<div class="kw-dots"><i></i><i></i><i></i></div>'; body.appendChild(typingRow); fillLogo(typingRow); body.scrollTop = body.scrollHeight; clearTimeout(typingTimer); typingTimer = setTimeout(hideTyping, 30000); }
    function hideTyping(){ clearTimeout(typingTimer); if (typingRow){ typingRow.remove(); typingRow = null; } }
    function showReceived(){ if (ackShown) return; ackShown = true; var r = document.createElement('div'); r.className = 'kw-sys'; r.textContent = '✓ Mensagem recebida — nossa equipe responde por aqui.'; body.appendChild(r); body.scrollTop = body.scrollHeight; }

    function clearSuggestions(){ if (suggRow){ suggRow.remove(); suggRow = null; } }
    function renderSuggestions(list){
      clearSuggestions();
      if (!list || !list.length) return;
      suggRow = document.createElement('div');
      suggRow.className = 'kw-sugg';
      list.slice(0, 5).forEach(function(s){
        if (!s) return;
        var b = document.createElement('button');
        b.className = 'kw-sugg-chip'; b.type = 'button'; b.textContent = String(s);
        b.addEventListener('click', function(){ clearSuggestions(); send(String(s)); });
        suggRow.appendChild(b);
      });
      body.appendChild(suggRow);
      body.scrollTop = body.scrollHeight;
    }

    function renderComposer(){
      fm.innerHTML = '';
      var input = document.createElement('textarea');
      input.className = 'kw-in kw-ta';
      input.placeholder = 'Escreva sua mensagem...';
      input.rows = 1;
      input.addEventListener('input', function(){ input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
      var btn = document.createElement('button');
      btn.className = 'kw-send';
      btn.setAttribute('aria-label', 'Enviar');
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
      function submit(){ var v = (input.value || '').trim(); if (!v || sending) return; input.value = ''; input.style.height = 'auto'; send(v); }
      input.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); submit(); } });
      btn.addEventListener('click', submit);
      fm.appendChild(input); fm.appendChild(btn);
      setTimeout(function(){ input.focus(); }, 60);
    }

    function send(text){
      clearSuggestions(); sending = true; addUser(text);
      if (aiActive) showTyping(); else showReceived();
      try { if (navigator.vibrate) navigator.vibrate(12); } catch(e){}
      api('/api/site/message', { slug: SLUG, visitor_id: getVisitorId(), text: text }).then(function(r){
        sending = false;
        if (r && r.conversation_id){ conversationId = r.conversation_id; if (!pollTimer) startPolling(); }
        else { hideTyping(); }
      }).catch(function(){ sending = false; hideTyping(); });
    }

    function startPolling(){ poll(); pollTimer = setInterval(poll, 2500); }
    function poll(){
      if (!document.body.contains(win)){ clearInterval(pollTimer); return; }
      if (!conversationId) return;
      api('/api/site/messages', { slug: SLUG, visitor_id: getVisitorId(), conversation_id: conversationId, since: since }).then(function(r){
        if (r && r.messages && r.messages.length){
          hideTyping();
          r.messages.forEach(function(m){ addBot(m.text); since = m.at; });
        }
      }).catch(function(){});
    }

    // Início: caixa de texto já disponível; tenta carregar o histórico (visitante
    // que voltou e não pode perder a resposta do atendente) — senão, saudação.
    renderComposer();
    showTyping();
    function startFresh(){
      hideTyping();
      addBot(cfg.greeting || 'Oi! Como posso te ajudar?');
      renderSuggestions(cfg.chat_suggestions);
    }
    api('/api/site/history', { slug: SLUG, visitor_id: getVisitorId() }).then(function(r){
      if (r && r.conversation_id && r.messages && r.messages.length){
        hideTyping();
        conversationId = r.conversation_id;
        r.messages.forEach(function(m){
          if (m.sender === 'me') addUser(m.text); else addBot(m.text);
          since = m.at;
        });
        startPolling();
      } else {
        startFresh();
      }
    }).catch(startFresh);
  }

  function escape(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\'':'&#39;'}[c];
    });
  }
  function escapeAttr(s){ return escape(s); }

  // Injeta logo via DOM API (CSP-safe — onerror via addEventListener, sem inline handler)
  function injectLogoImg(host, url, fallbackText){
    if (!host) return;
    // Aceita apenas http(s) — bloqueia javascript:, data:, file:
    if (typeof url !== 'string' || !/^https?:\\/\\//i.test(url)) return;
    var img = document.createElement('img');
    img.alt = '';
    img.addEventListener('error', function(){
      host.textContent = fallbackText || '';
    });
    img.src = url;
    host.textContent = '';
    host.appendChild(img);
  }
})();
`
}
