FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3333

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/server ./server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/API.md ./API.md
COPY --from=builder /app/data/.gitkeep ./data/.gitkeep

RUN addgroup -S vidclaw && adduser -S vidclaw -G vidclaw \
  && mkdir -p /app/data \
  && chown -R vidclaw:vidclaw /app

USER vidclaw

EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
