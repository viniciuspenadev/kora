# syntax=docker/dockerfile:1.7
# ═════════════════════════════════════════════════════════════════
# Kora — Dockerfile multi-stage pra Easypanel / VPS
# ═════════════════════════════════════════════════════════════════
# Stages:
#   1. deps    — instala node_modules a partir do lockfile
#   2. builder — roda `next build` (gera .next/standalone)
#   3. runner  — imagem final mínima, só com runtime
#
# Vars NEXT_PUBLIC_* PRECISAM vir como ARG (são inlinadas no JS no build).
# Vars de servidor (service_role key, AUTH_SECRET, etc.) ficam só no runtime.
# Setá-las em "Environment" no Easypanel — NÃO em Build Args.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Stage 1: deps ────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# `npm install` em vez de `npm ci` porque o lock gerado no Windows não
# inclui deps opcionais Linux-only (ex: @emnapi/runtime via lightningcss).
# Em Linux ele resolve as opcionais corretas sem falhar.
RUN npm install --ignore-scripts --no-audit --no-fund --prefer-offline

# ── Stage 2: builder ─────────────────────────────────────────────
FROM base AS builder

# Build args (públicos — entram no bundle do client)
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Chave pública do Web Push — inlinada no client (push-prompt). Sem ela no build,
# a faixa "Ativar avisos" nunca aparece (VAPID vazio).
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY

ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ── Stage 3: runner ──────────────────────────────────────────────
FROM base AS runner

# ffmpeg: transcodifica mídia pro formato aceito pela WhatsApp Cloud API (oficial)
# — áudio gravado no navegador (webm) → ogg/opus, vídeo → mp4. Ver src/lib/media/transcode.ts.
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuário não-root pra segurança
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Public assets + standalone server + static
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
