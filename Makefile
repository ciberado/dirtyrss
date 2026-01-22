clean:
	rm -rf dist

build:
	npm install
	npm run tsc

run:build
	npm run start

compose-up-memory:
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
	@if docker compose ps | grep -q "Up"; then \
		echo "Borrando imágenes JPG procesadas..."; \
		docker compose exec dirtyrss find /tmp/public -type f -name "*.jpg" -delete; \
		echo "Borrando feeds cacheados en Redis..."; \
		echo "Keys encontradas:"; \
		docker compose exec redis redis-cli --scan --pattern "chapter:list:feed:*"; \
		echo "Borrando..."; \
		docker compose exec redis sh -c 'redis-cli --scan --pattern "chapter:list:feed:*" | while read key; do redis-cli DEL "$$key"; done'; \
		echo "Cache limpiado"; \
	else \
		echo "Los contenedores no están en ejecución. Saltando limpieza de cache."; \
	fi

compose-up: compose-clear-cache compose-clean compose-build compose-up-redis
