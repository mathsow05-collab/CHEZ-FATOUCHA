# ─────────────────────────────────────────────────────────────
# CHEZ FATOUCHA — image Docker (Render « Runtime: Docker », ou VPS)
#   docker build -t fatoucha .
#   docker run -p 3000:3000 --env-file .env -v $PWD/data:/app/data -v $PWD/uploads:/app/uploads fatoucha
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
# Outils de compilation (better-sqlite3 pour musl) + libvips : c'est lui qui permet à
# `sharp` de servir les photos en AVIF/WebP. Si le binaire précompilé de sharp suffit,
# vips-dev reste inutilisé ; s'il manque, la compilation le trouve ici.
RUN apk add --no-cache python3 make g++ tzdata vips-dev

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server server
COPY public public
COPY admin-ui admin-ui
COPY scripts scripts

RUN mkdir -p data uploads/produits && npm run demo:images

EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
