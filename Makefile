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

compose-clear-keys:
	@if [ -z "$(PATTERN)" ]; then \
		echo "Error: Debes especificar PATTERN. Ejemplo: make compose-clear-keys PATTERN='chapter:*filosofia*'"; \
		exit 1; \
	fi; \
	if docker compose ps | grep -q "Up"; then \
		echo "Buscando keys con patrón: $(PATTERN)"; \
		docker compose exec redis redis-cli --raw KEYS "$(PATTERN)" | head -10; \
		echo "..."; \
		TOTAL=$$(docker compose exec redis redis-cli --raw KEYS "$(PATTERN)" | wc -l); \
		echo "Total de keys encontradas: $$TOTAL"; \
		read -p "¿Confirmar borrado? (y/N): " confirm; \
		if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
			echo "Borrando keys..."; \
			docker compose exec redis redis-cli --raw KEYS "$(PATTERN)" | xargs -I {} docker exec dirtyrss-redis redis-cli DEL {}; \
			echo "Keys borradas correctamente"; \
		else \
			echo "Operación cancelada"; \
		fi \
	else \
		echo "Los contenedores no están en ejecución."; \
	fi

compose-up: compose-clear-cache compose-clean compose-build compose-up-redis
