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
	@echo "Deteniendo contenedores..."
	docker compose --profile redis down
	@echo "Eliminando imágenes de dirtyrss..."
	docker images | grep dirtyrss | awk '{print $$3}' | xargs -r docker rmi -f || true
	@echo "Limpiando build cache de Docker..."
	docker builder prune -f
	@echo "Limpieza completada"

compose-remove-volumes:
	@echo "Deteniendo contenedores y eliminando volúmenes..."
	docker compose --profile redis down -v
	@echo "Limpiando volúmenes huérfanos..."
	docker volume prune -f
	@echo "Limpieza de volúmenes completada"

compose-full-clean: compose-clean compose-remove-volumes
	@echo "Limpieza completa finalizada"

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
		TOTAL=$$(docker compose exec redis redis-cli --raw KEYS "$(PATTERN)" | grep -v '^$$' | wc -l); \
		echo "Total de keys encontradas: $$TOTAL"; \
		if [ "$$TOTAL" -eq 0 ]; then \
			echo "No se encontraron keys para borrar."; \
		else \
			read -p "¿Confirmar borrado? (y/N): " confirm; \
			if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
				echo "Borrando keys..."; \
				docker compose exec redis redis-cli --raw KEYS "$(PATTERN)" | xargs -I {} docker exec dirtyrss-redis redis-cli DEL {}; \
				echo "Keys borradas correctamente"; \
			else \
				echo "Operación cancelada"; \
			fi \
		fi \
	else \
		echo "Los contenedores no están en ejecución."; \
	fi

compose-rebuild: compose-clean compose-build compose-up-redis
	@echo "Rebuild completo finalizado"

compose-up: compose-clear-cache compose-rebuild
