#!/bin/bash
cd ..
npm install
npm run tsc
docker rm dirtyrss
docker rmi ciberado/dirtyrss
docker build . -t ciberado/dirtyrss
docker run --name dirtyrss --pull never -l com.centurylinklabs.watchtower.enable=false -l wud.watch=false --restart always --publish 3000:3000 ciberado/dirtyrss
