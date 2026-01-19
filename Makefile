clean:
	rm -rf dist

build:
	npm install
	npm run tsc

run:build
	npm run start

compose-up:
	docker compose up -d

compose-up-redis:
	docker compose --profile redis up -d

compose-down:
	docker compose --profile redis down

compose-logs:
	docker compose logs -f

compose-build:
	docker compose build

compose-restart:
	docker compose restart

compose-clean:
	docker compose --profile redis down -v

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

all: compose-clean compose-build compose-up-redis
