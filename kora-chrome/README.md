# Kora Companion — extensão Chrome (`kora-chrome/`)

Extensão oficial do Kora sobre o WhatsApp Web: sidebar com CRM/Negócios, Agenda, Automação, Radar do Dia e Copiloto ✦. Vive dentro do repo principal, mas é um app independente do Next (build próprio, sem imports cruzados) — conversa com o Kora só por HTTP via `/api/ext/*`.

- **Spec UI/UX (fonte visual):** https://claude.ai/code/artifact/1381bd54-1156-4145-9507-34812cb32657
- **Entry no roadmap:** [../ROADMAP.md](../ROADMAP.md) → §Em progresso → 🧩 KORA COMPANION
- **Doc técnico (fonte de verdade):** [../docs/browser-extension-design.md](../docs/browser-extension-design.md)

## Doutrina (inegociável)

**"1 clique humano = 1 ação."** A extensão envia pelo WhatsApp Web (cotação, mensagem) somente como resultado direto de um clique do usuário, só no chat aberto, um por vez. Nunca em massa, nunca agendado, nunca em outro chat — disparo em escala é papel das Campanhas, no canal Oficial do Kora. O que roda depois sem o navegador aberto (lembretes, fluxos) sai server-side pelo canal conectado.

**Fail-closed.** Todo dado vem de `/api/ext/*` no Kora, autenticado por token de dispositivo (revogável em Configurações → Dispositivos) e validado por role + capability + visibilidade (`getViewerScope`). A extensão nunca decide permissão — só renderiza o que o servidor confirmou.

## Como funciona (runtime)

```
WhatsApp Web (web.whatsapp.com)
 ├─ content script
 │   ├─ watcher: observa o DOM e detecta o chat aberto (nome + telefone)
 │   ├─ inject: monta o puxador lateral + <iframe> da sidebar (página da extensão)
 │   └─ actions: executa as ações 1-clique no chat aberto
 │       (inserir rascunho no campo · anexar PDF + enviar)
 ├─ sidebar (iframe chrome-extension://…) — a UI da spec, pele clean
 │   └─ fala com o background via mensagens (nunca fetch direto do content)
 └─ background (service worker MV3)
     ├─ guarda o device token (chrome.storage)
     └─ chama a API do Kora: /api/ext/auth · /resolve · /deals · /agenda · /flows
                                    │
                              Kora (Next.js) — gates fail-closed + eventos na timeline
```

O iframe da extensão contorna o CSP da página (via `web_accessible_resources`); o content script só lê DOM e executa a ação clicada. Nenhum dado de negócio fica no navegador — só o token.

## Estrutura planejada

```
kora-chrome/            # F0 = vanilla JS, ZERO build — carrega unpacked direto
  manifest.json         # MV3 · host_permissions: só https://web.whatsapp.com/*
  background.js         # service worker: token em chrome.storage + único ponto que chama a API
  content.js / .css     # watcher do chat aberto (data-id → telefone) + puxador + iframe
  sidebar.html/.css/.js # UI (F0: ficha + negócios, estados de guarda)
  popup.html/.css/.js   # login → device token · "Sair deste dispositivo"
  assets/logo.svg       # wordmark oficial
```

**Testar (unpacked):** `chrome://extensions` → Modo do desenvolvedor → "Carregar sem
compactação" → esta pasta. Rode `npm run dev` no repo (a extensão fala com
`http://localhost:3000` por padrão — mude em Popup → Servidor). TS/Vite entram
quando o código crescer (F1+).

Logo oficial: wordmark em `assets/logo.svg` (fonte: `../public/logos/logo_kora_azul_vetor.svg`) · ícone quadrado em `assets/icon{16,32,48,128}.png` (gerados de `../public/logo_kora_curto.png` — regenerar com System.Drawing se o logo mudar).

## Fases

| Fase | Entrega | Depende de |
|---|---|---|
| **F0** | Fundação: migration `device_tokens` (staging→prod), rotas `/api/ext/auth`+`/resolve`+`/deals`, esqueleto MV3, sidebar somente-leitura, teste unpacked | — |
| **F1** | Ações CRM: criar contato (c/ foto), negócio, etapa, nota, tag, mensagens rápidas (inserir rascunho) | F0 |
| **F2** | Drill-down (itens + cotação "Enviar nesta conversa" / canal Oficial opcional) + Agenda (slots + agendar) | F1 · motor de documentos (Commercial Core) pra cotação |
| **F3** | Automação: inscrever/remover de fluxo | F1 |
| **F4** | Radar do Dia + Copiloto ✦ (opt-in do dono no banco, análise só sob clique) | F1 · IA v2 |
| **Store** | Ícones, screenshots 1280×800, privacy policy (LGPD), submissão **unlisted** → piloto → público | F1 |

Lado servidor (rotas `/api/ext/*`, migrations) mora no app Next (`src/`); esta pasta é só a extensão — package.json e build próprios, fora do build do Next.
