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
	docker compose --profile redis down

compose-remove-volumes:
	docker compose --profile redis down -v
	docker volume prune -f

compose-clear-cache:
	@echo "Borrando imágenes JPG procesadas..."
	docker compose exec dirtyrss find /tmp/public -type f -name "*.jpg" -delete
	@echo "Borrando feeds cacheados en Redis..."
	docker compose exec redis redis-cli KEYS "chapter:list:feed:*" | xargs -r docker compose exec -T redis redis-cli DEL
	@echo "Cache limpiado"

compose-up: compose-clear-cache compose-clean compose-build compose-up-redis
