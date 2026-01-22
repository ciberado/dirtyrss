FROM node:25-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN npm i
COPY . .

RUN npx tsc

FROM node:25-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg python3 py3-pip deno && \
    pip3 install --break-system-packages --no-cache-dir 'httpcore[asyncio]'

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /tmp/public && chown -R node:node /tmp/public

USER node

EXPOSE 3000

CMD ["node", "--max-old-space-size=512", "dist/index.js"]