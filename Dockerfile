FROM node:alpine

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY . .

RUN apk update; \
    apk add ffmpeg nodejs npm python3

RUN \
  npm i; \
  npx tsc 

EXPOSE 3000

CMD [ "npm", "run", "start" ]
