clean:
	rm -rf dist

build:
	npm install
	npm run tsc

run:build
	npm run start

docker-install:clean docker-build
	docker container create --name dirtyrss --pull never -l com.centurylinklabs.watchtower.enable=false -l wud.watch=false --restart always --publish 3000:3000 ciberado/dirtyrss

docker-log:
	docker logs -f dirtyrss

docker-run:
	docker start ciberado/dirtyrss 

docker-clean:clean
	docker container ls -al | grep dirtyrss && docker stop ciberado/dirtyrss || true
	docker rmi ciberado/dirtyrss || true

docker-build:
	docker build . -t dirtyrss

all: docker-clean docker-build docker-install docker-run
