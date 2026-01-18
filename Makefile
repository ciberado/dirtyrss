clean:
	rm -rf dist

build:
	npm install
	npm run tsc

run:build
	npm run start

docker-install:
	docker container create --name dirtyrss --pull never -l com.centurylinklabs.watchtower.enable=false -l wud.watch=false --restart always --publish 3000:3000 ciberado/dirtyrss

docker-log:
	docker logs -f dirtyrss

docker-run:
	docker start dirtyrss 

docker-clean:
	docker rm -f dirtyrss 2>/dev/null || true
	docker rmi ciberado/dirtyrss 2>/dev/null || true

docker-build:
	docker build . -t ciberado/dirtyrss

all: docker-clean docker-build docker-install docker-run
