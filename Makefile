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

compose-remove-volumes:
	docker compose --profile redis down -v
	docker volume prune -f

all: compose-clean compose-build compose-up-redis
