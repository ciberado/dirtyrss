# dirtyrss

Gracias a [Ivoox](https://ivoox.com) por crear una App tan tan mala que ha conseguido que me entren las ganas
suficientes como para coger el teclado y montar un scrapper de los podcasts para generar un feed rss tradicional.
De esta manera puedo apuntar mi podcatcher favorito a este servidor y subscribirme a ellos de la misma manera
que lo hago con cualquier otra fuente de shows.

También puedes utilizar el servicio para generar feeds contra canales de Twitch. Revisa los [ejemplos](https://github.com/ciberado/dirtyrss?tab=readme-ov-file#obteniendo-feeds)
para entender cómo encontrar el canal o podcast que te interese.

*Importante: por mucha tirria que les tenga a los de Ivoox por crear otro [walled garden](https://blog.tail.digital/es/sabes-lo-que-es-walled-garden/)
en esta porquería de web que se nos está quedando, no creo que sea ético implementar este
tipo de proxies como un servicio disponible para todo el mundo. En otras palabras: tengo la conciencia muy
tranquila publicando el código para que puedas crear tu propio servidor personal, pero no me gustaría que lo dejases
abierto a todo el mundo.*

## Instalación

En Ubuntu 20.04:

* Haz un forward del puerto 80 al 3000 (que es donde se ejecutará *DirtyRSS*)

```bash
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000
```

* Prepara el runtime de nodejs

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm
nvm install --lts
```

* Instala otros prerequisitos:

```bash
sudo apt update
sudo apt install -y python3 ffmpeg
```

* Descarga *DirtyRSS* y sus dependencias, después compila

```bash
git clone https://github.com/ciberado/dirtyrss
cd dirtyrss
npm i
npx tsc
```

* Lanza el programa:

```bash
npm run start
```

## Ejecutando con Docker

Nota: Probablemente no querrás utilizar el puerto 80 a menos que tu red sea de confianza.

### Requisitos previos

Asegúrate de tener instalado:
- Docker
- Docker Compose
- Make

En Ubuntu/Debian:
```bash
sudo apt-get install make
```

En macOS (con Homebrew):
```bash
brew install make
```

### Ejecución con Docker Compose (recomendado)

```bash
# Construir, limpiar caché y arrancar con Redis (caché persistente)
make compose-up

# Ver logs en tiempo real
make compose-logs

# Reiniciar contenedores
make compose-restart

# Detener contenedores (preserva volúmenes/caché)
make compose-down

# Limpieza completa (elimina volúmenes y caché)
make compose-remove-volumes
```

### Variables de entorno

Puedes configurar DirtyRSS mediante variables de entorno en el `docker-compose.yml`:

- `PORT` - Puerto del servidor (default: 3000)
- `CACHE_TYPE` - Tipo de caché: `redis` o `memory` (default: memory)
- `REDIS_ADDRESS` - Dirección del servidor Redis (default: redis:6379)
- `YTDLP_MAX_CONCURRENT` - Número máximo de procesos yt-dlp concurrentes (default: 10)

Ejemplo para ajustar la concurrencia de yt-dlp:

```yaml
environment:
  - YTDLP_MAX_CONCURRENT=5  # Reduce la concurrencia para servidores con menos recursos
```

### Comandos disponibles en Makefile

- `make compose-up` - Limpiar caché, detener, construir y arrancar con Redis (comando principal)
- `make compose-build` - Construir la imagen Docker
- `make compose-up-memory` - Arrancar sin Redis (solo caché en memoria)
- `make compose-up-redis` - Arrancar con Redis (caché persistente)
- `make compose-down` - Detener todos los contenedores
- `make compose-logs` - Ver logs en tiempo real
- `make compose-restart` - Reiniciar contenedores sin reconstruir
- `make compose-clean` - Detener contenedores (preserva volúmenes)
- `make compose-remove-volumes` - Detener y eliminar volúmenes (limpieza completa)
- `make compose-clear-cache` - Borrar imágenes procesadas y feeds cacheados en Redis

## Obteniendo feeds

Invoca la dirección del servidor en el que estás ejecutando *DirtyRSS* pasando el nombre del programa que
quieres escuchar como parámetro. Por ejemplo:

```bash
# iVoox
http://<IP DE TU SERVIDOR>/ivoox/todopoderosos

# Twitch
http://<IP DE TU SERVIDOR>/twitch/srevolution

# La Vanguardia
http://<IP DE TU SERVIDOR>/lavanguardia/enric-juliana

# YouTube - Canal (soporta handles con @ y channel IDs)
http://<IP DE TU SERVIDOR>/youtube/channel/@filosofiaaquiyahora9169
http://<IP DE TU SERVIDOR>/youtube/channel/UC1234567890abcdef

# YouTube - Playlist
http://<IP DE TU SERVIDOR>/youtube/playlist/PLxxxxxxxxxxxxxx
```

Obtendrás el feed RSS correspondiente. Ahora solo tienes que compartirlo con tu podcatcher o lector de RSS.

**OJO: alguno de los enlaces a los audios caducan cada pocas horas**. Así que si no descargas los programas a local,
actualiza tu feed antes de darle al play.

## Colaborando en DirtyRSS

Pull request are welcome! Esta es obviamente una implementación rápida y sucia escrita en un par de días durante
las vacaciones de navidades. A mi me sirve, pero hay optimizaciones obvias que estarían chulas. Por ejemplo:

- [ ] Hacer el código compatible con Lambda
- [x] Añadir una caché para los shows habituales (implementado por Fran Lerma)
- [x] ~Revisar por qué algunos programas parece que no se descargan correctamente~
- [ ] Documentar mejor el código antes de que crezca
- [ ] Montar una batería de tests
- [x] Generar podcasts a partir de otras fuentes, como Twitch
- [x] Generar feeds RSS con artículos de La Vanguardia
- [ ] Generar feeds RSS con otros diarios

Si te animas, coméntamelo y te cuento cómo hackear el código. Ya sabes dónde encontrarme: http://twitter.com/ciberado.
