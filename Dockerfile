FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache ffmpeg python3

COPY package*.json tsconfig.json ./

RUN npm i
COPY . .

RUN npx tsc

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]