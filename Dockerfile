FROM node:alpine AS builder

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY src/ ./src/

RUN npm run tsc

FROM node:alpine

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

RUN apk update && \
    apk add --no-cache ffmpeg python3

COPY package.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /home/node/app/dist ./dist

COPY assets/ ./assets/

RUN chown -R node:node /home/node/app

USER node

EXPOSE 3000

CMD ["npm", "run", "start"]